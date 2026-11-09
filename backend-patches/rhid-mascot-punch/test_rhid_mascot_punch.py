"""Exercise the real bridge and validator from an isolated VM staging copy."""
import ast
import json
import os
from datetime import date, datetime
from pathlib import Path
from threading import Lock
from types import SimpleNamespace
import unittest
from zoneinfo import ZoneInfo


def source_function(path, name, scope, *, helpers=False):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    method = next(node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and node.name == name)
    definitions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                   and node.name.startswith("_rhid_missing_")] if helpers else []
    exec(compile(ast.Module(body=[*definitions, method], type_ignores=[]), str(path), "exec"), scope)
    return scope[name]


class FrozenClock(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 11, 9, 13, 21, tzinfo=tz)


class RhidMascotPunchTest(unittest.TestCase):
    def setUp(self):
        import re

        base = Path(os.environ["RHID_SOURCE_DIR"])
        validator = base / "rhid_attendance_adjustments.py"
        order = ("entry1", "exit1", "entry2", "exit2")
        validate = source_function(validator, "validate_adjustment_against_rhid", {
            "date": date, "json": json, "re": re, "SLOT_ORDER": order, "SLOTS": set(order),
            "TIME_PATTERN": re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$"),
        }, helpers=True)
        self.adjust = source_function(base / "channel_bridge.py", "portal_rhid_attendance_adjust", {
            "date": date, "datetime": FrozenClock, "ZoneInfo": ZoneInfo,
            "validate_adjustment_against_rhid": validate,
        })
        self.rows = [{"ID_PESSOA_RHID": "12", "NOME_COLABORADOR": "Pessoa fictícia", "BATIDAS_RHID": "07:13;12:55"}]
        self.existing = {}
        self.writes = []
        self.bridge = SimpleNamespace(
            lock=Lock(), rhid_adjustment_lock=Lock(), _portal_state=lambda _: ("fixture", {}),
            portal_owners=SimpleNamespace(authorize=lambda *args, **kwargs: None),
            engine=SimpleNamespace(sharepoint=SimpleNamespace(get_rhid_attendance_report=lambda _: self.rows)),
            rhid_attendance_adjustments=SimpleNamespace(
                latest_for_day=lambda _: {"rhid:12": self.existing}, save=self.save),
        )

    def save(self, day, person, slot, time, reason, *_):
        self.writes.append((day, person, slot, time, reason))
        self.existing[slot] = {"time": time}
        return self.existing[slot]

    def submit(self, slot, time, *, day="2026-11-09", **kwargs):
        return self.adjust(self.bridge, {}, day, "rhid:12", slot, time, "Teste",
                           allowed_emails=set(), **kwargs)

    def test_mascot_fills_an_elapsed_gap_today_once(self):
        result = self.submit("exit1", "11:58", fill_missing=True)
        self.assertEqual(result["attendanceAdjustment"]["time"], "11:58")
        with self.assertRaisesRegex(ValueError, "preenchid"):
            self.submit("exit1", "11:58", fill_missing=True)
        self.assertEqual(len(self.writes), 1)

    def test_current_editor_keeps_its_cutoff(self):
        with self.assertRaisesRegex(ValueError, "encerrado"):
            self.submit("exit1", "11:58")
        self.assertFalse(self.writes)

    def test_mascot_cannot_fill_a_future_time_or_day(self):
        with self.assertRaisesRegex(ValueError, "futuro"):
            self.submit("exit2", "13:22", fill_missing=True)
        with self.assertRaises(ValueError):
            self.submit("exit1", "11:58", day="2026-11-10", fill_missing=True)
        self.assertFalse(self.writes)

    def test_mascot_cannot_replace_a_clock_punch_or_reverse_times(self):
        with self.assertRaisesRegex(ValueError, "preenchid"):
            self.submit("entry1", "07:14", fill_missing=True)
        with self.assertRaisesRegex(ValueError, "cronológica"):
            self.submit("exit1", "13:00", fill_missing=True)
        self.assertFalse(self.writes)

    def test_legacy_unpadded_punch_also_protects_the_slot(self):
        self.rows[0]["BATIDAS_RHID"] = "7:13;12:55"
        with self.assertRaisesRegex(ValueError, "preenchid"):
            self.submit("entry1", "07:14", fill_missing=True)
        self.assertFalse(self.writes)

    def test_stale_report_cannot_replace_a_new_clock_punch_outside_the_regular_band(self):
        self.rows[0]["BATIDAS_RHID"] = [
            {"dataHora": "2026-11-09T07:00:00-03:00"}, {"dataHora": "2026-11-09T11:30:00-03:00"},
            {"dataHora": "2026-11-09T14:15:00-03:00"}, {"dataHora": "2026-11-09T17:00:00-03:00"},
        ]
        with self.assertRaisesRegex(ValueError, "preenchid"):
            self.submit("entry2", "13:00", fill_missing=True)
        self.assertFalse(self.writes)

    def test_shifted_lunch_protects_the_reclassified_departure(self):
        self.rows[0]["BATIDAS_RHID"] = '["07:00","12:45","13:45","17:00"]'
        with self.assertRaisesRegex(ValueError, "preenchid"):
            self.submit("exit1", "12:00", fill_missing=True)
        self.assertFalse(self.writes)

    def test_outside_band_neighbor_still_blocks_out_of_order_adjustment(self):
        self.rows[0]["BATIDAS_RHID"] = "07:00;14:15;17:00"
        with self.assertRaisesRegex(ValueError, "cronológica"):
            self.submit("exit1", "14:16", day="2026-11-08", fill_missing=True)
        self.assertFalse(self.writes)


if __name__ == "__main__":
    unittest.main()
