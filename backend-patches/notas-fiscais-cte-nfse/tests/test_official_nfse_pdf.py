"""Read-only checks use synthetic PDFs, never a transformed official artifact."""
import base64
import hashlib
from pathlib import Path
import sys
import unittest

from fpdf import FPDF

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from danfe_renderer import render_request
from fiscal_fixtures import NFSE_KEY, nfse_xml, render_envelope


def synthetic_pdf(**changes):
    fields = {'key': NFSE_KEY, 'provider': '12.345.678/0001-23', 'number': '123',
              'gross': '1.000,00', 'net': '921,50'}
    fields.update(changes)
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font('Helvetica', size=10)
    for line in ['SYNTHETIC VALIDATION FIXTURE - NO FISCAL VALUE',
                 'Chave de acesso: '+fields['key'], 'Prestador CNPJ: '+fields['provider'],
                 'Numero da NFS-e: '+fields['number'], 'Valor do servico: R$ '+fields['gross'],
                 'Valor liquido da NFS-e: R$ '+fields['net']]:
        pdf.cell(w=0, h=7, text=line, new_x='LMARGIN', new_y='NEXT')
    return bytes(pdf.output())


def envelope(pdf):
    req = render_envelope(nfse_xml(), NFSE_KEY)
    req.update(action='validateOfficialNfsePdf', pdfBase64=base64.b64encode(pdf).decode())
    return req


class OfficialNfsePdfTests(unittest.TestCase):
    def test_matching_pdf_validates_original_bytes_without_rerendering(self):
        pdf = synthetic_pdf()
        result = render_request(envelope(pdf))
        self.assertEqual(result, {'valid': True, 'key': NFSE_KEY,
                                 'xmlSha256': hashlib.sha256(nfse_xml()).hexdigest(),
                                 'pdfSha256': hashlib.sha256(pdf).hexdigest()})

    def test_wrong_key_provider_invoice_number_or_amount_cannot_be_attached(self):
        for change in [{'key': '1'*50}, {'provider': '11.111.111/0001-11'},
                       {'number': '999'}, {'gross': '1.001,00'}, {'net': '920,50'}]:
            with self.subTest(field=next(iter(change))):
                with self.assertRaisesRegex(ValueError, 'DANFSE_PDF_IDENTITY_MISMATCH'):
                    render_request(envelope(synthetic_pdf(**change)))

    def test_swapped_gross_and_net_do_not_validate_by_matching_elsewhere(self):
        with self.assertRaisesRegex(ValueError, 'DANFSE_PDF_IDENTITY_MISMATCH'):
            render_request(envelope(synthetic_pdf(gross='921,50', net='1.000,00')))

    def test_number_in_observation_does_not_validate_a_wrong_nfse_number(self):
        with self.assertRaisesRegex(ValueError, 'DANFSE_PDF_IDENTITY_MISMATCH'):
            render_request(envelope(synthetic_pdf(number='999 Observacao: contrato 123')))

    def test_provider_in_observation_does_not_validate_a_wrong_provider_field(self):
        with self.assertRaisesRegex(ValueError, 'DANFSE_PDF_IDENTITY_MISMATCH'):
            render_request(envelope(synthetic_pdf(provider='11.111.111/0001-11 Observacao: 12.345.678/0001-23')))

    def test_provider_embedded_in_key_is_not_a_provider_match(self):
        with self.assertRaisesRegex(ValueError, 'DANFSE_PDF_IDENTITY_MISMATCH'):
            render_request(envelope(synthetic_pdf(provider='')))

    def test_provider_embedded_in_grouped_access_key_is_not_a_provider_match(self):
        grouped = NFSE_KEY.replace('12345678000123', ' 12345678000123 ')
        with self.assertRaisesRegex(ValueError, 'DANFSE_PDF_IDENTITY_MISMATCH'):
            render_request(envelope(synthetic_pdf(provider='', key=grouped)))

    def test_number_embedded_in_key_is_not_an_invoice_number_match(self):
        with self.assertRaisesRegex(ValueError, 'DANFSE_PDF_IDENTITY_MISMATCH'):
            render_request(envelope(synthetic_pdf(number='')))

    def test_pdf_header_without_readable_pdf_content_is_rejected(self):
        for pdf in [b'<html>unavailable</html>', b'%PDF-1.4\nSYNTHETIC ONLY\n%%EOF']:
            with self.subTest(header=pdf[:5]):
                with self.assertRaisesRegex(ValueError, 'DANFSE_PDF_INVALID'):
                    render_request(envelope(pdf))

    def test_official_validation_does_not_accept_unknown_actions(self):
        req = envelope(synthetic_pdf())
        req['action'] = 'downloadAnything'
        with self.assertRaisesRegex(ValueError, 'DANFE_ACTION_INVALID'):
            render_request(req)


if __name__ == '__main__':
    unittest.main()
