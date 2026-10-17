import copy
import hashlib
import tempfile
import unittest
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from provision_attachment_sync import Mirror, MissingLink, CHILD, PARENT, SharePointStore, sync_uploaded_attachment, copy_name


class Store:
    def __init__(self):
        self.links = {337: (23, 'c1'), 326: (23, 'c2')}
        self.versions = {23: 'p1'}
        self.files = {(CHILD, 337): {'conta.pdf': b'original'},
                      (CHILD, 326): {'conta.pdf': b'another'}, (PARENT, 23): {}}
        self.writes = []
        self.reads = 0
        self.lost_response = False
        self.change_link = False
        self.corrupt = False

    def link(self, child):
        parent, version = self.links[child]
        if parent is None:
            raise MissingLink('No parent')
        return parent, version

    def parent_version(self, parent):
        return self.versions[parent]

    def names(self, kind, item):
        return set(self.files[(kind, item)])

    def content(self, kind, item, name):
        self.reads += 1
        return self.files[(kind, item)][name]

    def digest(self, kind, item, name):
        return hashlib.sha256(self.content(kind, item, name)).hexdigest()

    def put(self, parent, name, data):
        assert name not in self.files[(PARENT, parent)], 'Never overwrite'
        self.writes.append((parent, name, data))
        self.files[(PARENT, parent)][name] = b'corrupt' if self.corrupt else data
        self.versions[parent] += 'x'
        if self.change_link:
            self.links[337] = (99, 'c-new')
        if self.lost_response:
            self.lost_response = False
            raise ConnectionError('Response lost after storage')

    def children(self):
        return [{'Id': item, 'Attachments': True, 'DESCRITIVOPROVISAO': parent}
                for item, (parent, _) in self.links.items()]


class MirrorTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = Store()
        self.mirror = Mirror(self.store, Path(self.directory.name))

    def test_copy_and_repeat_verify_bytes_without_duplicate(self):
        first = self.mirror.sync(337)
        self.assertEqual((first['copied'], first['reused']), (1, 0))
        self.assertEqual(self.store.writes[0][2], b'original')
        second = self.mirror.sync(337)
        self.assertEqual((second['copied'], second['reused']), (0, 1))
        self.assertEqual(len(self.store.writes), 1)

    def test_existing_same_content_under_other_name_is_reused(self):
        self.store.files[(PARENT, 23)]['already.pdf'] = b'original'
        self.assertEqual(self.mirror.sync(337)['reused'], 1)
        self.assertEqual(self.store.writes, [])

    def test_same_name_different_content_preserves_both(self):
        self.store.files[(PARENT, 23)]['conta.pdf'] = b'preserve'
        self.mirror.sync(337)
        self.mirror.sync(326)
        self.assertEqual(set(self.store.files[(PARENT, 23)].values()), {b'original', b'another', b'preserve'})
        self.assertEqual(self.store.files[(PARENT, 23)]['conta.pdf'], b'preserve')
        self.assertEqual(len(self.store.writes), 2)

    def test_lost_response_is_recovered_without_second_upload(self):
        self.store.lost_response = True
        with self.assertRaises(ConnectionError):
            self.mirror.sync(337)
        self.assertEqual(self.mirror.sync(337)['reused'], 1)
        self.assertEqual(len(self.store.writes), 1)

    def test_missing_link_preserves_original_and_never_selects_arbitrary_parent(self):
        self.store.links[337] = (None, 'c1')
        with self.assertRaises(MissingLink):
            self.mirror.sync(337)
        self.assertEqual(self.store.files[(CHILD, 337)]['conta.pdf'], b'original')
        self.assertEqual(self.store.writes, [])

    def test_parent_missing_fails_without_upload(self):
        self.store.versions.clear()
        with self.assertRaises(KeyError):
            self.mirror.sync(337)
        self.assertEqual(self.store.writes, [])

    def test_link_changes_during_copy_is_not_confirmed(self):
        self.store.change_link = True
        with self.assertRaisesRegex(RuntimeError, 'alterad'):
            self.mirror.sync(337)

    def test_corrupt_upload_is_not_confirmed(self):
        self.store.corrupt = True
        with self.assertRaisesRegex(RuntimeError, 'SHA-256'):
            self.mirror.sync(337)

    def test_dry_run_never_writes(self):
        result = self.mirror.sync(337, dry_run=True)
        self.assertEqual(result['planned'], 1)
        self.assertEqual(self.store.writes, [])

    def test_new_file_detected_even_with_unchanged_version(self):
        cache = {}
        self.mirror.reconcile(cache, now=100)
        writes = len(self.store.writes)
        self.store.files[(CHILD, 337)]['new.pdf'] = b'new'
        self.mirror.reconcile(cache, now=101)
        self.assertEqual(len(self.store.writes), writes + 1)
        self.assertIn(b'new', self.store.files[(PARENT, 23)].values())

    def test_cache_skips_unchanged_bytes_but_hourly_check_detects_replacement(self):
        self.store.links.pop(326)
        cache = {}
        self.mirror.reconcile(cache, now=100)
        reads = self.store.reads
        result = self.mirror.reconcile(cache, now=101)
        self.assertEqual(result['cached'], 1)
        self.assertEqual(self.store.reads, reads)
        self.store.files[(CHILD, 337)]['conta.pdf'] = b'replaced'
        self.mirror.reconcile(cache, now=3701)
        self.assertIn(b'replaced', self.store.files[(PARENT, 23)].values())

    def test_partial_error_is_retried_and_does_not_hide_other_children(self):
        self.store.lost_response = True
        cache = {}
        first = self.mirror.reconcile(cache, now=100)
        self.assertEqual(len(first['errors']), 1)
        self.assertNotIn('337', cache)
        result = self.mirror.reconcile(cache, now=101)
        self.assertEqual(result['errors'], [])
        self.assertEqual(len(self.store.writes), 2)

    def test_relink_copies_to_current_parent_and_preserves_existing_files(self):
        self.mirror.sync(337)
        self.store.links[337] = (24, 'c2')
        self.store.versions[24] = 'p2'
        self.store.files[(PARENT, 24)] = {}
        self.mirror.sync(337)
        self.assertIn(b'original', self.store.files[(PARENT, 23)].values())
        self.assertIn(b'original', self.store.files[(PARENT, 24)].values())

    def test_selected_filename_missing_is_not_success(self):
        with self.assertRaises(RuntimeError):
            self.mirror.sync(337, filenames={'not-stored.pdf'})
        self.assertEqual(self.store.writes, [])

    def test_concurrent_upload_and_reconciler_share_parent_lock(self):
        put = self.store.put
        def slow_put(*args):
            time.sleep(0.03)
            return put(*args)
        self.store.put = slow_put
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.mirror.sync(337), range(2)))
        self.assertEqual(sum(result['copied'] for result in results), 1)
        self.assertEqual(len(self.store.writes), 1)

    def test_link_changes_before_upload_never_writes_old_parent(self):
        read = self.store.content
        def changing_read(*args):
            data = read(*args)
            self.store.links[337] = (99, 'new')
            return data
        self.store.content = changing_read
        with self.assertRaisesRegex(RuntimeError, 'alterad'):
            self.mirror.sync(337)
        self.assertEqual(self.store.writes, [])


