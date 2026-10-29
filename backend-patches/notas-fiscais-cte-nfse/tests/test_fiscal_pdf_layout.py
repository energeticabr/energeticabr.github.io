"""Human-readable fallback previews; every document is a synthetic fixture."""
import base64
import io
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from danfe_renderer import render_request
from fiscal_fixtures import CTE_KEY, NFSE_KEY, cte_xml, nfse_xml, render_envelope
from pypdf import PdfReader


def service_fixture(description='Manutenção elétrica e revisão de máquinas.\nServiço fictício, com atenção à segurança.'):
    raw = nfse_xml('2').decode()
    raw = raw.replace('Prestador Ficticio', 'Prestador Fictício de Manutenção Ltda.')
    raw = raw.replace('<prest><CNPJ>12345678000123</CNPJ>', '<prest><CNPJ>12345678000123</CNPJ>')
    raw = raw.replace('</prest>', '<end><endNac><cMun>3106705</cMun><CEP>30000000</CEP></endNac><xLgr>Rua Fictícia das Acácias</xLgr><nro>123</nro><xBairro>Centro</xBairro></end></prest>')
    raw = raw.replace('<serv><cServ>', '<serv><locPrest><cLocPrestacao>3106705</cLocPrestacao></locPrest><cServ><cTribNac>010101</cTribNac>')
    raw = raw.replace('<nNFSe>', '<xLocPrestacao>Betim</xLocPrestacao><nNFSe>', 1)
    old = 'Manutencao de equipamento ficticio. Texto literal &lt;b&gt;sem HTML&lt;/b&gt;.'
    raw = raw.replace(old, description)
    raw = raw.replace('</tribMun>', '</tribMun><tribFed><piscofins><vPis>6.50</vPis><vCofins>30.00</vCofins><tpRetPisCofins>1</tpRetPisCofins></piscofins><vRetIRRF>15.00</vRetIRRF></tribFed>')
    return raw.encode()


def read_pdf(raw, key=NFSE_KEY, situation='AUTORIZADA'):
    request = render_envelope(raw, key)
    request['fiscalSituation'] = situation
    result = render_request(request)
    reader = PdfReader(io.BytesIO(base64.b64decode(result['pdfBase64'])))
    return reader, '\n'.join(page.extract_text() for page in reader.pages)


class HumanFiscalPdfTests(unittest.TestCase):
    def test_provider_address_falls_back_to_same_identity_issuer_without_inventing_locality(self):
        raw = nfse_xml('2').decode().replace('</emit>', '<enderNac><xLgr>Avenida Fictícia do Comércio</xLgr><nro>45</nro><xBairro>Centro</xBairro><cMun>3106705</cMun><UF>MG</UF><CEP>30000000</CEP></enderNac></emit>')
        _, shown = read_pdf(raw.encode())
        self.assertIn('Avenida Fictícia do Comércio', shown)
        self.assertIn('Município (IBGE): 3106705 / MG', shown)
        mismatched = raw.replace('<emit><CNPJ>12345678000123</CNPJ>', '<emit><CNPJ>11111111000111</CNPJ>')
        _, hidden = read_pdf(mismatched.encode())
        self.assertNotIn('Avenida Fictícia do Comércio', hidden)
        nested = raw.replace('</prest>', '<end><endNac><cMun>3106705</cMun><UF>MG</UF></endNac><xLgr>Rua Nacional Fictícia</xLgr><nro>9</nro></end></prest>')
        _, nested_text = read_pdf(nested.encode())
        self.assertIn('Rua Nacional Fictícia', nested_text)
        self.assertIn('Município (IBGE): 3106705 / MG', nested_text)

    def test_service_has_readable_groups_authoritative_amounts_and_no_xml_dump(self):
        reader, text = read_pdf(service_fixture())
        for value in ['ESPELHO DA NFS-e', 'PRESTADOR', 'TOMADOR', 'DADOS DO DOCUMENTO', 'SERVIÇO', 'VALORES', 'TRIBUTOS INFORMADOS', 'RETENÇÕES DECLARADAS', 'OBSERVAÇÕES', 'Manutenção elétrica', 'Rua Fictícia das Acácias', '010101', 'Betim']:
            self.assertIn(value, text)
        for value in ['1.000,00', '30,00', '921,50', '48,50', '6,50', '15,00', '12345678000123', NFSE_KEY]:
            self.assertIn(value, text.replace('\n', '') if value == NFSE_KEY else text)
        self.assertNotIn('infNFSe/', text)
        self.assertNotIn('infDPS/', text)
        self.assertNotIn('CAMPOS DO XML', text)
        self.assertEqual(len(reader.pages), 1, 'typical complete service summary fits one legible A4 page')

    def test_missing_values_stay_absent_and_normal_taxes_are_not_called_retained(self):
        raw = nfse_xml('2').replace(b'<tpRetISSQN>2</tpRetISSQN>', b'<tpRetISSQN>1</tpRetISSQN>')
        _, text = read_pdf(raw)
        self.assertIn('Não informado no XML', text)
        self.assertNotIn('ISS retido pelo tomador', text)
        self.assertIn('ISS informado', text)
        self.assertIn('Valor líquido conforme o XML original.', text)

    def test_long_multiline_service_keeps_all_text_and_terminal_headers_on_every_page(self):
        description = '\n'.join(f'Linha {i:03d}: manutenção fictícia, revisão e conferência dos equipamentos.' for i in range(1, 111))
        for situation in ['CANCELADA', 'SUBSTITUIDA']:
            with self.subTest(situation=situation):
                reader, text = read_pdf(service_fixture(description), situation=situation)
                self.assertGreater(len(reader.pages), 1)
                self.assertIn('Linha 110', text)
                self.assertTrue(all('ESPELHO DA NFS-e' in page.extract_text() and situation in page.extract_text() for page in reader.pages))
                self.assertTrue(all(NFSE_KEY in page.extract_text().replace('\n', '') for page in reader.pages))
                self.assertTrue(all('Página' in page.extract_text() for page in reader.pages))
                self.assertEqual(float(reader.pages[0].mediabox.width), 595.28)

    def test_transport_fallback_groups_deliveries_without_technical_paths(self):
        for kind in ['cteOSProc', 'cteSimpProc']:
            key = CTE_KEY[:20] + ('67' if kind == 'cteOSProc' else '57') + CTE_KEY[22:]
            reader, text = read_pdf(cte_xml(kind, '2'), key)
            for value in ['TRANSPORTADORA', 'TOMADOR', 'TRANSPORTE', '1.000,00', 'Betim']:
                self.assertIn(value, text)
            self.assertNotIn('infCte/', text)
            if kind == 'cteSimpProc':
                for value in ['Entrega 1', 'Entrega 2', 'Sao Paulo', 'Campinas', '600,00', '590,00', '400,00', '385,00']:
                    self.assertIn(value, text)
                for page in reader.pages:
                    page_text = page.extract_text()
                    if 'Entrega 2' in page_text:
                        self.assertIn('Campinas', page_text, 'delivery title stays with its destination')


if __name__ == '__main__':
    unittest.main()
