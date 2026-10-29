"""No generic fiscal mirror is delivered by the production renderer."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from danfe_renderer import render_request
from fiscal_fixtures import CTE_KEY, NFSE_KEY, cte_xml, nfse_xml, render_envelope


class FiscalLayoutBoundaryTests(unittest.TestCase):
    def test_long_service_description_stays_in_single_page_national_layout(self):
        raw = nfse_xml('2').replace(b'Manutencao de equipamento ficticio.', b'Long service. ' * 3000)
        import base64, io
        from pypdf import PdfReader
        result = render_request(render_envelope(raw, NFSE_KEY))
        reader = PdfReader(io.BytesIO(base64.b64decode(result['pdfBase64'])))
        self.assertEqual(len(reader.pages), 1)
        self.assertIn('DANFSe v2.0', reader.pages[0].extract_text())

    def test_simplified_deliveries_cannot_be_mislabeled_as_standard_dacte(self):
        with self.assertRaisesRegex(ValueError, 'DACTE_LAYOUT_UNSUPPORTED'):
            render_request(render_envelope(cte_xml('cteSimpProc', '2'), CTE_KEY))


if __name__ == '__main__':
    unittest.main()
