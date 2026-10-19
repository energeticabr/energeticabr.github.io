"""Exercise real fanout and REST reader; only the SharePoint boundary is in memory."""
import ast
import __future__
import contextlib
import copy
import hashlib
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
import unittest
from unittest.mock import patch
from urllib.parse import unquote

ROOT = Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT'])
sys.path.insert(0, str(ROOT / 'worker'))
import provision_attachment_sync as mirror

PARENT, CHILD, LAUNCH, ORDER = mirror.PARENT, mirror.CHILD, 'LANCAMENTOS', 'NOTASPENDENTES'


class Response:
    def __init__(self, data): self.content = data
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def iter_content(self, size): yield self.content


class Client:
    site_url = 'https://synthetic.invalid/site'
    def __init__(self):
        owner = {'FORNECEDOR': 'Supplier', 'FILIAL': 'Branch'}
        self.items = {(PARENT, 7): {**owner},
            (CHILD, 11): {**owner, 'DESCRITIVOPROVISAO': '7', 'IDPEDIDO': '50', 'IDLANCAMENTOS': '60'},
            (CHILD, 12): {**owner, 'DESCRITIVOPROVISAO': '7', 'IDPEDIDO': '50', 'IDLANCAMENTOS': '61'},
            (LAUNCH, 60): {**owner, 'IDPGTOAGENDADO': '11', 'AGRUPAR': '50'},
            (LAUNCH, 61): {**owner, 'IDPGTOAGENDADO': '12', 'AGRUPAR': '50'},
            (ORDER, 50): {**owner}}
        self.files = {key: {} for key in self.items}
        self.files[PARENT, 7] = {'original.pdf': b'parent proof'}
        self.uploads = []
        self.lose = self.corrupt = False
        self.on_read = self.on_put = None
        self.gets = 0

    def get_item_fields_with_etag(self, item, fields, target_list=None):
        self.gets += 1
        return {k: self.items[target_list, item].get(k) for k in fields}, 'v1'

    def _list_endpoint(self, kind): return kind
    def _internal_field(self, kind, name): return name

    def _request(self, method, endpoint, **kwargs):
        assert method == 'GET', 'No financial writes permitted'
        self.gets += 1
        endpoint = endpoint.removeprefix(self.site_url + '/_api/')
        match = re.fullmatch(r"(.+)/items\((\d+)\)/AttachmentFiles(?:/getByFileName\('(.+)'\)/\$value)?", endpoint)
        if match:
            kind, item, name = match.groups()
            if name:
                if self.on_read: self.on_read(kind, int(item), name)
                return Response(self.files[kind, int(item)][unquote(name).replace("''", "'")])
            return {'value': [{'FileName': n} for n in self.files[kind, int(item)]]}
        kind = endpoint.removesuffix('/items')
        if kind == CHILD:
            self.last_query = kwargs['params']
            assert self.last_query['$filter'] == "DESCRITIVOPROVISAO eq '7'"
        rows = [{'Id': i, 'Attachments': bool(self.files[k, i]), **v}
                for (k, i), v in self.items.items() if k == kind
                and (k != CHILD or v['DESCRITIVOPROVISAO'] == '7')]
        return {'value': rows}

    def _ensure_attachment_local(self, item, name, data, mime_type=None, target_list=None):
        if self.on_put: self.on_put(target_list, item, name)
        files = self.files[target_list, item]
        if name not in files:
            files[name] = b'corrupt' if self.corrupt else data
            self.uploads.append((target_list, item, name))
        if self.lose:
            self.lose = False
            raise ConnectionError('stored, response lost')


