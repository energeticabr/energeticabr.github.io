"""Exercise the descriptor registration with the real engine and fake SharePoint."""

import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(os.environ.get("ENERGETICO_WORKER_ROOT", "/opt/energetica-whatsapp"))
FIXTURES = Path(os.environ.get("ENERGETICO_WORKFLOW_TESTS", "/home/opc/energetica-build/tests"))
sys.path[:0] = [str(ROOT / "worker"), str(ROOT), str(FIXTURES)]
if overlay := os.environ.get("ENERGETICO_WORKER_OVERLAY"):
    sys.path.insert(0, overlay)
import workflow
import test_workflow as fixtures

FLOW = "construction_stage_demonstrative_create"
END = "data_finalizacao_demonstrativo_etapa"
STATUS = "status_demonstrativo_etapa"
ACTIVITY = "atividade_demonstrativo_etapa"
STARTED = "ATIVIDADE INICIADA"


class DescriptorRegistrationTests(unittest.TestCase):
    def setUp(self):
        fixtures.WorkflowTests.setUp(self)
        self.config["limits"]["inactivity_expiration_enabled"] = False
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.state.directory = temporary.name
        initial = fixtures.event("seed", "text")
        self.key = fixtures.conversation_key(initial)
        self.current = self.engine._new_state(initial, self.key)
        self.current.update(
            flow=FLOW,
            stage="selecting_fields",
            fields={
                "FILIAL": "004 - EDIFÍCIO XAVANTE",
                "IMOVEL": "BLOCO A",
                "FORNECEDOR": "EMPREITEIRO FICTÍCIO",
                "ETAPA": "ESTRUTURA",
            },
        )
        self.sharepoint.options_by_key[ACTIVITY] = [
            {"id": 55, "title": "ALVENARIA", "value": "ALVENARIA"},
            {"id": 56, "title": "PINTURA", "value": "PINTURA"},
        ]

    def set_step(self, key):
        steps = self.engine._flow_config(self.current)["steps"]
        self.current["step_index"] = next(i for i, step in enumerate(steps) if step["key"] == key)

    def send(self, message_id, *, reply_id="", text=""):
        result = self.engine.handle(fixtures.event(message_id, "text", reply_id=reply_id, text=text))
        self.current = self.state.load(self.key)[0]
        return result

    def confirm(self):
        result = self.send("confirm", reply_id="confirm_yes")
        self.assertEqual(result["status"], "completed", result)
        item = self.sharepoint.items[result["sharepoint_item_id"]]
        self.assertEqual(item["target_list"], "DEMONSTRATIVOETAPA")
        self.assertEqual(item["fields"]["STATUS"], STARTED)
        self.assertNotIn("DATAPREVISTO", item["fields"])
        return item["fields"]

    def test_start_date_advances_directly_to_activity_and_submits_started(self):
        self.set_step("data_inicio_demonstrativo_etapa")
        self.engine._prompt_next_or_summary(self.current, None)
        result = self.send("start", reply_id="demonstrative_start_today")
        self.assertEqual(result["field"], ACTIVITY)

        result = self.send("activity", reply_id=f"choice:{ACTIVITY}:55")
        self.assertEqual(result["field"], "tem_observacao_demonstrativo_etapa")
        result = self.send("no-note", reply_id="choice:tem_observacao_demonstrativo_etapa:2")
        self.assertEqual(result["status"], "awaiting_attachment_decision")
        result = self.send("no-attachment", reply_id="attachment_no")
        self.assertEqual(result["status"], "awaiting_confirmation")
        self.assertEqual(self.current["fields"]["STATUS"], STARTED)
        self.assertFalse(self.sharepoint.items)

        result = self.send("edit", reply_id="confirm_edit")
        self.assertEqual(result["status"], "awaiting_edit_field")
        steps = self.engine._flow_config(self.current)["steps"]
        options = self.current["options"]
        editable_keys = {steps[o["value"]]["key"] for o in options if isinstance(o["value"], int)}
        self.assertNotIn(END, editable_keys)
        self.assertNotIn(STATUS, editable_keys)
        self.assertIn(ACTIVITY, editable_keys)
        etag = self.state.load(self.key)[1]
        self.engine._summarize_and_confirm(self.current, etag)
        fields = self.confirm()
        self.assertEqual(fields["ATIVIDADEEXECUTADA"], "ALVENARIA")
        self.assertRegex(fields["DATAEXECUTADO"], r"^\d{4}-\d{2}-\d{2}$")

    def test_legacy_date_and_status_replies_reopen_activity_without_using_the_reply(self):
        for step, reply in [(END, "55"), (STATUS, "2")]:
            with self.subTest(step=step):
                self.set_step(step)
                self.current["options"] = [{"id": 2, "title": "ATIVIDADE FINALIZADA", "value": "ATIVIDADE FINALIZADA"}]
                _, etag = self.state.load(self.key)
                self.engine._save(self.current, etag)
                result = self.send(step, text=reply)
                self.assertEqual(result.get("field"), ACTIVITY)
                self.assertNotIn("ATIVIDADEEXECUTADA", self.current["fields"])

    def test_legacy_confirmation_omits_date_and_overrides_saved_status(self):
        self.current.update(stage="awaiting_confirmation")
        self.current["fields"].update(
            ATIVIDADEEXECUTADA="ALVENARIA", DATAEXECUTADO="2026-11-16",
            DATAPREVISTO="2026-11-17", STATUS="ATIVIDADE FINALIZADA",
        )
        self.current["answers"].update({END: "2026-11-17", STATUS: "ATIVIDADE FINALIZADA"})
        self.current["display_values"].update(DATAPREVISTO="17/11/2026", STATUS="ATIVIDADE FINALIZADA")
        self.engine._save(self.current, None)
        self.confirm()

    def test_existing_record_edit_still_exposes_date_and_status(self):
        self.current["flow"] = "construction_stage_demonstrative_edit"
        flow = self.engine._flow_config(self.current)
        for field in ("DATAPREVISTO", "STATUS"):
            self.assertIn(field, flow["writable_fields"])
            self.assertTrue(any(
                step.get("target_field") == field and step.get("editable", True)
                for step in flow["steps"]
            ))


if __name__ == "__main__":
    unittest.main()
