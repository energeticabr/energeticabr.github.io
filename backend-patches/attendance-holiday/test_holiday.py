"""Exercise the real workflow with the existing in-memory external services."""
import copy
import os
from pathlib import Path
import sys
import unittest

SOURCE = Path(os.environ["ATTENDANCE_HOLIDAY_SOURCE"]).resolve()
sys.path.insert(0, str(SOURCE / "tests"))
import test_workflow as fixtures
from clients import MetaMessenger


class HolidayTests(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.WorkflowTests("runTest")
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)

    def start_single(self):
        self.case.start_attendance_validation()

    def start_batch(self):
        c = self.case
        second = copy.deepcopy(c.sharepoint.options_by_key["registro_presenca_pendente"][0])
        second.update(id=1815, value="1815", title="1815 - FORNECEDOR DE TESTE BETA")
        second["source_values"].update(Id=1815, FORNECEDOR="FORNECEDOR DE TESTE BETA")
        c.sharepoint.options_by_key["registro_presenca_pendente"].append(second)
        for option in c.sharepoint.options_by_key["registro_presenca_pendente"]:
            c.sharepoint.items[int(option["value"])] = {
                "fields": copy.deepcopy(option["source_values"]),
                "attachments": {}, "target_list": "DESCRITIVOPRESENCA",
            }
        c.reply("OPA")
        c.reply("RECURSOS HUMANOS")
        c.reply("VALIDAR PRESENÇAS APONTADAS")
        c.reply("1814")
        c.reply(reply_id="attendance_batch:1814,1815")

    def test_holiday_button_is_between_absent_and_deletion(self):
        self.start_single()
        options = self.case.messenger.sent[-1]["options"]
        values = [option.get("value") for option in options]
        index = values.index("AUSENTE")
        self.assertEqual(values[index + 1:index + 3], ["FERIADO", "EXCLUIR"])
        self.assertEqual(str(options[index + 1]["id"]), "4")
        self.assertEqual(str(options[index + 2]["id"]), "5")

    def test_holiday_button_fills_reason_and_waits_for_confirmation(self):
        self.start_single()
        result = self.case.reply(reply_id="choice:revisar_dados_presenca:4")
        self.assertEqual(result["status"], "awaiting_confirmation")
        summary = self.case.summary_text()
        self.assertIn("*MOTIVAÇÃO:* FERIADO", summary)
        self.assertIn("*PRESENÇA:* ❌ AUSENTE", summary)
        self.assertEqual(self.case.sharepoint.update_calls, [])
        self.assertNotIn(1814, self.case.sharepoint.items)

    def test_holiday_number_four_saves_existing_holiday_rule_only_after_yes(self):
        self.start_single()
        result = self.case.reply("4")
        self.assertEqual(result["status"], "awaiting_confirmation")
        self.assertNotIn(1814, self.case.sharepoint.items)
        self.case.reply("SIM")
        fields = self.case.sharepoint.items[1814]["fields"]
        self.assertEqual(fields["PRESENCA"], "AUSENTE")
        self.assertEqual(fields["MOTIVACAO"], "FERIADO")
        self.assertEqual(fields["VLORDIARIO"], "0")
        self.assertEqual(fields["IDPGTO"], "AUSENTE")

    def test_existing_absent_choice_still_asks_for_reason(self):
        self.start_single()
        result = self.case.reply("3")
        self.assertEqual(result["field"], "motivacao_ausencia_presenca")
        self.assertEqual(self.case.sharepoint.update_calls, [])

    def test_old_saved_menu_keeps_its_original_deletion_id(self):
        self.start_single()
        c = self.case
        key, (state, etag) = next(iter(c.state.values.items()))
        step = next(step for step in c.engine._flow_config(state)["steps"]
                    if step["key"] == "revisar_dados_presenca")
        state["options"] = copy.deepcopy(step["source"]["options"])
        c.state.save(key, state, etag)
        result = c.reply(reply_id="choice:revisar_dados_presenca:4")
        self.assertEqual(result["status"], "awaiting_attendance_deletion_confirmation")
        self.assertEqual(c.sharepoint.update_calls, [])

    def test_new_menu_deletion_id_five_still_requires_confirmation(self):
        self.start_single()
        result = self.case.reply(reply_id="choice:revisar_dados_presenca:5")
        self.assertEqual(result["status"], "awaiting_attendance_deletion_confirmation")
        self.assertEqual(self.case.sharepoint.update_calls, [])

    def test_new_menu_does_not_mutate_root_specific_configuration(self):
        original = copy.deepcopy(self.case.engine.config)
        self.start_single()
        self.assertEqual(self.case.engine.config, original)

    def test_batch_holiday_appears_below_absent(self):
        self.start_batch()
        actions = [action["id"] for action in self.case.messenger.sent[-1]["options"]]
        self.assertEqual(actions[actions.index("attendance_batch_absent") + 1], "attendance_batch_holiday")

    def test_meta_batch_lists_keep_holiday_and_edit_actions_with_routable_ids(self):
        self.start_batch()
        c = self.case
        _key, (state, etag) = next(iter(c.state.values.items()))
        payloads = []
        meta = MetaMessenger("synthetic-test-only", recipient_aliases={})
        meta._post = lambda _state, payload: payloads.append(payload)
        c.engine.messenger = meta
        for method, field in [
            (c.engine._prompt_attendance_batch_action, "attendance_batch_action"),
            (c.engine._prompt_attendance_batch_presence, "attendance_batch_presence"),
        ]:
            result = method(state, etag)
            etag = result["etag"]
            interactive = payloads[-1]["interactive"]
            self.assertEqual(interactive["type"], "list")
            rows = interactive["action"]["sections"][0]["rows"]
            ids = [row["id"] for row in rows]
            holiday_id = "choice:" + field + ":attendance_batch_holiday"
            self.assertIn(holiday_id, ids)
            self.assertIn("choice:" + field + ":attendance_batch_edit", ids)
            self.assertEqual(ids.index(holiday_id), ids.index("choice:" + field + ":attendance_batch_absent") + 1)
            response = c.reply(reply_id=holiday_id)
            self.assertEqual(response["status"], "awaiting_attendance_batch_confirmation")
            _key, (state, etag) = next(iter(c.state.values.items()))
        self.assertEqual(c.sharepoint.update_calls, [])

    def test_batch_holiday_return_then_present_clears_reason_without_writing(self):
        self.start_batch()
        c = self.case
        c.reply(reply_id="attendance_batch_holiday")
        c.reply(reply_id="attendance_batch_cancel")
        result = c.reply(reply_id="attendance_batch_present")
        self.assertEqual(result["status"], "awaiting_attendance_batch_confirmation")
        for row in c.messenger.sent[-1]["detail_table"]["rows"]:
            cells = {cell["label"]: cell["value"] for cell in row}
            self.assertEqual(cells["PRESENÇA"], "PRESENTE")
            self.assertNotIn("MOTIVAÇÃO", cells)
        self.assertEqual(c.sharepoint.update_calls, [])

    def test_batch_holiday_shows_reason_for_each_id_and_updates_only_after_confirm(self):
        self.start_batch()
        c = self.case
        result = c.reply(reply_id="attendance_batch_holiday")
        self.assertEqual(result["status"], "awaiting_attendance_batch_confirmation")
        rows = c.messenger.sent[-1]["detail_table"]["rows"]
        self.assertEqual(len(rows), 2)
        for row in rows:
            cells = {cell["label"]: cell["value"] for cell in row}
            self.assertEqual(cells["PRESENÇA"], "AUSENTE")
            self.assertEqual(cells["MOTIVAÇÃO"], "FERIADO")
        self.assertEqual(c.sharepoint.update_calls, [])
        c.reply(reply_id="attendance_batch_confirm")
        self.assertEqual({call["item_id"] for call in c.sharepoint.update_calls}, {1814, 1815})
        for call in c.sharepoint.update_calls:
            self.assertEqual(call["fields"]["PRESENCA"], "AUSENTE")
            self.assertEqual(call["fields"]["MOTIVACAO"], "FERIADO")

    def test_batch_holiday_can_return_without_writing(self):
        self.start_batch()
        result = self.case.reply(reply_id="attendance_batch_holiday")
        self.assertEqual(result["status"], "awaiting_attendance_batch_confirmation")
        self.case.reply(reply_id="attendance_batch_cancel")
        self.assertEqual(self.case.sharepoint.update_calls, [])


if __name__ == "__main__":
    unittest.main()
