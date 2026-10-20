import copy
from datetime import date
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parent))
from rhid_manual_punch_removal import latest_active_rows, remove_manual_adjustment

DAY = date(2020, 10, 15)
ACTOR = {'oid': 'actor-1', 'name': 'Bernardo', 'email': 'bernardo@example.test'}

def revision(item_id=47, **extra):
    return {'Id': item_id, 'Title': 'AJUSTE-x', 'DATA_REFERENCIA': DAY.isoformat(),
            'ID_PESSOA_RHID': 'rhid:23', 'CAMPO': 'exit1', 'HORARIO_CORRIGIDO': '12:00',
            'RESPONSAVEL': 'Bernardo | bernardo@example.test | actor-1', **extra}

class Store:
    LIST_TITLE = 'RHID AJUSTES DE PONTO'
    def __init__(self, rows):
        self.rows, self.writes, self.filters = copy.deepcopy(rows), [], []
        self.sharepoint = self
    def _items(self, query):
        self.filters.append(query)
        return copy.deepcopy(self.rows)
    def ensure_item(self, title, fields, list_title, key, attachments):
        self.writes.append((title, fields, list_title, key, attachments))
        self.rows.append({'Id': 100, 'Title': title, **fields})
        return 100

class RemovalTests(unittest.TestCase):
    def test_removal_clears_all_older_adjustments_for_only_that_slot(self):
        rows = [revision(40), revision(), revision(48, CAMPO='exit2', HORARIO_CORRIGIDO='17:00')]
        store = Store(rows)
        self.assertEqual(remove_manual_adjustment(store, DAY, 'rhid:23', 'exit1', '47', ACTOR), {'deleted': True, 'revisionId': '47'})
        active = latest_active_rows(store.rows)
        self.assertEqual([row['Id'] for row in active], [48])
        self.assertEqual(store.rows[:3], rows, 'history is never edited/deleted')
        title, fields, target, key, attachments = store.writes[0]
        self.assertEqual((title, target, key, attachments), ('EXCLUSAO-AJUSTE-47', 'RHID AJUSTES DE PONTO', 'Title', False))
        self.assertEqual(fields['HORARIO_CORRIGIDO'], '')
        self.assertEqual(store.filters, ["DATA_REFERENCIA eq '2020-10-15'"])
    def test_retry_after_lost_response_does_not_append_again_or_clear_a_new_adjustment(self):
        store = Store([revision()])
        remove_manual_adjustment(store, DAY, 'rhid:23', 'exit1', '47', ACTOR)
        store.rows.append(revision(101, HORARIO_CORRIGIDO='12:05'))
        self.assertTrue(remove_manual_adjustment(store, DAY, 'rhid:23', 'exit1', '47', ACTOR)['deleted'])
        self.assertEqual(len(store.writes), 1)
        self.assertEqual([row['Id'] for row in latest_active_rows(store.rows)], [101])
    def test_stale_revision_is_not_allowed_to_delete_a_newer_adjustment(self):
        store = Store([revision(), revision(48)])
        with self.assertRaisesRegex(ValueError, 'Atualize'):
            remove_manual_adjustment(store, DAY, 'rhid:23', 'exit1', '47', ACTOR)
        self.assertFalse(store.writes)
    def test_owner_oid_cannot_be_spoofed_by_email(self):
        store = Store([revision()])
        with self.assertRaises(PermissionError):
            remove_manual_adjustment(store, DAY, 'rhid:23', 'exit1', '47', {**ACTOR, 'oid': 'other'})
        self.assertFalse(store.writes)
    def test_missing_or_wrong_identity_date_person_slot_revision_never_writes(self):
        for person, slot, item, actor in [('rhid:99', 'exit1', '47', ACTOR), ('rhid:23', 'entry1', '47', ACTOR),
                ('rhid:23', 'exit1', '*', ACTOR), ('rhid:23', 'exit1', True, ACTOR), ('rhid:23', 'exit1', '47', {})]:
            with self.subTest(person=person, slot=slot, item=item, actor=actor):
                store = Store([revision()])
                with self.assertRaises((ValueError, PermissionError)):
                    remove_manual_adjustment(store, DAY, person, slot, item, actor)
                self.assertFalse(store.writes)
    def test_empty_hours_without_valid_deletion_marker_do_not_clear_history(self):
        self.assertEqual([r['Id'] for r in latest_active_rows([revision(), revision(48, HORARIO_CORRIGIDO='')])], [47])
    def test_stale_marker_cannot_clear_different_revision_or_other_person(self):
        rows = [revision(), revision(48), revision(100, Title='EXCLUSAO-AJUSTE-47', HORARIO_CORRIGIDO=''),
                revision(101, Title='EXCLUSAO-AJUSTE-48', HORARIO_CORRIGIDO='', ID_PESSOA_RHID='rhid:99')]
        self.assertEqual([r['Id'] for r in latest_active_rows(rows)], [48])
    def test_new_manual_revision_can_be_added_after_removal(self):
        store = Store([revision()])
        remove_manual_adjustment(store, DAY, 'rhid:23', 'exit1', '47', ACTOR)
        store.rows.append(revision(102))
        self.assertEqual([r['Id'] for r in latest_active_rows(store.rows)], [102])

if __name__ == '__main__':
    unittest.main()
