"""Exercise the real adapter at its authenticated HTTP boundary."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import unittest


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Response:
    def __init__(self, body, etag=None):
        self.body = body
        self.headers = {'ETag': etag} if etag else {}
        self.content = json.dumps(body).encode()

    def json(self):
        return deepcopy(self.body)


class HttpFailure(Exception):
    def __init__(self, status):
        self.response = type('FailureResponse', (), {'status_code': status})()


class Client:
    site_url = 'https://tenant.example/personal/owner'

    def __init__(self, responses):
        self.responses, self.calls = list(responses), []

    def _request(self, method, endpoint, **kwargs):
        self.calls.append((method, endpoint, deepcopy(kwargs)))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.module = load('live_adapter')
        self.model = load('model')

    def adapter(self, *responses):
        client = Client(responses)
        return self.module.SharePointAdapter(client), client

    def test_complete_minimalmetadata_pagination_preserves_row_versions(self):
        base = 'web/lists(guid\'6e5c235e-797a-4a86-8c05-25e0ab6ad870\')/items'
        next_url = Client.site_url + '/_api/' + base + '?$skiptoken=p_ID%3d1'
        adapter, client = self.adapter(
            Response({'value': [{'Id': 1, 'odata.etag': '"1"'}], 'odata.nextLink': next_url}),
            Response({'value': [{'Id': 2, 'odata.etag': '"2"'}]}))
        self.assertEqual([(r['Id'], r['audit_etag']) for r in adapter.all_rows(self.model.CHILD)], [(1, '"1"'), (2, '"2"')])
        self.assertEqual(client.calls[1][1], next_url)

    def test_pagination_cannot_escape_selected_list_or_repeat_a_page(self):
        for next_url in ['https://tenant.example.evil/personal/owner/_api/web/items',
                         Client.site_url + '/_api/web/lists/getbytitle(\'LANCAMENTOS\')/items',
                         Client.site_url + '/_api/web/lists(guid\'6e5c235e-797a-4a86-8c05-25e0ab6ad870\')/items?$top=1000&$orderby=Id']:
            adapter, client = self.adapter(Response({'value': [], 'odata.nextLink': next_url}))
            with self.subTest(next_url=next_url), self.assertRaises(ValueError):
                adapter.all_rows(self.model.CHILD)
            self.assertEqual(len(client.calls), 1)

    def test_find_escapes_exact_string_filter_and_reads_all_pages(self):
        adapter, client = self.adapter(Response({'value': []}))
        self.assertEqual(adapter.find(self.model.CHILD, 'FOLHAOPERACAO', "SWILE-RH:2026-12-23:2'"), [])
        self.assertEqual(client.calls[0][2]['params']['$filter'], "FOLHAOPERACAO eq 'SWILE-RH:2026-12-23:2'''" )
        with self.assertRaises(ValueError):
            adapter.find(self.model.CHILD, 'Title or true', 'x')

    def test_unique_key_gate_requires_index_and_uniqueness_without_modifying_schema(self):
        for meta in [{'EnforceUniqueValues': True, 'Indexed': True},
                     {'EnforceUniqueValues': False, 'Indexed': True},
                     {'EnforceUniqueValues': True, 'Indexed': False}]:
            adapter, client = self.adapter(Response(meta))
            if all(meta.values()):
                adapter.require_unique(self.model.PARENT, 'FOLHAOPERACAO')
            else:
                with self.assertRaises(ValueError):
                    adapter.require_unique(self.model.PARENT, 'FOLHAOPERACAO')
            self.assertEqual(client.calls[0][0], 'GET')

    def test_item_read_uses_header_etag_and_only_404_means_absence(self):
        adapter, _ = self.adapter(Response({'Id': 11}, '"7"'), HttpFailure(404), HttpFailure(403))
        self.assertEqual(adapter.read(self.model.PARENT, 11)['audit_etag'], '"7"')
        self.assertIsNone(adapter.read(self.model.PARENT, 11))
        with self.assertRaises(HttpFailure):
            adapter.read(self.model.PARENT, 11)

    def test_collection_and_singleton_transport_annotations_have_same_business_snapshot(self):
        fields = {'Id': 11, 'Title': 'SWILE-RH:2026-12-23', 'VALORTOTAL': '225'}
        adapter, _ = self.adapter(Response({'value': [{**fields, 'odata.etag': '"7"', 'odata.type': 'SP.Item'}]}),
                                  Response({**fields, 'odata.etag': '"7"', 'odata.metadata': 'https://tenant.example/$metadata#item'}, '"7"'))
        self.assertEqual(adapter.all_rows(self.model.PARENT)[0], adapter.read(self.model.PARENT, 11))

    def test_rest_body_etag_stays_consistent_when_singleton_header_uses_guid_version(self):
        fields = {'Id': 11, 'Title': 'SWILE-RH:2026-12-23', 'odata.etag': '"7"'}
        adapter, _ = self.adapter(Response({'value': [fields]}), Response(fields, '"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee,7"'))
        collection, singleton = adapter.all_rows(self.model.PARENT)[0], adapter.read(self.model.PARENT, 11)
        self.assertEqual(collection, singleton)
        self.assertEqual(singleton['audit_etag'], '"7"')

    def test_missing_etag_malformed_pages_and_mismatched_ids_fail_closed(self):
        for payload in [{'Id': 11}, {'Id': 12, 'odata.etag': '"1"'}]:
            adapter, _ = self.adapter(Response(payload))
            with self.assertRaises(ValueError):
                adapter.read(self.model.PARENT, 11)
        adapter, _ = self.adapter(Response({'unexpected': []}))
        with self.assertRaises(ValueError):
            adapter.all_rows(self.model.CHILD)

    def test_mutations_use_exact_etag_never_retry_or_touch_unrelated_lists(self):
        adapter, client = self.adapter(Response({}), Response({}), HttpFailure(412))
        adapter.patch(self.model.PARENT, 11, {'VALORTOTAL': '225'}, '"3"')
        adapter.delete(self.model.CHILD, 12, '"8"')
        with self.assertRaises(HttpFailure):
            adapter.patch(self.model.PARENT, 11, {'VALORTOTAL': '225'}, '"3"')
        self.assertEqual(len(client.calls), 3)
        self.assertEqual([c[2]['headers']['IF-MATCH'] for c in client.calls], ['"3"', '"8"', '"3"'])
        for title, fields in [('LANCAMENTOS', {'OBS': 'x'}),
                              (self.model.RH, {'Title': 'x'}),
                              (self.model.CHILD, {'DATAPGTOEFETUADO': '2026-12-23'}),
                              (self.model.LEGACY, {'STATUS': 'ATIVO'})]:
            with self.subTest(title=title), self.assertRaises(ValueError):
                adapter.patch(title, 11, fields, '"1"')
        for etag in ['', '*', 'W/*', None]:
            with self.assertRaises(ValueError):
                adapter.delete(self.model.CHILD, 12, etag)
        self.assertEqual(len(client.calls), 3)

    def test_create_is_restricted_to_benefit_targets_and_normal_post(self):
        adapter, client = self.adapter(Response({'Id': 15, 'odata.etag': '"1"'}))
        payload = {'FOLHAOPERACAO': 'SWILE-RH:2026-12-23', 'FORNECEDOR': 'SWILE', 'VALORTOTAL': '0'}
        adapter.create(self.model.PARENT, payload)
        self.assertEqual(client.calls[0][0], 'POST')
        self.assertEqual(client.calls[0][2]['json'], payload)
        with self.assertRaises(ValueError):
            adapter.create(self.model.LEGACY, payload)
        with self.assertRaises(ValueError):
            adapter.create(self.model.PARENT, {'FOLHAOPERACAO': 'OTHER', 'VALORTOTAL': '0'})


if __name__ == '__main__':
    unittest.main()
