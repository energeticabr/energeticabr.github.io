import ast
from datetime import date
from pathlib import Path
import unittest
import rhid_calendar_snapshot as calendar


class CalendarTests(unittest.TestCase):
    def test_overlay_uses_latest_valid_revision_and_does_not_leak_audit(self):
        class Store:
            def _items(self, query):
                self.query = query
                return [
                    {"Id": 2, "DATA_REFERENCIA": "2026-09-28", "ID_PESSOA_RHID": "rhid:1", "CAMPO": "exit2", "HORARIO_CORRIGIDO": "17:01", "Created": "new", "RESPONSAVEL": "private"},
                    {"Id": 1, "DATA_REFERENCIA": "2026-09-28", "ID_PESSOA_RHID": "rhid:1", "CAMPO": "exit2", "HORARIO_CORRIGIDO": "17:00"},
                    {"Id": 3, "DATA_REFERENCIA": "2026-10-01", "ID_PESSOA_RHID": "rhid:1", "CAMPO": "exit2", "HORARIO_CORRIGIDO": "17:02"},
                ]
        store = Store()
        rows = [{"Id": 9, "ID_PESSOA_RHID": "1", "NOME_COLABORADOR": "Teste", "DATA_REFERENCIA": "2026-09-28", "BATIDAS_RHID": "07:00", "secret": "private"}, {"Id": 10, "DATA_REFERENCIA": "2026-10-01"}]
        result = calendar.monthly_effective_rows(rows, store, date(2026, 9, 1), date(2026, 10, 1))
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["ADMIN_AJUSTES"], {"exit2": {"time": "17:01", "adjustedAt": "new"}})
        self.assertNotIn("secret", result[0])
        self.assertNotIn("ADMIN_AJUSTES", rows[0])
        self.assertIn("DATA_REFERENCIA ge '2026-09-01'", store.query)

    def test_snapshot_adjustments_fail_closed(self):
        class Store:
            def _items(self, query):
                raise RuntimeError("SharePoint indisponível")
        with self.assertRaises(RuntimeError):
            calendar.monthly_effective_rows([], Store(), date(2026, 9, 1), date(2026, 10, 1))

    def test_bridge_returns_effective_rows_only_after_authorization(self):
        import os, re, threading
        from datetime import timedelta
        from types import SimpleNamespace
        source = Path(os.environ["RHID_BRIDGE_SOURCE"]).read_text(encoding="utf-8")
        tree = ast.parse(source)
        method = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "portal_rhid_attendance_month")
        space = {"date": date, "timedelta": timedelta, "re": re}
        exec(compile(ast.Module(body=[method], type_ignores=[]), "bridge", "exec"), space)
        calls = []
        class Owner:
            def authorize(self, *args, **kwargs):
                calls.append("authorize")
        class SP:
            def get_report_rows(self, flow, filters):
                self.fields = [c["field"] for c in flow["columns"]]
                calls.append("read")
                return [{"Id": 1, "ID_PESSOA_RHID": "7", "NOME_COLABORADOR": "Teste", "DATA_REFERENCIA": "2026-09-28", "BATIDAS_RHID": "07:00"}]
        class Store:
            def _items(self, query): return []
            def dates_with_adjustments(self, first, next): return set()
        sp = SP()
        bridge = SimpleNamespace(lock=threading.Lock(), _portal_state=lambda identity: ("x", {}), portal_owners=Owner(), engine=SimpleNamespace(sharepoint=sp), rhid_attendance_adjustments=Store())
        result = space["portal_rhid_attendance_month"](bridge, {}, "2026-09", allowed_emails=set())
        self.assertEqual(calls, ["authorize", "read"])
        self.assertEqual(result["attendanceMonth"]["rows"][0]["ID_PESSOA_RHID"], "7")
        self.assertIn("ID_PESSOA_RHID", sp.fields)


if __name__ == "__main__":
    unittest.main()
