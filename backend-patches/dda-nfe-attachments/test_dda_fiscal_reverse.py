import copy
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
import dda_fiscal_worker as worker
from test_dda_fiscal_worker import Store, Bridge, PDF
from test_dda_fiscal_reconcile import bill, note


class ReverseBridge(Bridge):
    def __init__(self, notes):
        super().__init__(notes)
        self.files = {}; self.writes = 0; self.reverse_calls = 0

    def ensure_dda_pdf(self, item_id, filename, content, expected_key):
        self.reverse_calls += 1
        key = (item_id, filename)
        status = 'already_linked' if key in self.files else 'linked'
        if key not in self.files:
            self.files[key] = content; self.writes += 1
        if self.files[key] != content:
            raise ValueError('CONFLICTING_DDA_ATTACHMENT')
        return {'status': status, 'record': copy.deepcopy(self.notes[0])}


class ReverseTests(unittest.TestCase):
    def setup_case(self, rows=None, notes=None):
        store = Store(rows or [bill()])
        store.files['Espelho_DDA_0123456789abcdef.pdf'] = PDF
        bridge = ReverseBridge(notes or [note(Modified='2026-11-01T00:00:00Z')])
        return store, bridge

    def test_copies_only_original_dda_and_rerun_is_idempotent(self):
        store, bridge = self.setup_case()
        store.files['invoice.pdf'] = PDF
        store.files['DANFE-other.pdf'] = PDF
        before = copy.deepcopy(store.rows)
        first = worker.reconcile(store, bridge, True)
        self.assertEqual(len(first['reverse_receipts']), 1)
        self.assertEqual(list(bridge.files), [(70, 'DDA-1-Espelho_DDA_0123456789abcdef.pdf')])
        second = worker.reconcile(store, bridge, True)
        self.assertEqual(second['reverse_receipts'][0]['status'], 'already_linked')
        self.assertEqual(bridge.writes, 1)
        self.assertEqual(store.rows, before)

    def test_multiple_installments_and_multiple_originals_are_all_copied(self):
        store, bridge = self.setup_case([bill(1,'4'),bill(2,'6')])
        store.files['Espelho_DDA_fedcba9876543210.pdf'] = PDF + b'\n'
        result = worker.reconcile(store, bridge, True)
        self.assertEqual(len(result['reverse_receipts']), 4)
        self.assertEqual(bridge.writes, 4)

    def test_same_name_conflict_preserves_existing_destination(self):
        store, bridge = self.setup_case()
        key = (70, 'DDA-1-Espelho_DDA_0123456789abcdef.pdf')
        bridge.files[key] = PDF + b'conflict'
        result = worker.reconcile(store, bridge, True)
        self.assertEqual(bridge.files[key], PDF + b'conflict')
        self.assertEqual(result['reverse_reviews'][0]['code'], 'CONFLICTING_DDA_ATTACHMENT')
        self.assertEqual(result['reverse_receipts'], [])

    def test_new_competing_dda_prevents_reverse_write_even_when_forward_cached(self):
        store, bridge = self.setup_case()
        original = store.read_pdf
        def read(item_id, name):
            raw = original(item_id, name)
            if name.startswith('Espelho_') and len(store.rows) == 1:
                store.rows.append(bill(2))
            return raw
        store.read_pdf = read
        result = worker.reconcile(store, bridge, True)
        self.assertEqual(bridge.writes, 0)
        self.assertTrue(any(e['code']=='MATCH_CHANGED_BEFORE_REVERSE_WRITE' for e in result['reverse_errors']))

    def test_budget_deferred_is_not_cached_as_done_and_next_run_retries(self):
        store, bridge = self.setup_case(); progress = {}
        with patch.object(worker, 'MAX_REVERSE_CHECKS', 0):
            first = worker.reconcile(store, bridge, True, progress)
        self.assertEqual(first['reverse_deferred'], 1)
        self.assertFalse(progress['70'].get('reverse', {}).get('verified_at'))
        second = worker.reconcile(store, bridge, True, progress)
        self.assertEqual(len(second['reverse_receipts']), 1)

    def test_source_changed_invalidates_reverse_cache(self):
        store, bridge = self.setup_case(); progress = {}
        worker.reconcile(store, bridge, True, progress)
        store.files['Espelho_DDA_0123456789abcdef.pdf'] = PDF + b'changed'
        result = worker.reconcile(store, bridge, True, progress)
        self.assertEqual(result['reverse_reviews'][0]['code'], 'CONFLICTING_DDA_ATTACHMENT')

    def test_readback_mismatch_is_never_success(self):
        bridge = worker.FiscalBridge({'uri':'https://test.api.powerplatform.com/workflows/123abc/triggers/manual?sig=secret'})
        import base64
        with patch.object(bridge, 'call', return_value={'status':'linked','content':{'$content':base64.b64encode(PDF+b'bad').decode()},'record':note()}):
            with self.assertRaisesRegex(ValueError, 'DDA_PDF_READBACK_MISMATCH'):
                bridge.ensure_dda_pdf(70,'DDA-1-Espelho_DDA_0123456789abcdef.pdf',PDF,'3'*44)

    def test_unchanged_source_and_fiscal_revision_use_bounded_cache(self):
        store, bridge = self.setup_case(); progress = {}
        worker.reconcile(store, bridge, True, progress)
        calls = bridge.reverse_calls
        result = worker.reconcile(store, bridge, True, progress)
        self.assertEqual(bridge.reverse_calls, calls)
        self.assertEqual(result['reverse_verified_from_cache'], 1)

    def test_expiring_bridge_budget_defers_without_marking_done(self):
        import time
        store, bridge = self.setup_case(); progress = {}
        bridge.deadline = time.monotonic() + 2
        original = store.read_pdf
        def read(item_id, name):
            self.assertFalse(name.startswith('Espelho_DDA_'), 'expired work must not download source PDFs')
            return original(item_id, name)
        store.read_pdf = read
        result = worker.reconcile(store, bridge, True, progress)
        self.assertEqual(result['reverse_deferred'], 1)
        self.assertFalse(progress['70']['reverse'].get('verified_at'))
        self.assertEqual(bridge.writes, 0)

    def test_zero_reverse_budget_does_not_download_originals(self):
        store, bridge = self.setup_case()
        original = store.read_pdf
        reads = []
        def read(item_id, name):
            if name.startswith('Espelho_DDA_'): reads.append(name)
            return original(item_id, name)
        store.read_pdf = read
        with patch.object(worker, 'MAX_REVERSE_CHECKS', 0):
            worker.reconcile(store, bridge, True)
        self.assertEqual(reads, [])

    def test_cached_manifest_downloads_share_the_link_budget(self):
        import hashlib
        store, bridge = self.setup_case()
        now = datetime.now(timezone.utc)
        links = [{'fiscal_id':i, 'dda_ids':[i], 'amount_cents':1000} for i in range(1,10)]
        notes = [note(i, Modified='revision') for i in range(1,10)]
        progress = {str(i):{'reverse':{'revision':'revision','verified_at':now.isoformat(),
            'manifest':[{'dda_id':i,'source_name':'Espelho_DDA_0123456789abcdef.pdf',
                         'filename':f'DDA-{i}-Espelho_DDA_0123456789abcdef.pdf',
                         'sha256':hashlib.sha256(PDF).hexdigest(),'bytes':len(PDF)}]}} for i in range(1,10)}
        result = dict(reverse_checks=0,reverse_deferred=0,reverse_verified_from_cache=0,
                      reverse_receipts=[],reverse_errors=[],reverse_reviews=[])
        original=store.read_pdf; reads=[]
        def read(item_id,name):
            reads.append(item_id);return original(item_id,name)
        store.read_pdf=read
        with patch.object(worker,'MAX_REVERSE_CHECKS',2):
            worker.reconcile_reverse(store,bridge,links,notes,progress,result,now)
        self.assertEqual(reads,[1,2])
        self.assertEqual(result['reverse_verified_from_cache'],2)
        self.assertEqual(result['reverse_deferred'],7)


if __name__ == '__main__': unittest.main()
