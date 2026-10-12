"""Offline regressions using the real engine and its in-memory test fixtures."""
import copy
import argparse
import unittest
from unittest.mock import patch

import test_workflow as fixtures


class PendingAttendanceSelectionTests(unittest.TestCase):
    setUp = fixtures.WorkflowTests.setUp
    reply = fixtures.WorkflowTests.reply

    def open_pending(self):
        second = copy.deepcopy(self.sharepoint.options_by_key["registro_presenca_pendente"][0])
        second.update(id=1815, value="1815", title="1815 - SEGUNDO")
        second["source_values"].update(Id=1815, FORNECEDOR="SEGUNDO")
        self.sharepoint.options_by_key["registro_presenca_pendente"].append(second)
        for option in self.sharepoint.options_by_key["registro_presenca_pendente"]:
            self.sharepoint.items[int(option["value"])] = {
                "fields": copy.deepcopy(option["source_values"]),
                "attachments": {}, "target_list": "DESCRITIVOPRESENCA",
            }
        self.reply("OPA")
        self.reply("PENDÊNCIAS")
        self.reply("VALIDAR PRESENÇAS")
        self.reply(reply_id="pending_attendance_date:1")

    def current(self):
        return next(iter(self.state.values.values()))[0]

    def test_pending_poll_uses_multi_selection_and_keeps_other_date(self):
        self.open_pending()
        poll = self.messenger.sent[-1]
        self.assertEqual(poll["presentation"], "attendance_multi_select")
        self.assertIn("31/07/2026", poll["prompt"])
        self.assertTrue(any(option["id"] == "pending_attendance_other_date" for option in poll["options"]))
        self.assertEqual(self.sharepoint.update_calls, [])
        self.current()["current_flow_title"] = "ADICIONAR UM NOVO DOCUMENTO"
        self.assertEqual(self.engine.active_flow_status(self.current())["title"], "👷 VALIDAR PRESENÇAS APONTADAS")

    def test_batch_requires_confirmation_then_returns_to_same_pending_date(self):
        self.open_pending()
        self.assertEqual(self.reply(reply_id="attendance_batch:1814,1815")["status"], "awaiting_attendance_batch_action")
        self.assertEqual(self.current()["attendance_batch_origin"], "pending")
        self.assertEqual(self.reply(reply_id="attendance_batch_present")["status"], "awaiting_attendance_batch_confirmation")
        self.assertEqual(self.sharepoint.update_calls, [])
        # Leave another pending record in the list so the same date remains open.
        self.sharepoint.options_by_key["registro_presenca_pendente"] = [
            {"id": 1816, "value": "1816", "title": "TERCEIRO", "source_values": {
                "Id": 1816, "FORNECEDOR": "TERCEIRO", "DATA": "2026-07-31T03:00:00Z", "PRESENCA": "PENDENTE",
            }},
        ]
        result = self.reply(reply_id="attendance_batch_confirm")
        self.assertEqual(result["status"], "awaiting_pending_attendance_record")
        self.assertEqual(result["updated_count"], 2)
        self.assertEqual([call["item_id"] for call in self.sharepoint.update_calls], [1814, 1815])
        self.assertTrue(all(call["fields"] == {"PRESENCA": "PRESENTE"} for call in self.sharepoint.update_calls))
        self.assertEqual(self.current()["pending_attendance_date_value"], "2026-07-31T03:00:00Z")
        self.assertEqual(self.current()["stage"], "choosing_pending_attendance_record")

    def test_single_checked_id_opens_existing_pending_review_without_write(self):
        self.open_pending()
        result = self.reply(reply_id="attendance_batch:1814")
        self.assertEqual(result["status"], "awaiting_pending_attendance_action")
        self.assertEqual(self.current()["pending_attendance_record_id"], "1814")
        self.assertEqual(self.sharepoint.update_calls, [])

    def test_back_from_batch_restores_pending_checklist_and_date_without_write(self):
        self.open_pending()
        self.reply(reply_id="attendance_batch:1814,1815")
        result = self.reply(reply_id="navigation_back")
        self.assertEqual(result["status"], "awaiting_pending_attendance_record")
        self.assertEqual(self.current()["stage"], "choosing_pending_attendance_record")
        self.assertNotIn("attendance_batch_records", self.current())
        self.assertEqual(self.current()["pending_attendance_date_value"], "2026-07-31T03:00:00Z")
        self.assertEqual(self.sharepoint.update_calls, [])

    def test_unknown_id_is_rejected_and_checklist_remains_available(self):
        self.open_pending()
        result = self.reply(reply_id="attendance_batch:1814,99999")
        self.assertEqual(result["status"], "invalid_attendance_batch_selection")
        self.assertEqual(self.current()["stage"], "choosing_pending_attendance_record")
        self.assertEqual(self.messenger.sent[-1]["presentation"], "attendance_multi_select")
        self.assertEqual(self.sharepoint.update_calls, [])

    def test_mixed_dates_and_already_validated_records_are_rejected_without_writes(self):
        for invalid_source in ({"DATA": "2026-08-03T03:00:00Z"}, {"PRESENCA": "PRESENTE"}):
            with self.subTest(invalid_source=invalid_source):
                self.setUp()
                self.open_pending()
                self.current()["options"][1]["source_values"].update(invalid_source)
                # Use the real selector with this controlled stale snapshot.
                state = self.current()
                etag = next(iter(self.state.values.values()))[1]
                result = self.engine._start_attendance_batch(
                    {"reply_id": "attendance_batch:1814,1815"}, state, etag,
                    self.config["sharepoint"]["attendance_validation_flow"]["steps"][1],
                )
                self.assertEqual(result["status"], "invalid_attendance_batch_selection")
                self.assertEqual(self.sharepoint.update_calls, [])
                self.assertNotIn("attendance_batch_records", state)

    def test_absence_asks_reason_and_confirmation_before_any_write(self):
        self.open_pending()
        self.reply(reply_id="attendance_batch:1814,1815")
        self.assertEqual(self.reply(reply_id="attendance_batch_absent")["status"], "awaiting_attendance_batch_motivation")
        self.assertEqual(self.reply("FALTA SEM JUSTIFICATIVA")["status"], "awaiting_attendance_batch_confirmation")
        self.assertEqual(self.sharepoint.update_calls, [])
        self.assertTrue(all(row[3]["value"] == "AUSENTE" for row in self.messenger.sent[-1]["detail_table"]["rows"]))

    def test_other_date_after_back_does_not_keep_batch_selection(self):
        self.open_pending()
        self.reply(reply_id="attendance_batch:1814,1815")
        self.reply(reply_id="navigation_back")
        self.assertEqual(self.reply(reply_id="pending_attendance_other_date")["status"], "awaiting_pending_attendance_date")
        self.assertIsNone(self.current()["pending_attendance_date_value"])
        self.assertNotIn("attendance_batch_origin", self.current())
        self.assertEqual(self.sharepoint.update_calls, [])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--include-existing", action="store_true")
    parser.add_argument("--existing-only", action="store_true")
    args = parser.parse_args()
    suite = unittest.TestSuite() if args.existing_only else unittest.defaultTestLoader.loadTestsFromTestCase(PendingAttendanceSelectionTests)
    if args.include_existing or args.existing_only:
        suite.addTests(fixtures.WorkflowTests(name) for name in unittest.defaultTestLoader.getTestCaseNames(fixtures.WorkflowTests)
                       if name.startswith(("test_attendance_batch_", "test_pending_attendance_")))
    # Make an accidental HTTP call fail, even if future fixtures change.
    with patch("requests.sessions.Session.request", side_effect=AssertionError("Network forbidden in offline QA")):
        result = unittest.TextTestRunner(verbosity=1).run(suite)
        raise SystemExit(not result.wasSuccessful())
