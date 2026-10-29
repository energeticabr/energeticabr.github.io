import base64
import io
from pathlib import Path
import sys
import re
import unittest

from pypdf import PdfReader

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from danfe_renderer import render_request
from national_danfse import NationalDanfse
from fiscal_fixtures import NFSE_KEY, nfse_xml, render_envelope


class NationalDanfseTests(unittest.TestCase):
    def test_missing_provider_name_cannot_be_borrowed_from_a_different_issuer(self):
        raw = nfse_xml('2').decode().replace('<prest><CNPJ>12345678000123</CNPJ><xNome>Prestador Ficticio</xNome>',
                                            '<prest><CNPJ>12345678000123</CNPJ>')
        raw = raw.replace('<emit><CNPJ>12345678000123</CNPJ><xNome>Prestador fiscal ficticio</xNome>',
                          '<emit><CNPJ>11111111000111</CNPJ><xNome>FOREIGN_ISSUER_NOT_PROVIDER</xNome>')
        pdf = base64.b64decode(render_request(render_envelope(raw.encode(), NFSE_KEY))['pdfBase64'])
        self.assertNotIn('FOREIGN_ISSUER_NOT_PROVIDER', PdfReader(io.BytesIO(pdf)).pages[0].extract_text())

    def test_normative_fonts_are_embedded_and_not_substituted_by_core_helvetica(self):
        pdf = base64.b64decode(render_request(render_envelope(nfse_xml('2'), NFSE_KEY))['pdfBase64'])
        reader = PdfReader(io.BytesIO(pdf))
        fonts = [value.get_object() for value in reader.pages[0]['/Resources']['/Font'].get_object().values()]
        names = [str(font['/BaseFont']) for font in fonts]
        self.assertTrue(any('Arial' in name for name in names))
        self.assertTrue(any('MicrosoftSansSerif' in name for name in names))
        self.assertFalse(any('Helvetica' in name for name in names))
        self.assertTrue(all(font['/Subtype'] == '/Type0' for font in fonts))

    def test_retained_pis_cofins_use_the_nt008_rule_without_changing_xml_totals(self):
        raw = nfse_xml('2').replace(b'</tribMun>', b'</tribMun><tribFed><piscofins><vPis>6.50</vPis>'
                                 b'<vCofins>30.00</vCofins><tpRetPisCofins>1</tpRetPisCofins></piscofins>'
                                 b'<vRetCSLL>10.00</vRetCSLL><vRetIRRF>15.00</vRetIRRF></tribFed>')
        data = NationalDanfse(xml=raw.decode()).data
        self.assertEqual(data['federal_taxes']['social_contribution'], 'R$ 46,50')
        self.assertEqual(data['federal_taxes']['pis_debit'], 'R$ 0,00')
        self.assertEqual(data['federal_taxes']['cofins_debit'], 'R$ 0,00')
        self.assertEqual(data['total_value']['service_amount'], 'R$ 1.000,00')
        self.assertEqual(data['total_value']['net_value'], 'R$ 921,50')

    def test_nt009_direct_purpose_is_preserved(self):
        raw = nfse_xml('2').replace(b'<infDPS>', b'<infDPS><finNFSe>1</finNFSe>')
        self.assertEqual(NationalDanfse(xml=raw.decode()).data['purpose'], 'NFS-e de crédito')

    def test_simples_and_tax_regime_descriptions_wrap_without_ellipsis(self):
        raw = nfse_xml('2').replace(b'</prest>', b'<regTrib><opSimpNac>3</opSimpNac><regApTribSN>3</regApTribSN></regTrib></prest>')
        pdf = base64.b64decode(render_request(render_envelope(raw, NFSE_KEY))['pdfBase64'])
        reader = PdfReader(io.BytesIO(pdf))
        shown = re.sub(r'\s+', ' ', reader.pages[0].extract_text())
        self.assertIn('Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)', shown)
        self.assertNotIn('Optante - Microempresa ou Empresa de ...', shown)
        self.assertEqual(len(reader.pages), 1)


if __name__ == '__main__':
    unittest.main()
