"""Offline emitted-payload regressions; use the current worker and test fixtures on PYTHONPATH."""
import copy
import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

if os.environ.get("ATTENDANCE_WORKFLOW"):
    workflow_path = Path(os.environ["ATTENDANCE_WORKFLOW"]).resolve()
    spec = importlib.util.spec_from_file_location("workflow", workflow_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["workflow"] = module
    spec.loader.exec_module(module)

import test_workflow as fixtures

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pending-attendance-checkboxes"))
import test_pending_attendance_selection as pending

class AttendanceSummaryDatesTests(unittest.TestCase):
    setUp = fixtures.WorkflowTests.setUp
    reply = fixtures.WorkflowTests.reply
    open_pending = pending.PendingAttendanceSelectionTests.open_pending
    current = pending.PendingAttendanceSelectionTests.current

    def open_batch(self):
        self.open_pending()
        result = self.reply(reply_id="attendance_batch:1814,1815")
        self.assertEqual(result["status"], "awaiting_attendance_batch_action")
        self.assertEqual(self.sharepoint.update_calls, [])

    def set_summary_sources(self, sources):
        # Selection validation intentionally accepts only one date. Exercise
        # the confirmation renderer on controlled mixed/stale snapshots,
        # without weakening that validation or manufacturing a new engine.
        template = self.current()["attendance_batch_records"][0]
        records = []
        for index, source in enumerate(sources):
            record = copy.deepcopy(template)
            record.update(id=1814 + index, value=str(1814 + index))
            record["source_values"].update(Id=1814 + index, **source)
            if "DATA" not in source:
                record["source_values"].pop("DATA", None)
            records.append(record)
        self.current()["attendance_batch_records"] = records
        return copy.deepcopy(records)

    def confirm_present(self):
        result = self.reply(reply_id="attendance_batch_present")
        self.assertEqual(result["status"], "awaiting_attendance_batch_confirmation")
        self.assertEqual(self.sharepoint.update_calls, [])
        payload = self.messenger.sent[-1]
        self.assertEqual(payload["type"], "actions")
        self.assertEqual(payload["detail_table"]["kind"], "presence")
        return payload

    def test_mixed_source_dates_precede_each_supplier_in_real_payload(self):
        # Catches omission/reordering, ISO formatting, timezone conversion,
        # and replacing all dates with the selected filter date.
        self.open_batch()
        original = self.set_summary_sources([
            {"DATA": "2026-07-31", "FORNECEDOR": "DATA SIMPLES"},
            {"DATA": "2026-08-03T03:00:00Z", "FORNECEDOR": "UTC"},
            {"DATA": "2026-08-04T00:30:00Z", "FORNECEDOR": "UTC MEIA NOITE"},
            {"DATA": "2026-08-05T23:30:00-03:00", "FORNECEDOR": "LOCAL"},
            {"DATA": "06/08/2026", "FORNECEDOR": "BRASILEIRA"},
            {"DATA": "07/08/2026 23:30:00", "FORNECEDOR": "BRASILEIRA COM HORA"},
            {"DATA": " 2026-08-08T03:00:00Z ", "FORNECEDOR": "COM ESPACOS"},
        ])
        payload = self.confirm_present()
        rows = payload["detail_table"]["rows"]
        self.assertEqual(len(rows), 7)
        self.assertEqual(
            [[cell["label"] for cell in row[:2]] for row in rows],
            [["DATA", "FORNECEDOR"]] * 7,
        )
        self.assertEqual(
            [[cell["value"] for cell in row[:2]] for row in rows],
            [
                ["31/07/2026", "DATA SIMPLES"],
                ["03/08/2026", "UTC"],
                ["04/08/2026", "UTC MEIA NOITE"],
                ["05/08/2026", "LOCAL"],
                ["06/08/2026", "BRASILEIRA"],
                ["07/08/2026", "BRASILEIRA COM HORA"],
                ["08/08/2026", "COM ESPACOS"],
            ],
        )
        self.assertEqual(self.current()["attendance_batch_records"], original)

    def test_text_confirmation_places_formatted_date_before_every_supplier(self):
        # Catches a date cell added only to one transport/presentation.
        self.open_batch()
        self.set_summary_sources([
            {"DATA": "2026-07-31T03:00:00Z", "FORNECEDOR": "PRIMEIRO"},
            {"DATA": "03/08/2026", "FORNECEDOR": "SEGUNDO"},
        ])
        payload = self.confirm_present()
        lines = payload["body"].splitlines()[1:]
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("31/07/2026 | PRIMEIRO | "), lines[0])
        self.assertTrue(lines[1].startswith("03/08/2026 | SEGUNDO | "), lines[1])
        self.assertNotIn("T03:00:00Z", payload["body"])

    def test_empty_and_missing_source_dates_render_dash_without_invented_date(self):
        # Catches a fallback to today, a global date or another item's date.
        self.open_batch()
        self.set_summary_sources([
            {"DATA": None, "FORNECEDOR": "NULA"},
            {"DATA": "", "FORNECEDOR": "VAZIA"},
            {"DATA": " \t ", "FORNECEDOR": "ESPACOS"},
            {"FORNECEDOR": "SEM CHAVE"},
        ])
        state = self.current()
        state["fields"]["DATA"] = "2040-01-02"
        state["display_values"]["DATA"] = "02/01/2040"
        state["attendance_batch_changes"] = {"DATA": "2041-02-03"}
        payload = self.confirm_present()
        rows = payload["detail_table"]["rows"]
        self.assertEqual([row[0] for row in rows], [{"label": "DATA", "value": "-"}] * 4)
        self.assertEqual(
            [line.split(" | ")[:2] for line in payload["body"].splitlines()[1:]],
            [["-", "NULA"], ["-", "VAZIA"], ["-", "ESPACOS"], ["-", "SEM CHAVE"]],
        )

    def test_source_dates_survive_unrelated_filter_and_edit_values(self):
        # Catches accidental use of state fields or batch changes for DATA.
        self.open_batch()
        self.set_summary_sources([
            {"DATA": "2026-07-31", "FORNECEDOR": "PRIMEIRO"},
            {"DATA": "2026-08-03T03:00:00Z", "FORNECEDOR": "SEGUNDO"},
        ])
        state = self.current()
        state["fields"].update({"DATA": "2040-01-02", "DATA FILTRO PRESENÇA": "2040-01-02"})
        state["display_values"]["DATA"] = "02/01/2040"
        state["attendance_batch_changes"] = {"DATA": "2041-02-03", "ATIVIDADEEXECUTADA": "ATIVIDADE EDITADA"}
        payload = self.confirm_present()
        rows = payload["detail_table"]["rows"]
        self.assertEqual([row[0]["value"] for row in rows], ["31/07/2026", "03/08/2026"])
        self.assertTrue(all(next(cell["value"] for cell in row if cell["label"] == "ATIVIDADEEXECUTADA") == "ATIVIDADE EDITADA" for row in rows))

    def test_pending_present_confirmation_retains_content_and_submission_gate(self):
        # Catches displaced/dropped existing cells or an early submission.
        self.open_batch()
        payload = self.confirm_present()
        self.assertEqual([row[0] for row in payload["detail_table"]["rows"]], [{"label": "DATA", "value": "31/07/2026"}] * 2)
        self.assertEqual(
            [[cell["label"] for cell in row] for row in payload["detail_table"]["rows"]],
            [["DATA", "FORNECEDOR", "IDDESCRITIVO", "ATIVIDADEEXECUTADA", "PRESENÇA"]] * 2,
        )
        self.assertEqual(
            [[cell["value"] for cell in row[1:]] for row in payload["detail_table"]["rows"]],
            [
                ["FORNECEDOR TESTE", "119 - PADRÃO DO DEMONSTRATIVO", "MONTAGEM DE FORMAS", "PRESENTE"],
                ["SEGUNDO", "119 - PADRÃO DO DEMONSTRATIVO", "MONTAGEM DE FORMAS", "PRESENTE"],
            ],
        )
        self.assertEqual([row[-1]["tone"] for row in payload["detail_table"]["rows"]], ["present", "present"])
        self.assertIn("attendance_batch_confirm", [action["id"] for action in payload["actions"]])
        self.assertIn("attendance_batch_cancel", [action["id"] for action in payload["actions"]])
        self.assertNotIn("_outbound_detail_table", self.current())
        self.assertEqual(self.sharepoint.update_calls, [])

    def test_pending_absent_confirmation_also_shows_each_date_before_supplier(self):
        # Catches a date implemented only on the PRESENTE branch.
        self.open_batch()
        self.assertEqual(self.reply(reply_id="attendance_batch_absent")["status"], "awaiting_attendance_batch_motivation")
        self.assertEqual(self.reply("FALTA SEM JUSTIFICATIVA")["status"], "awaiting_attendance_batch_confirmation")
        payload = self.messenger.sent[-1]
        rows = payload["detail_table"]["rows"]
        self.assertEqual([row[0] for row in rows], [{"label": "DATA", "value": "31/07/2026"}] * 2)
        self.assertEqual([row[1]["label"] for row in rows], ["FORNECEDOR", "FORNECEDOR"])
        self.assertEqual([row[-1] for row in rows], [{"label": "PRESENÇA", "value": "AUSENTE", "tone": "absent"}] * 2)
        self.assertEqual(self.sharepoint.update_calls, [])


if __name__ == "__main__":
    with patch("requests.sessions.Session.request", side_effect=AssertionError("Network forbidden in offline QA")):
        unittest.main()

