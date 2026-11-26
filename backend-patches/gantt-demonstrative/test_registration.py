"""Exercise the Gantt entry point with the real engine and fake SharePoint."""
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from requests import HTTPError, Response

ROOT = Path(os.environ["ENERGETICO_WORKER_ROOT"])
FIXTURES = Path("/home/opc/energetica-build/tests")
if overlay := os.environ.get("ENERGETICO_WORKER_OVERLAY"):
    sys.path.insert(0, overlay)
sys.path.extend([str(ROOT / "worker"), str(ROOT), str(FIXTURES)])
import workflow  # Load from the specified runtime before the fixtures adjust sys.path.
import test_workflow as fixtures


class GanttRegistrationTests(unittest.TestCase):
    def setUp(self):
        fixtures.WorkflowTests.setUp(self)
        self.config["limits"]["inactivity_expiration_enabled"] = False
        self.parent = {
            "FILIAL": "004 - EDIFÍCIO XAVANTE", "ETAPA": "EXECUÇÃO FUNDAÇÃO",
            "STATUS": "INICIADO", "TIPO": "ATIVIDADE COMUM",
        }
        self.sharepoint.items[77] = {"fields": self.parent, "target_list": "LANCAMENTOOBRA"}
        self.sender = "portal:fake-gantt-tester"
        self.key = fixtures.conversation_key(self.event("key", ""))

    def event(self, message_id, reply_id, *, trusted=True):
        return fixtures.event(
            message_id, "text", reply_id=reply_id, text=str(reply_id),
            sender=self.sender, conversation_id=self.sender,
            phone_number_id="portal-admin", trusted_portal=trusted,
        )

    def answer(self, reply_id, message_id=None):
        self.reply_number += 1
        return self.engine.handle(self.event(message_id or str(self.reply_number), reply_id))

    def current(self):
        return self.state.load(self.key)[0]

    def test_registers_using_the_selected_parent_and_preserves_its_fields_in_review(self):
        opened = self.answer("gantt_create_demonstrative:77", "open")
        self.assertEqual(opened.get("field"), "imovel_demonstrativo_etapa", opened)
        self.assertEqual(self.answer("gantt_create_demonstrative:77", "open")["status"], "duplicate")
        self.assertEqual(set(self.sharepoint.items), {77})

        self.answer("choice:imovel_demonstrativo_etapa:431")
        self.assertEqual(
            self.answer("choice:fornecedor_demonstrativo_etapa:432").get("field"),
            "data_inicio_demonstrativo_etapa",
        )
        self.assertEqual(self.answer("demonstrative_start_today").get("field"), "atividade_demonstrativo_etapa")
        self.answer("choice:atividade_demonstrativo_etapa:434")
        result = self.answer("choice:tem_observacao_demonstrativo_etapa:2")
        if result["status"] == "awaiting_attachment_decision":
            result = self.answer("attachment_no")
        self.assertEqual(result["status"], "awaiting_confirmation", result)
        state = self.current()
        self.assertEqual(state["fields"]["FILIAL"], self.parent["FILIAL"])
        self.assertEqual(state["fields"]["ETAPA"], self.parent["ETAPA"])
        self.assertEqual(state["display_values"]["ETAPA"], self.parent["ETAPA"])
        self.assertFalse({"FILIAL", "ETAPA"} & {
            self.engine._flow_config(state)["steps"][option["value"]].get("target_field")
            for option in self.engine._editable_options(state) if isinstance(option["value"], int)
        })
        result = self.answer("confirm_yes")
        self.assertEqual(result["status"], "completed", result)
        created = self.sharepoint.items[result["sharepoint_item_id"]]
        self.assertEqual(created["target_list"], "DEMONSTRATIVOETAPA")
        self.assertEqual(created["fields"]["FILIAL"], self.parent["FILIAL"])
        self.assertEqual(created["fields"]["ETAPA"], self.parent["ETAPA"])
        self.assertEqual(created["fields"]["STATUS"], "ATIVIDADE INICIADA")
        self.assertEqual(self.sharepoint.update_calls, [])

    def test_ignores_stale_or_wrong_records_without_starting_a_flow(self):
        for change in [{"STATUS": "FINALIZADO"}, {"STATUS": "NÃO INICIADO"}, {"TIPO": "MARCO"}, {"ETAPA": ""}]:
            with self.subTest(change=change):
                self.sharepoint.items[77]["fields"] = {**self.parent, **change}
                result = self.answer("gantt_create_demonstrative:77")
                self.assertEqual(result["status"], "gantt_stage_unavailable")
                self.assertIsNone(self.current())
        response = Response()
        response.status_code = 404
        with patch.object(self.sharepoint, "get_item_fields", side_effect=HTTPError(response=response)):
            self.assertEqual(self.answer("gantt_create_demonstrative:78")["status"], "gantt_stage_unavailable")

    def test_cannot_start_from_an_existing_active_flow_or_non_portal_message(self):
        self.assertEqual(self.engine.handle(self.event("whatsapp", "gantt_create_demonstrative:77", trusted=False))["status"],
                         "ignored")
        self.answer("gantt_create_demonstrative:77")
        before = self.current()
        self.assertEqual(self.answer("gantt_create_demonstrative:77")["status"], "gantt_flow_busy")
        self.assertEqual(self.current(), before)
        self.assertEqual(len(self.sharepoint.item_field_calls), 1)

    def test_regular_registration_still_asks_for_the_branch(self):
        self.answer("OPA")
        self.answer("group_construction_stage")
        self.answer("action_construction_stage_section")
        result = self.answer("action_create_construction_stage_demonstrative")
        self.assertEqual(result.get("field"), "filial_demonstrativo_etapa", result)


if __name__ == "__main__":
    unittest.main()
