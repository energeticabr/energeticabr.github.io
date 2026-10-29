import base64
import copy
import hashlib
import io
import json
import subprocess
import sys
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from danfe_renderer import render_request
from pypdf import PdfReader
from fiscal_fixtures import CTE_KEY, NFSE_KEY, cte_xml, nfse_xml, render_envelope

FIXTURE = Path(__file__).parent / 'fixtures' / 'nfe-danfe-homologacao.xml'
KEY = '31261012345678000123550010000001231000001234'


def request(xml=None):
    raw = FIXTURE.read_bytes() if xml is None else xml.encode('utf-8')
    return {'key': KEY, 'companyCnpj': '38626750000146',
            'xmlBase64': base64.b64encode(raw).decode(),
            'xmlSha256': hashlib.sha256(raw).hexdigest()}


class DanfeTests(unittest.TestCase):
    def test_cli_keeps_one_json_response_and_sanitized_failure(self):
        script = Path(__file__).resolve().parents[1] / 'src/danfe_renderer.py'
        result = subprocess.run([sys.executable, str(script)],
                                input=json.dumps(render_envelope(nfse_xml('2'), NFSE_KEY)).encode(),
                                capture_output=True, check=False)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, b'')
        self.assertEqual(json.loads(result.stdout)['key'], NFSE_KEY)
        failed = subprocess.run([sys.executable, str(script)], input=b'{"xmlBase64":"PRIVATE_PAYLOAD"}',
                                capture_output=True, check=False)
        self.assertNotEqual(failed.returncode, 0)
        self.assertEqual(failed.stdout, b'')
        self.assertEqual(failed.stderr.splitlines(), [b'DANFE_GENERATION_FAILED'])

    def test_historical_nfse_renders_with_explicit_reconciled_situation(self):
        for situation in ['CANCELADA', 'SUBSTITUIDA']:
            req = render_envelope(nfse_xml(), NFSE_KEY)
            req['fiscalSituation'] = situation
            with self.subTest(situation=situation):
                result = render_request(req)
                reader = PdfReader(io.BytesIO(base64.b64decode(result['pdfBase64'])))
                self.assertTrue(all(situation in page.extract_text() for page in reader.pages))
                self.assertTrue(result['fileName'].startswith('DANFSe-'))
        req['fiscalSituation'] = 'UNKNOWN'
        with self.assertRaises(ValueError):
            render_request(req)

    def test_simplified_deliveries_keep_distinct_destinations_and_values(self):
        result = render_request(render_envelope(cte_xml('cteSimpProc', '2'), CTE_KEY))
        text = '\n'.join(p.extract_text() for p in PdfReader(io.BytesIO(base64.b64decode(result['pdfBase64']))).pages)
        for value in ['Entrega 1', 'Entrega 2', 'Sao Paulo', 'Campinas', '600,00', '590,00', '400,00', '385,00']:
            self.assertIn(value, text)
        self.assertNotIn('infCte/det', text)

    def test_standard_cte_uses_actual_dacte_renderer_when_compatible(self):
        from danfe_renderer import Dacte
        with patch('danfe_renderer.Dacte', wraps=Dacte) as dacte:
            result = render_request(render_envelope(cte_xml('cteProc', '2'), CTE_KEY))
        dacte.assert_called_once()
        text = '\n'.join(p.extract_text() for p in PdfReader(io.BytesIO(base64.b64decode(result['pdfBase64']))).pages)
        self.assertIn('DACTE', text)
        self.assertNotIn('ESPELHO DO XML', text)

    def test_invalid_new_fiscal_documents_cannot_generate_a_pdf(self):
        for raw, key in [(cte_xml(), CTE_KEY), (nfse_xml(), NFSE_KEY)]:
            for altered in [raw.replace(b'<cStat>100</cStat>', b'<cStat>110</cStat>'),
                            raw.replace(b'38626750000146', b'11111111000111')]:
                with self.subTest(key_length=len(key)), self.assertRaises(ValueError):
                    render_request(render_envelope(altered, key))

    def test_cte_os_simplified_and_nfse_generate_identified_readable_pdfs(self):
        cases = [('cteProc', cte_xml('cteProc', '2'), CTE_KEY, 'DACTE'),
                 ('cteOSProc', cte_xml('cteOSProc', '2'), CTE_KEY[:20]+'67'+CTE_KEY[22:], 'DACTE'),
                 ('cteSimpProc', cte_xml('cteSimpProc', '2'), CTE_KEY, 'DACTE'),
                 ('NFSe', nfse_xml('2'), NFSE_KEY, 'DANFSe')]
        for kind, raw, key, prefix in cases:
            with self.subTest(kind=kind):
                result = render_request(render_envelope(raw, key))
                pdf = base64.b64decode(result['pdfBase64'])
                text = '\n'.join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)
                self.assertTrue(result['fileName'].startswith(prefix+'-'+key))
                self.assertIn(key, text.replace(' ', '').replace('\n', ''))
                self.assertIn('1.000,00', text)
                if kind != 'cteProc':
                    self.assertIn('ESPELHO', text)
                    self.assertIn('HOMOLOGACAO', text)
                if kind == 'cteSimpProc':
                    self.assertIn('Sao Paulo', text)
                    self.assertIn('Campinas', text)

    def test_complete_invoice_produces_readable_pdf_with_exact_identity(self):
        result = render_request(request())
        pdf = base64.b64decode(result['pdfBase64'], validate=True)
        self.assertTrue(pdf.startswith(b'%PDF-'))
        self.assertEqual(result['key'], KEY)
        self.assertEqual(result['xmlSha256'], request()['xmlSha256'])
        self.assertEqual(result['pdfSha256'], hashlib.sha256(pdf).hexdigest())
        self.assertEqual(result['fileName'], f'DANFE-{KEY}-{result["xmlSha256"][:16]}.pdf')
        reader = PdfReader(io.BytesIO(pdf))
        text = '\n'.join(page.extract_text() for page in reader.pages)
        self.assertIn('DANFE', text)
        self.assertIn('HOMOLOG', text)
        self.assertGreaterEqual(len(reader.pages), 1)

    def test_summary_never_creates_a_false_invoice_pdf(self):
        with self.assertRaisesRegex(ValueError, 'DANFE_COMPLETE_XML_REQUIRED'):
            render_request(request('<resNFe xmlns="http://www.portalfiscal.inf.br/nfe"/>'))

    def test_key_hash_company_model_and_authorization_are_enforced(self):
        data = request()
        for field, value in [('key', '0' * 44), ('xmlSha256', '0' * 64), ('companyCnpj', '0' * 14)]:
            bad = copy.deepcopy(data)
            bad[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                render_request(bad)
        xml = FIXTURE.read_text(encoding='utf-8')
        for old, new in [('<mod>55</mod>', '<mod>65</mod>'), ('<cStat>100</cStat>', '<cStat>110</cStat>')]:
            self.assertIn(old, xml)
            with self.subTest(old=old), self.assertRaises(ValueError):
                render_request(request(xml.replace(old, new)))

    def test_external_entities_and_unbounded_input_are_rejected(self):
        malicious = '<!DOCTYPE nfeProc [<!ENTITY x SYSTEM "file:///etc/passwd">]><nfeProc>&x;</nfeProc>'
        with self.assertRaises(ValueError):
            render_request(request(malicious))
        bad = request()
        bad['xmlBase64'] = 'A' * 1500001
        with self.assertRaises(ValueError):
            render_request(bad)


if __name__ == '__main__':
    unittest.main()
