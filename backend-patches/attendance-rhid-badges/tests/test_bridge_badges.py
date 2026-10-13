import ast
from datetime import date
import importlib.util
from pathlib import Path
import re
import threading
from types import SimpleNamespace
import unittest

PATCH = Path(__file__).resolve().parents[1] / 'patch_bridge.py'
spec = importlib.util.spec_from_file_location('patch_bridge', PATCH)
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)
BASELINE = Path(__file__).resolve().parent / 'fixtures/bridge_rhid_report.py.txt'

class BridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = patch.patch_bridge(BASELINE.read_text(encoding='utf-8'))
        parsed = ast.parse(source)
        method = next(node for node in ast.walk(parsed) if isinstance(node, ast.FunctionDef) and node.name == 'portal_rhid_attendance_report')
        module = ast.Module(body=[method], type_ignores=[])
        cls.namespace = {'date': date, 're': re, 'normalize_text': lambda value: value.lower()}
        exec(compile(module, str(BASELINE), 'exec'), cls.namespace)
        cls.method = staticmethod(cls.namespace['portal_rhid_attendance_report'])
        cls.source = source

    def setup_bridge(self):
        self.events = []
        def authorize(*args, **kwargs): self.events.append('authorize')
        def sp_rows(day):
            self.events.append('sharepoint_rows')
            return [{'Id': 1, 'ID_PESSOA_RHID': '9', 'NOME_COLABORADOR': 'ANA', 'DATA_REFERENCIA': day.isoformat(), 'BATIDAS_RHID': '07:00;12:00'}]
        def pending(day):
            self.events.append('pending_read')
            return [{'Id': 101, 'FORNECEDOR': 'ANA', 'DATA': day.isoformat(), 'PRESENCA': 'PENDENTE'}]
        def badge(day):
            self.events.append('rhid_read')
            return {'date': day, 'rows': [{'Id': 'rhid:9', 'ID_PESSOA_RHID': '9', 'NOME_COLABORADOR': 'ANA',
                'DATA_REFERENCIA': day, 'BATIDAS_RHID': ['07:00', '12:00', '13:00', '16:30']}],
                'registration': {'complete': True, 'people': [{'id': '9', 'name': 'ANA'}]}}
        self.namespace['get_rhid_badge_report'] = badge
        return SimpleNamespace(lock=threading.Lock(), _portal_state=lambda identity: ('owner', {'active': True}),
            portal_owners=SimpleNamespace(authorize=authorize),
            engine=SimpleNamespace(sharepoint=SimpleNamespace(get_rhid_attendance_report=sp_rows, get_pending_attendance=pending)),
            rhid_attendance_adjustments=SimpleNamespace(latest_for_day=lambda day: {'rhid:9': {'exit2': {'time': '17:00'}}}))

    def test_badge_query_is_authorized_then_reads_clock_and_preserves_adjustments_and_links(self):
        bridge = self.setup_bridge()
        report = self.method(bridge, {}, '2026-10-05', allowed_emails={'owner'}, include_registration=True)['attendanceReport']
        self.assertEqual(self.events, ['authorize', 'rhid_read', 'pending_read'])
        self.assertTrue(report['registration']['complete'])
        self.assertEqual(report['rows'][0]['pendingPresenceIds'], ['101'])
        self.assertEqual(report['rows'][0]['ADMIN_AJUSTES']['exit2']['time'], '17:00')
        self.assertEqual(report['rows'][0]['BATIDAS_RHID'][-1], '16:30')

    def test_original_daily_report_does_not_change_its_source(self):
        bridge = self.setup_bridge()
        report = self.method(bridge, {}, '2026-10-05', allowed_emails={'owner'})['attendanceReport']
        self.assertEqual(self.events, ['authorize', 'sharepoint_rows', 'pending_read'])
        self.assertNotIn('registration', report)
        self.assertEqual(report['rows'][0]['BATIDAS_RHID'], '07:00;12:00')

    def test_authorization_failure_never_reads_rhid(self):
        bridge = self.setup_bridge()
        bridge.portal_owners.authorize = lambda *args, **kwargs: (_ for _ in ()).throw(PermissionError('blocked'))
        with self.assertRaises(PermissionError): self.method(bridge, {}, '2026-10-05', allowed_emails=set(), include_registration=True)
        self.assertEqual(self.events, [])

    def test_invalid_date_never_authenticates_or_reads(self):
        bridge = self.setup_bridge()
        with self.assertRaises(ValueError): self.method(bridge, {}, '2026-02-30', allowed_emails={'owner'}, include_registration=True)
        self.assertEqual(self.events, [])

    def test_http_opt_in_requires_a_true_boolean_and_patch_rejects_drift(self):
        self.assertIn('include_registration=body.get("includeRegistration") is True', self.source)
        with self.assertRaises(ValueError): patch.patch_bridge(self.source)

if __name__ == '__main__': unittest.main()
