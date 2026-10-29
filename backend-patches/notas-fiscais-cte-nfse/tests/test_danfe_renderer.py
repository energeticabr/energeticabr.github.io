import base64
import copy
import hashlib
import io
import json
import subprocess
import sys
import unittest
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
                                input=json.dumps(request()).encode(),
                                capture_output=True, check=False)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, b'')
        self.assertEqual(json.loads(result.stdout)['key'], KEY)
        failed = subprocess.run([sys.executable, str(script)], input=b'{"xmlBase64":"PRIVATE_PAYLOAD"}',
                                capture_output=True, check=False)
        self.assertNotEqual(failed.returncode, 0)
        self.assertEqual(failed.stdout, b'')
        self.assertEqual(failed.stderr.splitlines(), [b'DANFE_GENERATION_FAILED'])

    def test_nfse_renders_national_danfse_with_reconciled_situation(self):
        for situation, watermark in [('AUTORIZADA', None), ('CANCELADA', 'CANCELADA'), ('SUBSTITUIDA', 'SUBSTITUÍDA')]:
            req = render_envelope(nfse_xml('2'), NFSE_KEY)
            req['fiscalSituation'] = situation
            with self.subTest(situation=situation):
                result = render_request(req)
                reader = PdfReader(io.BytesIO(base64.b64decode(result['pdfBase64'])))
                shown = '\n'.join(page.extract_text() for page in reader.pages)
                self.assertEqual(result['source'], 'LOCAL_DANFSE_NACIONAL')
                self.assertIn('DANFSe v2.0', shown)
                self.assertIn('NFS-e SEM VALIDADE JURÍDICA', shown)
                self.assertIn(NFSE_KEY, shown)
                self.assertEqual(len(reader.pages), 1)
                self.assertNotIn('ESPELHO', shown)
                if watermark:
                    self.assertIn(watermark, shown)
        req['fiscalSituation'] = 'UNKNOWN'
        with self.assertRaisesRegex(ValueError, 'DANFE_SITUATION_INVALID'):
            render_request(req)

    def test_unsupported_cte_variants_cannot_create_a_custom_fiscal_pdf(self):
        for kind, model in [('cteOSProc', '67'), ('cteSimpProc', '57')]:
            key = CTE_KEY[:20] + model + CTE_KEY[22:]
            with self.subTest(kind=kind):
                with self.assertRaisesRegex(ValueError, 'DACTE_LAYOUT_UNSUPPORTED'):
                    render_request(render_envelope(cte_xml(kind, '2'), key))

    def test_cte_renderer_failure_never_turns_into_a_custom_summary(self):
        raw = cte_xml('cteProc', '2').replace(b'<modal>01</modal>', b'<modal>99</modal>')
        with self.assertRaisesRegex(ValueError, 'DANFE_RENDER_FAILED'):
            render_request(render_envelope(raw, CTE_KEY))

    def test_cte_unsupported_version_is_rejected_without_changing_xml(self):
        raw = cte_xml('cteProc', '2').replace(b'versao="4.00"', b'versao="3.00"')
        with self.assertRaisesRegex(ValueError, 'DACTE_LAYOUT_UNSUPPORTED'):
            render_request(render_envelope(raw, CTE_KEY))

    def test_standard_cte_uses_actual_dacte_renderer_when_compatible(self):
        result = render_request(render_envelope(cte_xml('cteProc', '2'), CTE_KEY))
        text = '\n'.join(p.extract_text() for p in PdfReader(io.BytesIO(base64.b64decode(result['pdfBase64']))).pages)
        self.assertIn('DACTE', text)
        self.assertNotIn('ESPELHO DO XML', text)

    def test_standard_dacte_keeps_xobs_and_both_complementary_observation_groups(self):
        raw = cte_xml('cteProc', '2').replace(
            b'</compl>', b'<ObsCont xCampo="TEST"><xTexto>Declaracao complementar ficticia.</xTexto></ObsCont>'
            b'<ObsFisco xCampo="TEST"><xTexto>Informacao fiscal ficticia.</xTexto></ObsFisco></compl>')
        result = render_request(render_envelope(raw, CTE_KEY))
        reader = PdfReader(io.BytesIO(base64.b64decode(result['pdfBase64'])))
        shown = '\n'.join(page.extract_text() for page in reader.pages)
        for observation in ['Servico de transporte ficticio. Nenhum documento real.',
                            'Declaracao complementar ficticia.', 'Informacao fiscal ficticia.']:
            self.assertEqual(shown.count(observation), 1)

    def test_invalid_new_fiscal_documents_cannot_generate_a_pdf(self):
        for raw, key in [(cte_xml(), CTE_KEY), (nfse_xml(), NFSE_KEY)]:
            for altered in [raw.replace(b'<cStat>100</cStat>', b'<cStat>110</cStat>'),
                            raw.replace(b'38626750000146', b'11111111000111')]:
                with self.subTest(key_length=len(key)), self.assertRaises(ValueError):
                    render_request(render_envelope(altered, key))

    def test_standard_cte_preserves_fiscal_identity_values_and_xml_digest(self):
        raw = cte_xml('cteProc', '2')
        result = render_request(render_envelope(raw, CTE_KEY))
        pdf = base64.b64decode(result['pdfBase64'], validate=True)
        reader = PdfReader(io.BytesIO(pdf))
        text = '\n'.join(page.extract_text() for page in reader.pages)
        for value in ['DACTE', 'CHAVE DE ACESSO', CTE_KEY, '131260000000123',
                      'Transportadora Ficticia', '12.345.678/0001-23',
                      'Tomador ficticio', '38.626.750/0001-46', 'Betim - MG',
                      'Sao Paulo - SP', '1.000,00', '980,00', '120,00']:
            self.assertIn(value, text)
        self.assertNotIn('ESPELHO', text)
        self.assertEqual(len(reader.pages), 1)
        self.assertEqual(result['xmlSha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual(result['pdfSha256'], hashlib.sha256(pdf).hexdigest())
        self.assertEqual(result['fileName'], f'DACTE-{CTE_KEY}-{result["xmlSha256"][:16]}.pdf')
        # Code128 is drawn as vector rectangles rather than a textual fake barcode.
        self.assertGreater(reader.pages[0].get_contents().get_data().count(b' re'), 100)

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
