import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from fiscal_document import parse_fiscal_xml
from fiscal_fixtures import COMPANY, CTE_KEY, NFSE_KEY, cte_xml, nfse_xml


class FiscalDocumentTests(unittest.TestCase):
    def test_cte_models_and_simplified_use_their_own_explicit_totals(self):
        for kind, model, net in [('cteProc', '57', '980.00'), ('cteOSProc', '67', '980.00'), ('cteSimpProc', '57', '975.00')]:
            key = CTE_KEY[:20] + model + CTE_KEY[22:]
            with self.subTest(kind=kind):
                doc = parse_fiscal_xml(cte_xml(kind), key, COMPANY, required_environment='1')
                self.assertEqual(doc.kind, kind)
                self.assertEqual(doc.model, model)
                self.assertEqual(str(doc.amount), '1000.00')
                self.assertEqual(str(doc.net), net)
                self.assertEqual(doc.supplier, 'Transportadora Ficticia')
                self.assertEqual(doc.issued_at, '2026-10-01T23:45:59-03:00')

    def test_nfse_provider_never_becomes_taker_issuer(self):
        raw = nfse_xml().replace(b'<emit><CNPJ>12345678000123</CNPJ><xNome>Prestador fiscal ficticio</xNome></emit>',
                                 f'<emit><CNPJ>{COMPANY}</CNPJ><xNome>Tomador emissor</xNome></emit>'.encode())
        doc = parse_fiscal_xml(raw, NFSE_KEY, COMPANY, required_environment='1')
        self.assertEqual(doc.supplier, 'Prestador Ficticio')
        self.assertEqual(doc.fiscal_type, 'NFS-e')
        self.assertEqual(str(doc.amount), '1000.00')
        self.assertEqual(str(doc.net), '921.50')
        self.assertEqual(doc.issued_at, '2026-10-01T23:45:59-03:00')

    def test_company_cannot_be_taken_from_unrelated_free_text(self):
        for raw, key in [(cte_xml(), CTE_KEY), (nfse_xml(), NFSE_KEY)]:
            raw = raw.replace(COMPANY.encode(), b'11111111000111')
            with self.subTest(key_length=len(key)), self.assertRaisesRegex(ValueError, 'COMPANY'):
                parse_fiscal_xml(raw, key, COMPANY)

    def test_environment_protocol_and_model_must_agree(self):
        invalid = [cte_xml().replace(b'<tpAmb>1</tpAmb>', b'<tpAmb>2</tpAmb>', 1),
                   cte_xml().replace(b'<mod>57</mod>', b'<mod>67</mod>'),
                   cte_xml().replace(b'<cStat>100</cStat>', b'<cStat>110</cStat>')]
        for raw in invalid:
            with self.subTest(raw_hash=hash(raw)), self.assertRaises(ValueError):
                parse_fiscal_xml(raw, CTE_KEY, COMPANY)
        with self.assertRaises(ValueError):
            parse_fiscal_xml(nfse_xml('2'), NFSE_KEY, COMPANY, required_environment='1')

    def test_summary_events_invalid_utf8_and_duplicate_invoices_are_rejected(self):
        for raw in [b'<resCTe/>', b'<evento/>', nfse_xml().replace(b'Contrato', b'\xffContrato'),
                    cte_xml().replace(b'</CTe>', b'</CTe><CTe><infCte/></CTe>')]:
            with self.subTest(size=len(raw)), self.assertRaises(ValueError):
                parse_fiscal_xml(raw, CTE_KEY, COMPANY)

    def test_nfse_missing_net_and_simplified_missing_deliveries_are_rejected(self):
        with self.assertRaises(ValueError):
            parse_fiscal_xml(nfse_xml().replace(b'<vLiq>921.50</vLiq>', b''), NFSE_KEY, COMPANY)
        import re
        raw = re.sub(br'<det nItem="\d+">.*?</det>', b'', cte_xml('cteSimpProc'))
        with self.assertRaises(ValueError):
            parse_fiscal_xml(raw, CTE_KEY, COMPANY)


if __name__ == '__main__':
    unittest.main()
