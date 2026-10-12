"""Offline regressions against the real attendance engine; no remote HR writes."""
import copy
import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

if os.environ.get("ATTENDANCE_WORKFLOW"):
    spec = importlib.util.spec_from_file_location("workflow", os.environ["ATTENDANCE_WORKFLOW"])
    module = importlib.util.module_from_spec(spec)
    sys.modules["workflow"] = module
    spec.loader.exec_module(module)
import test_workflow as fixtures

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pending-attendance-checkboxes"))
import test_pending_attendance_selection as pending


class AttendanceReturnTests(unittest.TestCase):
    setUp = fixtures.WorkflowTests.setUp
    reply = fixtures.WorkflowTests.reply
    start_attendance_validation = fixtures.WorkflowTests.start_attendance_validation
    open_pending = pending.PendingAttendanceSelectionTests.open_pending
    current = pending.PendingAttendanceSelectionTests.current

    def remaining_rows(self):
        template = copy.deepcopy(self.sharepoint.options_by_key["registro_presenca_pendente"][0])
        rows = []
        for item_id, supplier, day, presence in (
            (1814, "FORNECEDOR TESTE", "2026-07-31T03:00:00Z", "PENDENTE"),
            (1816, "ALFA", "2026-07-31T03:00:00Z", "PENDENTE"),
            (1817, "BETA", "2026-07-31T03:00:00Z", "PENDENTE"),
            (1818, "OUTRA DATA", "2026-08-03T03:00:00Z", "PENDENTE"),
            (1819, "JÁ VALIDADO", "2026-07-31T03:00:00Z", "PRESENTE"),
        ):
            row = copy.deepcopy(template)
            row.update(id=item_id, value=str(item_id), title=f"{item_id} - {supplier}")
            row["source_values"].update(Id=item_id, FORNECEDOR=supplier, DATA=day, PRESENCA=presence)
            rows.append(row)
            self.sharepoint.items[item_id] = {"fields": copy.deepcopy(row["source_values"]), "attachments": {}, "target_list": "DESCRITIVOPRESENCA"}
        self.sharepoint.options_by_key["registro_presenca_pendente"] = rows
        self.sharepoint.options_by_key["presenca_pendente_continuacao"] = copy.deepcopy(rows)
        return rows

    def assert_scoped_checklist(self):
        poll = self.messenger.sent[-1]
        self.assertEqual(poll.get("presentation"), "attendance_multi_select")
        self.assertIn("31/07/2026", poll["prompt"])
        self.assertEqual([row["value"] for row in self.current()["options"] if not row.get("terminal_option")], ["1816", "1817"])
        self.assertEqual(self.current()["stage"], "choosing_pending_attendance_record")
        self.assertEqual(self.current()["pending_attendance_date_value"][:10], "2026-07-31")

    def test_confirmation_returns_only_last_day_with_checkbox_protocol(self):
        self.start_attendance_validation()
        self.remaining_rows()
        self.reply("2")
        result = self.reply("SIM")
        self.assertEqual(result["status"], "awaiting_pending_attendance_record")
        self.assertEqual(result["sharepoint_item_id"], 1814)
        self.assert_scoped_checklist()
        context = [context for key, context in self.sharepoint.option_calls if key == "registro_presenca_pendente"][-1]
        self.assertEqual(context["DATA FILTRO PRESENÇA"][:10], "2026-07-31")

    def test_edit_and_apply_to_others_keeps_day_and_batch_can_proceed(self):
        self.start_attendance_validation()
        rows = self.remaining_rows()
        self.sharepoint.options_by_key["attendance_supplier_sync_presence"] = [copy.deepcopy(rows[1])]
        self.sharepoint.options_by_key["fornecedor_sincronizacao_atividade_presenca"] = [{"id": 777, "title": "FORNECEDOR TESTE", "value": "777", "source_values": {"Id": 777, "CADASTRO": "FORNECEDOR TESTE", "FILIAL": "001 - OURO PRETO"}}]
        self.sharepoint.options_by_key["fornecedor_sincronizacao_atividade_presenca"].append({"id": 778, "title": "ALFA", "value": "778", "source_values": {"Id": 778, "CADASTRO": "ALFA", "FILIAL": "001 - OURO PRETO"}})
        self.sharepoint.options_by_key["editar_iddescritivoetapa_presenca"][1]["source_values"]["FILIAL"] = "001 - OURO PRETO"
        self.reply("1")
        self.reply("9")
        self.assertEqual(self.reply("405").get("field"), "editar_atividade_presenca")
        self.assertEqual(self.reply("409").get("field"), "sincronizar_atividade_fornecedor_presenca")
        self.reply(reply_id="supplier_sync_target:1816")
        result = self.reply(reply_id="finish_supplier_sync")
        self.assertEqual(result.get("field"), "revisar_dados_presenca", repr((result, self.messenger.sent[-2])))
        self.assertTrue(any(call["item_id"] == 1816 for call in self.sharepoint.update_calls), repr((self.sharepoint.update_calls, self.messenger.sent[-1])))
        self.reply("2")
        self.reply("SIM")
        self.assert_scoped_checklist()
        writes = len(self.sharepoint.update_calls)
        result = self.reply(reply_id="attendance_batch:1816,1817")
        self.assertEqual(result["status"], "awaiting_attendance_batch_action")
        self.assertEqual(len(self.sharepoint.update_calls), writes)
        self.assertEqual(self.reply(reply_id="navigation_back")["status"], "awaiting_pending_attendance_record")
        self.assert_scoped_checklist()

    def test_pending_individual_selection_retains_day_filter_for_edits(self):
        self.open_pending()
        self.reply(reply_id="pending_attendance_edit:1814")
        self.assertEqual(self.current()["fields"].get("DATA FILTRO PRESENÇA"), "2026-07-31T03:00:00Z")
        self.assertEqual(self.sharepoint.update_calls, [])

    def test_return_excludes_other_dates_and_already_validated_rows(self):
        self.open_pending()
        self.remaining_rows()
        result = self.reply(reply_id="pending_attendance_present:1814")
        self.assertEqual(result["status"], "awaiting_pending_attendance_record")
        self.assert_scoped_checklist()

    def test_empty_day_offers_date_picker_instead_of_mixing_other_days(self):
        self.start_attendance_validation()
        rows = self.remaining_rows()
        self.sharepoint.options_by_key["registro_presenca_pendente"] = [rows[0], rows[3], rows[4]]
        self.reply("2")
        result = self.reply("SIM")
        self.assertEqual(result["status"], "awaiting_pending_attendance_date")
        self.assertEqual(self.current()["stage"], "choosing_pending_attendance_date")
        self.assertFalse(any(row.get("value") == "1818" for row in self.messenger.sent[-1]["options"]))

    def test_confirmed_batch_and_back_do_not_reoffer_stale_completed_rows(self):
        self.open_pending()
        self.remaining_rows()
        # The fake SharePoint query intentionally keeps the pre-write snapshot.
        self.reply(reply_id="attendance_batch:1814,1815")
        self.reply(reply_id="attendance_batch_present")
        self.assertEqual(self.reply(reply_id="attendance_batch_confirm")["updated_count"], 2)
        self.assert_scoped_checklist()
        self.reply(reply_id="attendance_batch:1816,1817")
        self.reply(reply_id="navigation_back")
        self.assert_scoped_checklist()

    def test_explicit_other_date_clears_old_completion_scope(self):
        self.start_attendance_validation()
        self.remaining_rows()
        self.reply("2")
        self.reply("SIM")
        self.assert_scoped_checklist()
        self.reply(reply_id="pending_attendance_other_date")
        self.assertNotIn("pending_attendance_completed_ids", self.current())
        self.assertIsNone(self.current()["pending_attendance_date_value"])

    def test_consultive_report_date_does_not_replace_last_evaluated_day(self):
        self.start_attendance_validation()
        self.remaining_rows()
        self.current()["attendance_daily_report_requested_date"] = "2026-08-03"
        self.reply("2")
        self.reply("SIM")
        self.assert_scoped_checklist()

    def test_text_filter_after_edit_keeps_day_checkbox_and_does_not_write(self):
        self.start_attendance_validation()
        self.remaining_rows()
        self.reply("2")
        self.reply("SIM")
        writes = len(self.sharepoint.update_calls)
        result = self.reply("ALFA")
        self.assertEqual(result["status"], "filtered_pending_attendance_records")
        self.assertEqual(self.messenger.sent[-1]["presentation"], "attendance_multi_select")
        self.assertEqual([option["value"] for option in self.current()["options"] if not option.get("terminal_option")], ["1816"])
        self.assertEqual(self.current()["pending_attendance_date_value"], "2026-07-31")
        self.assertEqual(len(self.sharepoint.update_calls), writes)

    def test_concurrent_alert_at_return_keeps_scope_without_repeating_hr_write(self):
        class ConflictStore(fixtures.MemoryStateStore):
            inject = False
            injected = False

            def save(store, key, state, etag):
                if store.inject and not store.injected and state.get("stage") == "choosing_pending_attendance_record":
                    store.injected = True
                    latest, latest_etag = store.load(key)
                    latest.setdefault("processed_message_ids", []).append("concurrent-alert-event")
                    latest["pending_stale_stage_alert"] = {"count": 1}
                    super().save(key, latest, latest_etag)
                    raise RuntimeError("etag conflict")
                return super().save(key, state, etag)

        self.state = ConflictStore()
        self.engine.state_store = self.state
        self.start_attendance_validation()
        self.remaining_rows()
        self.reply("2")
        self.state.inject = True
        result = self.reply("SIM")
        self.assertTrue(self.state.injected)
        self.assertEqual(result["status"], "awaiting_pending_attendance_record")
        self.assert_scoped_checklist()
        self.assertIn("concurrent-alert-event", self.current()["processed_message_ids"])
        self.assertEqual(len([call for call in self.sharepoint.update_calls if call["target_list"] == "DESCRITIVOPRESENCA" and call["item_id"] == 1814]), 1)


if __name__ == "__main__":
    with patch("requests.sessions.Session.request", side_effect=AssertionError("Network forbidden in offline QA")):
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(AttendanceReturnTests))
        raise SystemExit(not result.wasSuccessful())
