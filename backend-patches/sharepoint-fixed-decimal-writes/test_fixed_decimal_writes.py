"""Check the actual SharePoint HTTP payload before it can leave requests."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest

import requests
from requests.adapters import BaseAdapter

root = Path('/opt/energetica-whatsapp')
sys.path[:0] = [str(root / 'worker'), str(root)]
source = Path(os.environ.get('CLIENT_SOURCE', root / 'worker/clients.py'))
spec = importlib.util.spec_from_file_location('sharepoint_client_under_test', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CaptureRequests(BaseAdapter):
    def __init__(self):
        self.sent = []
        self.statuses = []

    def send(self, request, **kwargs):
        self.sent.append(request)
        response = requests.Response()
        response.status_code = self.statuses.pop(0) if self.statuses else 200
        response._content = b'{"Id": 11}'
        response.request = request
        return response

    def close(self):
        pass


class SharePointFixedDecimalWrites(unittest.TestCase):
    def setUp(self):
        self.client = module.SharePointClient('qa.invalid', 'sites/qa', '', '', '', '', 'LANCAMENTOS')
        self.client._token = lambda refresh=False: 'refreshed' if refresh else 'synthetic'
        self.client._internal_field = lambda target, field: field
        self.client._field_type_cache = {'LANCAMENTOS': {'FRETE': 'Number', 'OBS': 'Note'}}
        self.capture = CaptureRequests()
        self.client.session.mount('https://', self.capture)
        self.addCleanup(self.client.session.close)

    def test_create_emits_a_plain_decimal_number_and_preserves_observation(self):
        self.client._find_item = lambda *args, **kwargs: None
        note = 'Texto "5.92e-09" e barra \\ com 1e+21.'
        item = self.client.ensure_item('reference', {'FRETE': '0,00000000592', 'OBS': note})
        self.assertEqual(item, 11)
        sent, = self.capture.sent
        self.assertIn(b'"FRETE": 0.00000000592', sent.body)
        self.assertEqual(json.loads(sent.body), {'Title': 'reference', 'FRETE': 5.92e-9, 'OBS': note})

    def test_etag_update_retries_the_identical_plain_decimal_body(self):
        self.capture.statuses = [401, 200]
        self.client.update_item_with_etag(11, {'FRETE': -5.92e-9}, '"4"')
        first, second = self.capture.sent
        self.assertIn(b'"FRETE": -0.00000000592', first.body)
        self.assertEqual(first.body, second.body)
        self.assertEqual(second.headers['Authorization'], 'Bearer refreshed')
        self.assertEqual(second.headers['IF-MATCH'], '"4"')
        self.assertEqual(second.headers['Content-Type'], 'application/json;odata=nometadata')

    def test_json_body_with_nested_values_keeps_types_and_adds_content_type(self):
        values = {'large': 1.25e21, 'nested': [1e-7, True, None, '1e-7'], '1e-7': '1e+21'}
        self.client._request('POST', 'synthetic', json=values)
        sent, = self.capture.sent
        self.assertIn(b'"large": 1250000000000000000000', sent.body)
        self.assertIn(b'[0.0000001, true, null, "1e-7"]', sent.body)
        self.assertEqual(json.loads(sent.body), values)
        self.assertEqual(sent.headers['Content-Type'], 'application/json')

    def test_binary_upload_is_resent_byte_for_byte(self):
        self.capture.statuses = [401, 200]
        content = b'\x00%PDF 1e+21'
        self.client._request('POST', 'synthetic', data=content, headers={'Content-Type': 'application/pdf'})
        self.assertEqual([request.body for request in self.capture.sent], [content, content])
        self.assertEqual(self.capture.sent[-1].headers['Content-Type'], 'application/pdf')

    def test_invalid_float_is_rejected_before_network(self):
        with self.assertRaises(requests.exceptions.InvalidJSONError):
            self.client._request('POST', 'synthetic', json={'freight': float('nan')})
        self.assertEqual(self.capture.sent, [])


if __name__ == '__main__':
    unittest.main()
