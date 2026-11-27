"""Exercise the actual Gallery service with synthetic SharePoint JSON values."""
import json
import os
from pathlib import Path
import sys
import unittest

from test_launch_gallery import make_env, mutation

ROOT = Path('/opt/energetica-whatsapp')
sys.path[:0] = [os.environ.get('GALLERY_WORKER', str(ROOT / 'worker')), str(ROOT / 'worker')]
from launch_gallery import LaunchGalleryError


class GalleryNumericReadback(unittest.TestCase):
    def setUp(self):
        self.service, self.sharepoint, _ = make_env()
        receipt = json.loads('{"field_8": 1, "field_9": 10.004999999, "field_10": 5.92e-9}')
        self.sharepoint.rows['LANCAMENTOS'] = [{**self.sharepoint.launch(1), **receipt}]

    def test_snapshot_includes_freight_in_row_and_total_rounding(self):
        result = self.service.handle('snapshot', {})
        self.assertEqual(result['count'], 1)
        self.assertEqual(result['rows'][0]['total'], 10.01)
        self.assertEqual(result['totals']['total'], 10.01)
        self.assertEqual(result['rows'][0]['fields']['FRETE'], 5.92e-9)

    def test_search_finds_exact_freight_in_localized_decimal(self):
        result = self.service.handle('snapshot', {'filters': {'search': '0,00000000592'}})
        self.assertEqual([row['id'] for row in result['rows']], ['1'])

    def test_detail_keeps_exact_freight(self):
        result = self.service.handle('detail', {'id': '1'})
        self.assertEqual(result['item']['fields']['FRETE'], 5.92e-9)
        self.assertEqual(result['item']['total'], 10.01)

    def test_invalid_number_strings_and_nonfinite_numbers_still_rejected(self):
        for invalid in ('5.92e-9', '5.92e-9 invalid', float('inf'), float('nan'), True, 1e16):
            with self.subTest(value=invalid):
                with self.assertRaises(LaunchGalleryError) as raised:
                    self.service.handle('update', mutation(fields={'FRETE': invalid}))
                self.assertEqual(raised.exception.code, 'invalid_number')
        self.assertEqual(self.sharepoint.mutations, [])


if __name__ == '__main__':
    unittest.main()