class FanoutTests(unittest.TestCase):
    def setUp(self):
        self.client = Client()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.lock = patch.object(mirror, 'parent_lock', lambda *a: contextlib.nullcontext())
        self.lock.start()
        self.addCleanup(self.lock.stop)

    def sync(self, **kwargs):
        # Import here: absent behavior fails as an assertion rather than collection error.
        self.assertTrue(hasattr(mirror, 'sync_parent_attachments'), 'Parent-to-child propagation is missing')
        return mirror.sync_parent_attachments(self.client, 7, directory=self.tmp.name, **kwargs)

    def test_parent_proof_reaches_one_child_launch_and_shared_order(self):
        before = copy.deepcopy(self.client.items)
        self.sync()
        for key in ((CHILD, 11), (LAUNCH, 60), (ORDER, 50)):
            self.assertEqual(list(self.client.files[key].values()), [b'parent proof'])
        self.assertEqual(self.client.files[CHILD, 12], {})
        self.assertEqual(self.client.files[LAUNCH, 61], {})
        self.assertEqual(self.client.items, before, 'Financial fields/records must not change')

    def test_repeat_and_renamed_equal_bytes_do_not_duplicate(self):
        self.client.files[ORDER, 50]['other-name.pdf'] = b'parent proof'
        self.sync()
        self.sync()
        self.assertEqual(len(self.client.uploads), 2)
        self.assertEqual(len(self.client.files[ORDER, 50]), 1)

    def test_unpaid_has_no_financial_records_created(self):
        for i in (11, 12):
            self.client.items[CHILD, i].update(IDPEDIDO=None, IDLANCAMENTOS=None)
        for key in ((LAUNCH, 60), (LAUNCH, 61), (ORDER, 50)):
            del self.client.items[key]
        self.sync()
        self.assertEqual(len(self.client.uploads), 1)
        self.assertEqual(self.client.uploads[0][:2], (CHILD, 11))

    def test_after_settlement_new_parent_proof_reaches_existing_links(self):
        self.sync()
        self.client.files[PARENT, 7]['late.pdf'] = b'late'
        self.sync()
        self.assertEqual(len(self.client.uploads), 6)

    def test_sibling_child_mirror_is_not_redistributed(self):
        data = b'private sibling'
        name = mirror.copy_name(12, mirror.sha(data), 'row.pdf')
        self.client.files[PARENT, 7][name] = data
        self.client.files[CHILD, 12]['row.pdf'] = data
        self.sync()
        for key in ((CHILD, 11), (LAUNCH, 60), (ORDER, 50)):
            self.assertNotIn(data, self.client.files[key].values())

    def test_prefix_alone_cannot_silently_discard_a_parent_upload(self):
        self.client.files[PARENT, 7][mirror.copy_name(12, 'a'*64, 'own.pdf')] = b'not a mirror'
        self.sync()
        self.assertIn(b'not a mirror', self.client.files[LAUNCH, 60].values())

    def test_retained_child_mirror_is_quarantined_after_source_deletion(self):
        data = b'private sibling'
        name = mirror.copy_name(12, mirror.sha(data), 'row.pdf')
        self.client.files[PARENT, 7] = {name: data}
        result = self.sync()
        self.assertEqual(self.client.uploads, [])
        self.assertEqual(result['quarantined'], [name])

    def test_retained_child_mirror_is_quarantined_after_child_relink(self):
        data = b'private sibling'
        name = mirror.copy_name(12, mirror.sha(data), 'row.pdf')
        self.client.files[PARENT, 7] = {name: data}
        self.client.files[CHILD, 12]['row.pdf'] = data
        self.client.items[CHILD, 12]['DESCRITIVOPROVISAO'] = '8'
        result = self.sync()
        self.assertEqual(self.client.uploads, [])
        self.assertEqual(result['quarantined'], [name])

    def test_thirty_legacy_orders_have_linear_bounded_request_cost(self):
        self.client.items = {k: v for k, v in self.client.items.items() if k[0] == PARENT}
        self.client.files = {k: v for k, v in self.client.files.items() if k[0] == PARENT}
        owner = {'FORNECEDOR': 'Supplier', 'FILIAL': 'Branch'}
        for n in range(30):
            child, launch, order = 100+n, 200+n, 300+n
            for key, value in (((CHILD, child), {**owner, 'DESCRITIVOPROVISAO': '7', 'IDPEDIDO': str(order), 'IDLANCAMENTOS': str(launch)}),
                              ((LAUNCH, launch), {**owner, 'IDPGTOAGENDADO': str(child), 'AGRUPAR': str(order)}),
                              ((ORDER, order), owner.copy())):
                self.client.items[key] = value
                self.client.files[key] = {}
        self.sync()
        self.assertEqual(len(self.client.uploads), 61)
        self.assertLess(self.client.gets, 1500, 'Whole-group snapshots per destination cause quadratic REST traffic')

    @unittest.skipUnless(os.name == 'posix', 'Runtime file locks are POSIX; exercised on the deployed Python runtime')
    def test_parallel_parent_upload_and_timer_serialize_without_duplicate(self):
        self.lock.stop()
        def slow(*a): time.sleep(0.01)
        self.client.on_put = slow
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.sync(), range(2)))
        self.assertEqual(sum(r['copied'] for r in results), 3)
        self.assertEqual(sum(r['reused'] for r in results), 3)
        self.assertEqual(len(self.client.uploads), 3)

    def test_unrelated_existing_documents_are_preserved(self):
        self.client.files[ORDER, 50]['original.pdf'] = b'order invoice'
        self.sync()
        self.assertEqual(self.client.files[ORDER, 50]['original.pdf'], b'order invoice')
        self.assertEqual(len(self.client.files[ORDER, 50]), 2)

    def test_lost_post_response_recovers_without_second_upload(self):
        self.client.lose = True
        self.sync()
        self.sync()
        self.assertEqual(len(self.client.uploads), 3)

    def test_corruption_is_not_reported_as_success(self):
        self.client.corrupt = True
        with self.assertRaisesRegex(RuntimeError, 'SHA-256'):
            self.sync()

    def test_owner_or_reverse_link_mismatch_prevents_every_write(self):
        for kind, i, field in ((CHILD, 11, 'FILIAL'), (LAUNCH, 60, 'IDPGTOAGENDADO'),
                               (LAUNCH, 60, 'AGRUPAR'), (ORDER, 50, 'FORNECEDOR')):
            with self.subTest(kind=kind, field=field):
                self.client = Client()
                self.client.items[kind, i][field] = 'wrong'
                with self.assertRaises((RuntimeError, ValueError)):
                    self.sync()
                self.assertEqual(self.client.uploads, [])

    def test_link_changes_during_read_prevents_write(self):
        def change(*a): self.client.items[CHILD, 11]['IDPEDIDO'] = '999'
        self.client.on_read = change
        with self.assertRaisesRegex(RuntimeError, 'alterad|diverg'):
            self.sync()
        self.assertEqual(self.client.uploads, [])

    def test_source_content_changes_before_put_prevents_write(self):
        def change(*a):
            self.client.files[PARENT, 7]['original.pdf'] = b'replaced'
            self.client.on_read = None
        self.client.on_read = change
        # Reader sees changed bytes consistently; copied bytes must be the current source.
        self.sync()
        self.assertEqual(list(self.client.files[LAUNCH, 60].values()), [b'replaced'])

    def test_first_source_changed_while_copying_second_is_not_confirmed(self):
        self.client.files[PARENT, 7]['z-last.pdf'] = b'last'
        last_digest = mirror.sha(b'last')
        def change(kind, ident, name):
            if kind == LAUNCH and last_digest in name:
                self.client.files[PARENT, 7]['original.pdf'] = b'replaced late'
        self.client.on_read = change
        with self.assertRaisesRegex(RuntimeError, 'original.*alterado'):
            self.sync()

    def test_incomplete_or_multi_id_links_are_not_arbitrarily_selected(self):
        for links in (('50', None), ('50;51', '60'), ('50', '60,61')):
            self.client = Client()
            self.client.items[CHILD, 11].update(IDPEDIDO=links[0], IDLANCAMENTOS=links[1])
            with self.assertRaises((RuntimeError, ValueError)):
                self.sync()
            self.assertEqual(self.client.uploads, [])

    def test_dry_run_returns_plan_without_uploads(self):
        result = self.sync(dry_run=True)
        self.assertEqual(result['planned'], 3)
        self.assertEqual(self.client.uploads, [])

    def test_no_children_preserves_original_and_reports_pending_link(self):
        for i in (11, 12): del self.client.items[CHILD, i]
        with self.assertRaises(mirror.MissingLink): self.sync()
        self.assertEqual(self.client.uploads, [])

    def test_unlinked_parent_upload_is_preserved_for_timer_retry(self):
        for i in (11, 12): del self.client.items[CHILD, i]
        result = mirror.sync_uploaded_attachment(self.client, 7, 'original.pdf', PARENT)
        self.assertEqual(result, {'parent': 7, 'pending': 'children'})
        self.assertEqual(self.client.files[PARENT, 7]['original.pdf'], b'parent proof')

    def test_reconciler_retries_failures_and_detects_late_links(self):
        from provision_parent_fanout import reconcile
        cache = {}
        self.client.corrupt = True
        self.assertEqual(len(reconcile(self.client, cache, now=100)['errors']), 1)
        self.assertEqual(cache, {})
        self.client.corrupt = False
        self.client.files[CHILD, 11].clear()
        result = reconcile(self.client, cache, now=101)
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['copied'], 3)
        reconcile(self.client, cache, now=102)  # confirm post-write inventory
        self.assertEqual(reconcile(self.client, cache, now=103)['cached'], 1)
        self.client.files[PARENT, 7]['late.pdf'] = b'late'
        self.assertEqual(reconcile(self.client, cache, now=104)['copied'], 3)

    def test_deleted_destination_copy_is_repaired_despite_cache(self):
        from provision_parent_fanout import reconcile
        cache = {}
        reconcile(self.client, cache, now=100)
        reconcile(self.client, cache, now=101)
        self.client.files[LAUNCH, 60].clear()
        self.assertEqual(reconcile(self.client, cache, now=102)['copied'], 1)

    def test_all_legacy_linked_orders_receive_common_document(self):
        self.client.items[CHILD, 12]['IDPEDIDO'] = '51'
        self.client.items[LAUNCH, 61]['AGRUPAR'] = '51'
        self.client.items[ORDER, 51] = copy.deepcopy(self.client.items[ORDER, 50])
        self.client.files[ORDER, 51] = {}
        self.sync()
        self.assertEqual(len(self.client.uploads), 5)
        self.assertEqual(list(self.client.files[ORDER, 51].values()), [b'parent proof'])

    def test_client_upload_hook_runs_for_description_after_original_confirmation(self):
        # Execute the actual method without importing the large app/runtime dependencies.
        tree = ast.parse((ROOT / 'worker/clients.py').read_text(encoding='utf-8'))
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'SharePointClient')
        method = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == 'ensure_attachment')
        import unicodedata
        def normalize(s): return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c)).lower()
        namespace = {'normalize_text': normalize, '__name__': 'clients', '__package__': ''}
        exec(compile(ast.Module(body=[method], type_ignores=[]), '<real hook>', 'exec',
                     flags=__future__.annotations.compiler_flag), namespace)
        order = []
        self.client.target_list = PARENT
        self.client._ensure_attachment_local = lambda *a: order.append('original')
        with patch.object(mirror, 'sync_uploaded_attachment', side_effect=lambda *a: order.append('sync')):
            namespace['ensure_attachment'](self.client, 7, 'original.pdf', b'parent proof')
        self.assertEqual(order, ['original', 'sync'])

    def test_group_settlement_transfers_preexisting_parent_proof_before_paid(self):
        import importlib.util
        source = Path(__file__).resolve().parents[2] / 'payroll-row-attachments/tests/test_propagation.py'
        spec = importlib.util.spec_from_file_location('settlement_fixture', source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        f = module.Fixture()
        f.client.files[PARENT, 7]['parent-proof.pdf'] = b'common parent proof'
        self.assertEqual(f.commit()['status'], 'completed')
        self.assertIn(b'common parent proof', f.files_for(CHILD, 11).values())
        self.assertIn(b'common parent proof', f.files_for(LAUNCH, f.launch(11)).values())
        self.assertNotIn(b'common parent proof', f.files_for(LAUNCH, f.launch(12)).values())
        self.assertIn(b'common parent proof', f.files_for(ORDER, f.order()).values())
        records, uploads = copy.deepcopy(f.client.tokens), len(f.client.uploads)
        self.assertEqual(f.commit()['status'], 'completed')
        self.assertEqual(f.client.tokens, records)
        self.assertEqual(len(f.client.uploads), uploads)


if __name__ == '__main__': unittest.main()
