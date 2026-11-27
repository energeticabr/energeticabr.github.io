"""Verify matching and mismatching numeric readbacks through the SharePoint client."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

root = Path('/opt/energetica-whatsapp')
sys.path[:0] = [str(root / 'worker'), str(root)]
source = Path(os.environ.get('CLIENT_SOURCE', root / 'worker/clients.py'))
spec = importlib.util.spec_from_file_location('sharepoint_client_under_test', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SharePointDecimalReadback(unittest.TestCase):
    def verify_freight(self, expected, response):
        client = module.SharePointClient.__new__(module.SharePointClient)
        client.target_list = 'Synthetic'
        client._field_type_cache = {'Synthetic': {'Freight': 'Number'}}
        client._internal_field = lambda target, name: 'Freight'
        client._list_endpoint = lambda target: 'synthetic'
        client._request = lambda *args, **kwargs: json.loads(response)
        client._attachment_names_with_retry = lambda *args, **kwargs: set()
        with patch.dict(os.environ, {'SHAREPOINT_ITEM_CONFIRM_ATTEMPTS': '1'}):
            return client.verify_item(11, {'FRETE': expected}, [])

    def test_confirms_small_freight_from_scientific_json_number(self):
        self.assertEqual(
            {'fields': True, 'attachments': True},
            self.verify_freight('0.00000000592', '{"Id":11,"Freight":5.92e-9}'),
        )

    def test_different_small_freight_remains_a_mismatch(self):
        with self.assertRaisesRegex(RuntimeError, 'FRETE'):
            self.verify_freight('0.00000000592', '{"Id":11,"Freight":5.82e-9}')

    def test_confirms_zero_and_localized_decimal_as_before(self):
        for expected, response in [('0', '{"Freight":0.0}'), ('1.234,56', '{"Freight":1234.56}')]:
            with self.subTest(expected=expected):
                self.assertTrue(self.verify_freight(expected, response)['fields'])

    def test_malformed_text_does_not_confirm_numeric_field(self):
        with self.assertRaisesRegex(RuntimeError, 'FRETE'):
            self.verify_freight('0.00000000592', '{"Id":11,"Freight":"5.92e-9 invalid"}')


if __name__ == '__main__':
    unittest.main()
