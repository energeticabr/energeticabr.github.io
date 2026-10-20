import ast
import copy
from datetime import date
import importlib
import os
from pathlib import Path
import sys
import threading
from types import SimpleNamespace
import unittest

ROOT = Path(os.environ['RHID_REMOVAL_SOURCE'])
sys.path.insert(0, str(ROOT))
sys.path.append(str(Path(__file__).parent))
from rhid_manual_punch_removal import delete_for_bridge
from test_removal import ACTOR, DAY, Store, revision
adjustments = importlib.import_module('rhid_attendance_adjustments')
calendar = importlib.import_module('rhid_calendar_snapshot')

class WiringTests(unittest.TestCase):
    def test_daily_and_calendar_do_not_revive_a_withdrawn_revision(self):
        rows = [revision(40), revision(), revision(100, Title='EXCLUSAO-AJUSTE-47', HORARIO_CORRIGIDO='')]
        store = adjustments.SharePointRhidAttendanceAdjustmentStore(None)
        store._items = lambda query: copy.deepcopy(rows)
        self.assertEqual(store.latest_for_day(DAY), {})
        self.assertEqual(store.dates_with_adjustments(date(2020, 10, 1), date(2020, 11, 1)), set())
        person = {'Id': 10, 'ID_PESSOA_RHID': '23', 'DATA_REFERENCIA': DAY.isoformat(), 'BATIDAS_RHID': '06:55;13:00;17:06'}
        result = calendar.monthly_effective_rows([person], store, date(2020, 10, 1), date(2020, 11, 1))
        self.assertNotIn('ADMIN_AJUSTES', result[0])
        self.assertEqual(result[0]['BATIDAS_RHID'], person['BATIDAS_RHID'])
    def test_monthly_keeps_other_slots_and_new_revision_after_withdrawal(self):
        rows = [revision(), revision(49, CAMPO='entry2', HORARIO_CORRIGIDO='13:05'),
                revision(100, Title='EXCLUSAO-AJUSTE-47', HORARIO_CORRIGIDO=''), revision(101, HORARIO_CORRIGIDO='12:10')]
        store = SimpleNamespace(_items=lambda query: rows)
        result = calendar.monthly_effective_rows([{'Id': 10, 'ID_PESSOA_RHID': '23', 'DATA_REFERENCIA': DAY.isoformat()}], store,
                                                 date(2020, 10, 1), date(2020, 11, 1))
        self.assertEqual({k: v['time'] for k, v in result[0]['ADMIN_AJUSTES'].items()}, {'exit1': '12:10', 'entry2': '13:05'})
    def bridge(self, denied=False, person='23'):
        store = Store([revision()])
        calls = []
        def report(identity, day, **kwargs):
            calls.append((identity, day, kwargs))
            if denied:
                raise PermissionError('not authorized')
            return {'attendanceReport': {'rows': [{'Id': 10, 'ID_PESSOA_RHID': person}]}}
        return SimpleNamespace(portal_rhid_attendance_report=report, lock=threading.Lock(), rhid_attendance_adjustments=store), calls
    def test_route_authorizes_before_any_write_and_never_selects_another_person(self):
        for denied, person in [(True, '23'), (False, '99')]:
            bridge, calls = self.bridge(denied, person)
            with self.subTest(denied=denied):
                with self.assertRaises((ValueError, PermissionError)):
                    delete_for_bridge(bridge, ACTOR, DAY.isoformat(), 'rhid:23', 'exit1', '47', allowed_emails={'allowed'})
                self.assertEqual(len(calls), 1)
                self.assertFalse(bridge.rhid_attendance_adjustments.writes)
    def test_future_or_invalid_date_does_not_even_consult_the_report(self):
        for day in ['2999-10-15', '2020-02-31', 'not-a-date']:
            bridge, calls = self.bridge()
            with self.subTest(day=day), self.assertRaises(ValueError):
                delete_for_bridge(bridge, ACTOR, day, 'rhid:23', 'exit1', '47', allowed_emails=set())
            self.assertFalse(calls)
    def test_real_http_dispatch_forwards_authenticated_identity_and_exact_revision(self):
        tree = ast.parse((ROOT / 'channel_bridge.py').read_text())
        branches = [n for n in ast.walk(tree) if isinstance(n, ast.If) and isinstance(n.test, ast.Compare)
                    and any(isinstance(c, ast.Constant) and c.value == 'rhid_attendance_adjust_delete' for c in n.test.comparators)]
        self.assertEqual(len(branches), 1, 'the real authenticated handler must recognize deletion')
        bridge, calls = self.bridge()
        namespace = {'delete_for_bridge': delete_for_bridge, 'identity': ACTOR,
                     'self': SimpleNamespace(bridge=bridge, portal_authenticator=SimpleNamespace(allowed_emails={'allowed'})),
                     'body': {'date': DAY.isoformat(), 'personKey': 'rhid:23', 'slot': 'exit1', 'revisionId': '47', 'identity': {'oid': 'attacker'}}}
        exec(compile(ast.Module(body=branches[0].body, type_ignores=[]), 'real-dispatch', 'exec'), namespace)
        self.assertEqual(namespace['result']['attendanceAdjustmentDeletion'], {'deleted': True, 'revisionId': '47'})
        self.assertEqual(calls[0][0], ACTOR)
        self.assertEqual(calls[0][2], {'allowed_emails': {'allowed'}})
        self.assertEqual(len(bridge.rhid_attendance_adjustments.writes), 1)

if __name__ == '__main__':
    unittest.main()
