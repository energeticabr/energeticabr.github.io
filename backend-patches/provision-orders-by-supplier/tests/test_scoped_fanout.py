"""Attachment ownership guards stay strict outside the settlement snapshot."""
import os
import copy
import sys
import tempfile
import unittest
from pathlib import Path

if not os.getenv('ENERGETICA_BACKEND_TEST_ROOT'):
    raise unittest.SkipTest('Requires an isolated backend source snapshot')
ROOT = Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT'])
sys.path[:0] = [str(ROOT / 'worker'), str(ROOT / 'tests')]
import test_parent_fanout as fixtures
from provision_parent_fanout import sync


class ScopedFanoutTests(unittest.TestCase):
    def setUp(self):
        self.client = fixtures.Client()
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.client.items[fixtures.CHILD, 12]['FORNECEDOR'] = 'Second supplier'
        self.client.items[fixtures.CHILD, 12]['IDPEDIDO'] = '51'
        self.client.items[fixtures.LAUNCH, 61].update(FORNECEDOR='Second supplier', AGRUPAR='51')
        self.client.items[fixtures.ORDER, 51] = {'FORNECEDOR': 'Second supplier', 'FILIAL': 'Branch'}
        self.client.files[fixtures.ORDER, 51] = {}
        self.owners = {str(i): {key: self.client.items[fixtures.CHILD, i][key]
                               for key in ('FORNECEDOR', 'FILIAL')} for i in (11, 12)}
        self.parent_owner = copy.deepcopy(self.client.items[fixtures.PARENT, 7])

    def sync(self, **kwargs):
        if kwargs.get('expected_owners') is not None:
            kwargs['expected_parent_owner'] = self.parent_owner
        return sync(self.client, 7, directory=Path(self.directory.name), **kwargs)

    def test_default_path_still_refuses_cross_supplier_group(self):
        with self.assertRaisesRegex(RuntimeError, 'fornecedor/filial'):
            self.sync()
        self.assertFalse(self.client.uploads)

    def test_exact_frozen_owners_allow_separate_valid_financial_links(self):
        self.sync(expected_owners=self.owners)
        self.assertIn(b'parent proof', self.client.files[fixtures.ORDER, 50].values())
        self.assertIn(b'parent proof', self.client.files[fixtures.ORDER, 51].values())

    def test_added_or_removed_child_refuses_before_any_copy(self):
        self.owners.pop('12')
        with self.assertRaisesRegex(RuntimeError, 'provisões'):
            self.sync(expected_owners=self.owners)
        self.assertFalse(self.client.uploads)

    def test_owner_changed_after_frozen_snapshot_refuses_before_copy(self):
        self.client.items[fixtures.CHILD, 12]['FORNECEDOR'] = 'Tampered supplier'
        with self.assertRaisesRegex(RuntimeError, 'fornecedor/filial'):
            self.sync(expected_owners=self.owners)
        self.assertFalse(self.client.uploads)

    def test_wrong_financial_destination_refuses_before_copy(self):
        self.client.items[fixtures.ORDER, 51]['FORNECEDOR'] = 'Wrong supplier'
        with self.assertRaisesRegex(RuntimeError, 'financeiro divergente'):
            self.sync(expected_owners=self.owners)
        self.assertFalse(self.client.uploads)

    def test_later_uploads_and_repair_reuse_only_the_saved_exact_scope(self):
        self.sync(expected_owners=self.owners)
        self.client.files[fixtures.ORDER, 51].clear()
        self.client.files[fixtures.PARENT, 7]['later.pdf'] = b'later group proof'
        self.sync()
        for ident in (50, 51):
            self.assertIn(b'parent proof', self.client.files[fixtures.ORDER, ident].values())
            self.assertIn(b'later group proof', self.client.files[fixtures.ORDER, ident].values())

    def test_saved_scope_never_authorizes_a_changed_child_supplier(self):
        self.sync(expected_owners=self.owners)
        self.client.items[fixtures.CHILD, 12]['FORNECEDOR'] = 'Tampered supplier'
        uploads = len(self.client.uploads)
        with self.assertRaisesRegex(RuntimeError, 'fornecedor/filial'):
            self.sync()
        self.assertEqual(len(self.client.uploads), uploads)

    def test_saved_scope_never_authorizes_a_changed_parent_owner(self):
        self.sync(expected_owners=self.owners)
        self.client.items[fixtures.PARENT, 7]['FORNECEDOR'] = 'Changed reference'
        with self.assertRaisesRegex(RuntimeError, 'descritivo mudou'):
            self.sync()

    def test_dry_run_does_not_persist_a_new_scope(self):
        self.sync(expected_owners=self.owners, dry_run=True)
        with self.assertRaisesRegex(RuntimeError, 'fornecedor/filial'):
            self.sync()

    def test_explicit_final_fanout_cannot_reauthorize_a_changed_parent(self):
        self.sync(expected_owners=self.owners)
        scope_file = Path(self.directory.name) / 'settlement-owners/parent-7.json'
        before = scope_file.read_bytes()
        self.client.items[fixtures.PARENT, 7]['FORNECEDOR'] = 'Changed reference'
        with self.assertRaisesRegex(RuntimeError, 'descritivo mudou'):
            self.sync(expected_owners=self.owners)
        self.assertEqual(scope_file.read_bytes(), before)

    def test_diversos_shared_order_keeps_launch_owners_individual(self):
        self.client.items[fixtures.PARENT, 7]['FORNECEDOR'] = 'DIVERSOS'
        self.parent_owner = copy.deepcopy(self.client.items[fixtures.PARENT, 7])
        self.client.items[fixtures.CHILD, 12]['IDPEDIDO'] = '50'
        self.client.items[fixtures.LAUNCH, 61]['AGRUPAR'] = '50'
        self.client.items[fixtures.ORDER, 50]['FORNECEDOR'] = 'DIVERSOS'
        self.sync(expected_owners=self.owners)
        self.assertIn(b'parent proof', self.client.files[fixtures.ORDER, 50].values())
        self.assertEqual(self.client.items[fixtures.LAUNCH, 60]['FORNECEDOR'], 'Supplier')
        self.assertEqual(self.client.items[fixtures.LAUNCH, 61]['FORNECEDOR'], 'Second supplier')
        self.client.files[fixtures.ORDER, 50].clear()
        self.sync()
        self.assertIn(b'parent proof', self.client.files[fixtures.ORDER, 50].values())

    def test_diversos_order_without_diversos_parent_is_refused(self):
        self.client.items[fixtures.ORDER, 50]['FORNECEDOR'] = 'DIVERSOS'
        with self.assertRaisesRegex(RuntimeError, 'financeiro divergente'):
            self.sync(expected_owners=self.owners)
        self.assertFalse(self.client.uploads)

    def test_order_owner_cannot_change_to_diversos_during_copy(self):
        self.client.items[fixtures.PARENT, 7]['FORNECEDOR'] = 'DIVERSOS'
        self.parent_owner = copy.deepcopy(self.client.items[fixtures.PARENT, 7])
        def change_owner(kind, ident, name):
            if kind == fixtures.PARENT:
                self.client.items[fixtures.ORDER, 50]['FORNECEDOR'] = 'DIVERSOS'
        self.client.on_read = change_owner
        with self.assertRaisesRegex(RuntimeError, 'alterad'):
            self.sync(expected_owners=self.owners)
        self.assertFalse(self.client.uploads)


if __name__ == '__main__':
    unittest.main()