class AdapterTests(unittest.TestCase):
    def test_special_source_names_survive_real_parent_upload_url(self):
        from clients import SharePointClient
        from requests import Request
        from urllib.parse import urlsplit, unquote
        for original in ('nota#123.pdf', 'nota%20.pdf', 'nota?123.pdf'):
            with self.subTest(original=original):
                name = copy_name(337, hashlib.sha256(b'file').hexdigest(), original)
                client = SharePointClient.__new__(SharePointClient)
                client.target_list = CHILD
                client._list_endpoint = lambda _: 'web/lists/getByTitle(\'parent\')'
                client._attachment_names_with_retry = lambda *a, **kw: kw.get('expected_names', set())
                captured = []
                def request(method, endpoint, **kwargs):
                    captured.append(Request(method, 'https://tenant.example/_api/' + endpoint).prepare())
                client._request = request
                SharePointStore(client).put(23, name, b'file')
                url = urlsplit(captured[0].url)
                self.assertEqual(url.fragment, '')
                self.assertEqual(url.query, '')
                self.assertIn(name, unquote(captured[0].path_url))

    def test_client_hook_also_copies_when_original_was_already_uploaded(self):
        from clients import SharePointClient
        store = Store()
        client = SharePointClient.__new__(SharePointClient)
        client.target_list = CHILD
        client._attachment_names_with_retry = lambda *a, **kw: {'conta.pdf'}
        with tempfile.TemporaryDirectory() as directory, \
                patch('provision_attachment_sync.SharePointStore', return_value=store), \
                patch('provision_attachment_sync.STATE_DIR', Path(directory)):
            client.ensure_attachment(337, 'conta.pdf', b'original')
            client.ensure_attachment(337, 'conta.pdf', b'original')
        self.assertEqual(len(store.writes), 1)
        self.assertEqual(store.writes[0][2], b'original')

    def test_non_provision_upload_does_not_touch_parent_reader(self):
        client = object()
        self.assertIsNone(sync_uploaded_attachment(client, 337, 'x.pdf', 'DOCUMENTOS'))

    def test_invalid_parent_ids_are_rejected(self):
        class Client:
            def get_item_fields_with_etag(self, *args, **kwargs):
                return {'DESCRITIVOPROVISAO': self.parent}, 'e1'
        client = Client()
        for raw in ('1;2', '23.0', True, '-1', {'Id': 23}):
            client.parent = raw
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                SharePointStore(client).link(337)

    def test_pagination_outside_original_endpoint_is_rejected(self):
        class Client:
            site_url = 'https://tenant.example/sites/company'
            def _request(self, *args, **kwargs):
                return {'value': [], '@odata.nextLink': 'https://evil.example/?secret=bad'}
        with self.assertRaises(ValueError):
            SharePointStore(Client()).collection('web/lists/items')

    def test_failed_schema_cannot_be_treated_as_empty_collection(self):
        class Client:
            site_url = 'https://tenant.example/sites/company'
            def _request(self, *args, **kwargs): return {'error': 'missing'}
        with self.assertRaises(ValueError):
            SharePointStore(Client()).collection('web/lists/items')


if __name__ == '__main__':
    unittest.main()
