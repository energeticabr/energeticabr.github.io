"""Exercise the real engine; only channel, storage and SharePoint are in memory."""
import copy
import json
import sys
import unittest
from pathlib import Path

import test_workflow as fixtures

CREATE_ID = "NOVO_DEMONSTRATIVO_ETAPA_ATIVIDADE"
CREATE_TITLE = "➕ CRIAR NOVO DEMONSTRATIVO ETAPA"
ACTIVITY = "CONCRETAGEM ESPECIAL DE PILARES"


class DemonstrativeActivityTests(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.WorkflowTests("runTest")
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.reply = self.case.reply
        self.engine = self.case.engine
        self.sharepoint = self.case.sharepoint

    def current(self):
        return copy.deepcopy(next(iter(self.case.state.values.values()))[0])

    def save_current(self, state):
        _, etag = self.case.state.load(state["key"])
        self.case.state.save(state["key"], state, etag)

    def start_selector(self, *, nested=False):
        if nested:
            self.case.start_attendance_validation()
            self.reply("1")
            self.reply("9")
            self.reply(reply_id="NOVO_DESCRITIVO_ETAPA_PRESENCA")
        else:
            self.reply("OPA")
            self.reply("ETAPA OBRA")
            self.reply("ETAPA OBRA E DEMONSTRATIVO ETAPA")
            self.reply("CRIAR DEMONSTRATIVO DE ETAPA")
            self.reply("430")
        self.reply("431")
        self.reply("432")
        self.reply("433")
        self.reply(reply_id="demonstrative_start_today")
        self.reply(reply_id="demonstrative_end_blank")
        result = self.reply("1")
        self.assertEqual(result["field"], "atividade_demonstrativo_etapa")
        return self.current()

    def start_child(self):
        result = self.reply(reply_id=CREATE_ID)
        self.assertEqual(result.get("field"), "atividade_executada_cadastro_rh")
        self.assertEqual(self.current()["flow"], "hr_activity_registration")
        return result

    def confirm_child(self):
        summary = self.reply(ACTIVITY)
        self.assertEqual(summary["status"], "awaiting_confirmation")
        return self.reply("SIM")

    def finish_demonstrative(self):
        self.reply("2")  # no observations
        summary = self.reply(reply_id="attachment_no")
        self.assertEqual(summary["status"], "awaiting_confirmation")
        return self.reply("SIM")

    def test_creation_action_is_after_catalog_items(self):
        state = self.start_selector()
        self.assertEqual(state["options"][-1]["id"], CREATE_ID)
        self.assertEqual(state["options"][-1]["title"], CREATE_TITLE)
        self.assertTrue(state["options"][-1]["terminal_option"])
        self.assertEqual(state["options"][0]["value"], "ALVENARIA")
        visible = [message for message in self.case.messenger.sent
                   if message.get("field") == "atividade_demonstrativo_etapa"][-1]
        choices = [item for item in visible["options"]
                   if not item.get("navigation_back") and not item.get("navigation_main_menu")]
        self.assertEqual(choices[-1]["id"], CREATE_ID)

    def test_empty_catalog_still_allows_creation_without_losing_parent(self):
        self.sharepoint.options_by_key["atividade_demonstrativo_etapa"] = []
        parent = self.start_selector()
        self.assertEqual([item["id"] for item in parent["options"]], [CREATE_ID])
        self.start_child()
        self.assertEqual(self.current()["fields"], {
            "FILIAL": "004 - EDIFÍCIO XAVANTE", "ETAPA": "ESTRUTURA",
        })
        self.assertEqual(self.sharepoint.items, {})

    def test_confirmed_activity_is_selected_and_parent_draft_is_preserved(self):
        parent = self.start_selector()
        parent["attachments"] = [{"object_name": "draft.pdf", "message_id": "draft-file",
                                  "filename": "draft.pdf", "mime_type": "application/pdf"}]
        parent["idempotency_token"] = "parent-token"
        self.save_current(parent)
        self.start_child()
        self.assertEqual(self.current()["attachments"], [])
        self.assertEqual(self.sharepoint.items, {})
        result = self.confirm_child()
        self.assertEqual(result["field"], "tem_observacao_demonstrativo_etapa")
        item_id = result["registered_activity_item_id"]
        state = self.current()
        for field, value in parent["fields"].items():
            self.assertEqual(state["fields"][field], value)
        for key, value in parent["answers"].items():
            self.assertEqual(state["answers"][key], value)
        self.assertEqual(state["attachments"], parent["attachments"])
        self.assertEqual(state["idempotency_token"], "parent-token")
        self.assertEqual(state["fields"]["ATIVIDADEEXECUTADA"], ACTIVITY)
        selected = state["selections"]["atividade_demonstrativo_etapa"]
        self.assertEqual(selected["id"], item_id)
        self.assertEqual(selected["source_values"]["Id"], item_id)
        self.assertEqual(selected["source_values"]["ETAPA"], "ESTRUTURA")
        self.assertEqual(self.sharepoint.items[item_id]["target_list"], "ATIVIDADE EXECUTADA")
        self.assertEqual(len(self.sharepoint.items), 1)
        self.assertNotIn("embedded_return", state)
        self.assertNotIn("completion_trigger_message_id", state)

    def test_parent_is_created_only_after_its_own_confirmation(self):
        self.start_selector()
        self.start_child()
        result = self.confirm_child()
        self.assertEqual(len(self.sharepoint.items), 1)
        completed = self.finish_demonstrative()
        self.assertEqual(completed["status"], "completed")
        parent_item = self.sharepoint.items[completed["sharepoint_item_id"]]
        self.assertEqual(parent_item["target_list"], "DEMONSTRATIVOETAPA")
        self.assertEqual(parent_item["fields"]["ATIVIDADEEXECUTADA"], ACTIVITY)
        self.assertEqual(parent_item["fields"]["IMOVEL"], "BLOCO A")
        self.assertEqual(parent_item["fields"]["FORNECEDOR"], "EMPREITEIRO DEMONSTRATIVO")
        self.assertEqual(len(self.sharepoint.items), 2)
        self.assertNotEqual(completed["sharepoint_item_id"], result["registered_activity_item_id"])

    def test_nested_activity_preserves_attendance_return_and_resumes_it(self):
        parent = self.start_selector(nested=True)
        self.start_child()
        self.confirm_child()
        self.assertEqual(self.current()["embedded_return"], parent["embedded_return"])
        completed = self.finish_demonstrative()
        self.assertTrue(completed["embedded_attendance_demonstrative_completed"])
        state = self.current()
        self.assertEqual(state["flow"], "attendance_validation")
        self.assertEqual(state["fields"]["IDDESCRITIVOETAPA"], str(completed["demonstrative_item_id"]))
        item = self.sharepoint.items[completed["demonstrative_item_id"]]
        self.assertEqual(item["fields"]["ATIVIDADEEXECUTADA"], ACTIVITY)
        self.assertEqual(completed["field"], "editar_atividade_presenca")
        self.assertEqual(self.sharepoint.update_calls, [])

    def test_cancel_child_returns_to_same_question_without_creating_anything(self):
        parent = self.start_selector()
        self.start_child()
        self.reply(ACTIVITY)
        returned = self.reply("CANCELAR")
        self.assertEqual(returned["field"], "atividade_demonstrativo_etapa")
        self.assertEqual(self.current()["fields"], parent["fields"])
        self.assertEqual(self.current()["answers"], parent["answers"])
        self.assertEqual(self.sharepoint.items, {})

    def test_back_at_first_child_question_preserves_outer_return(self):
        parent = self.start_selector(nested=True)
        self.start_child()
        returned = self.reply(reply_id="navigation_back")
        self.assertEqual(returned["field"], "atividade_demonstrativo_etapa")
        state = self.current()
        self.assertEqual(state["fields"], parent["fields"])
        self.assertEqual(state["embedded_return"], parent["embedded_return"])
        self.assertEqual(self.sharepoint.items, {})

    def test_duplicate_child_activity_does_not_advance_parent(self):
        parent = self.start_selector()
        self.start_child()
        self.sharepoint.existing_records["ATIVIDADE EXECUTADA"] = [{
            "FILIAL": parent["fields"]["FILIAL"], "ETAPA": "ESTRUTURA",
            "ATIVIDADEEXECUTADA": ACTIVITY,
        }]
        duplicate = self.reply(ACTIVITY)
        self.assertEqual(duplicate["status"], "duplicate_value")
        state = self.current()
        self.assertEqual(state["flow"], "hr_activity_registration")
        self.assertEqual(state["embedded_return"]["state"]["fields"], parent["fields"])
        self.assertEqual(self.sharepoint.items, {})

    def test_failed_submission_can_retry_without_advancing_or_duplicate_records(self):
        self.start_selector()
        self.start_child()
        self.reply(ACTIVITY)
        self.sharepoint.fail_ensure_target_once = "ATIVIDADE EXECUTADA"
        failed = self.reply("SIM")
        self.assertEqual(failed["status"], "submission_failed")
        self.assertEqual(self.current()["flow"], "hr_activity_registration")
        self.assertEqual(self.sharepoint.items, {})
        resumed = self.reply(reply_id="retry_submission")
        self.assertEqual(resumed["field"], "tem_observacao_demonstrativo_etapa")
        self.assertEqual(len(self.sharepoint.items), 1)

    def test_inherited_context_cannot_be_changed_in_child_confirmation_edit(self):
        self.start_selector()
        self.start_child()
        self.reply(ACTIVITY)
        self.reply("EDITAR")
        state = self.current()
        values = [item["value"] for item in state["options"]]
        self.assertNotIn(0, values)  # child FILIAL step index
        self.assertNotIn(1, values)  # child ETAPA step index
        self.assertIn(2, values)     # activity text remains editable

    def test_replayed_child_confirmation_does_not_create_a_second_record(self):
        self.start_selector()
        self.start_child()
        self.reply(ACTIVITY)
        confirmation = fixtures.event("activity-confirmation-once", "text", text="SIM")
        resumed = self.engine.handle(confirmation)
        self.assertEqual(resumed["field"], "tem_observacao_demonstrativo_etapa")
        repeated = self.engine.handle(confirmation)
        self.assertEqual(repeated["status"], "duplicate")
        self.assertEqual(len(self.sharepoint.items), 1)
        self.assertEqual(self.current()["fields"]["ATIVIDADEEXECUTADA"], ACTIVITY)

    def test_other_activity_selectors_do_not_receive_this_action(self):
        self.reply("OPA")
        self.reply("RECURSOS HUMANOS")
        self.reply("CADASTRAR ATIVIDADE")
        self.reply("411")
        self.assertNotIn(CREATE_ID, [item["id"] for item in self.current()["options"]])


def export_ui(path):
    case = DemonstrativeActivityTests("runTest")
    case.setUp()
    try:
        case.start_selector()
        selector = copy.deepcopy(case.case.messenger.sent)
        case.start_child()
        child = copy.deepcopy(case.case.messenger.sent[len(selector):])
        case.confirm_child()
        continuation = copy.deepcopy(case.case.messenger.sent[len(selector) + len(child):])
        path.write_text(json.dumps({"selector": selector, "child": child,
                                  "continuation": continuation}, ensure_ascii=False, indent=2),
                        encoding="utf-8")
    finally:
        case.doCleanups()


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--export-ui":
        export_ui(Path(sys.argv[2]))
    else:
        unittest.main()
