"""Exercise the launch conversation using the worker and bridge in memory."""
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(os.environ.get("ENERGETICO_WORKER_ROOT", "/opt/energetica-whatsapp"))
FIXTURES = Path(os.environ.get("ENERGETICO_WORKFLOW_TESTS", "/home/opc/energetica-build/tests"))
sys.path[:0] = [str(ROOT / "worker"), str(ROOT), str(FIXTURES)]
import config
import logic
import workflow
from channel_bridge import ChannelMessenger

# The historical fixtures also have a checkout-local worker on sys.path.
# Import the deployed modules above so the exercise uses the live engine.
import test_workflow as fixtures

SKIP_ID = "launch_observation_skip"
SKIP_LABEL = "Continuar sem observações"


class LaunchObservationTests(unittest.TestCase):
    def setUp(self):
        fixtures.WorkflowTests.setUp(self)
        self.config["limits"]["inactivity_expiration_enabled"] = False
        self.engine.messenger = ChannelMessenger()
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.state.directory = temp.name
        initial = fixtures.event("seed", "text")
        self.key = fixtures.conversation_key(initial)
        self.current = self.engine._new_state(initial, self.key)
        self.attachment = {"object_name": "qa/receipt", "sharepoint_name": "teste.pdf"}
        self.current.update(
            flow="launch",
            stage="selecting_fields",
            fields={"FORNECEDOR": "FORNECEDOR FICTÍCIO"},
            attachments=[self.attachment],
        )
        self.steps = self.engine._flow_config(self.current)["steps"]
        self.current["step_index"] = next(
            i for i, step in enumerate(self.steps) if step["key"] == "tem_observacao_lancamento"
        )
        self.sharepoint.options_by_key["produto_lancamento"] = [
            {"id": 1, "title": "PRODUTO FICTÍCIO", "value": "PRODUTO FICTÍCIO"},
            {"id": 2, "title": "OUTRO PRODUTO", "value": "OUTRO PRODUTO"},
        ]
        self.engine._prompt_next_or_summary(self.current, None)
        self.sent = self.engine.messenger.drain()

    def send(self, message_id, *, reply_id="", text=""):
        response = self.engine.handle(fixtures.event(message_id, "text", reply_id=reply_id, text=text))
        self.current = self.state.load(self.key)[0]
        self.sent = self.engine.messenger.drain()
        return response

    def choose_yes(self):
        result = self.send("yes", reply_id="choice:tem_observacao_lancamento:1")
        self.assertEqual(result["field"], "observacao_lancamento")

    def skip_button(self):
        prompt = next(message for message in self.sent if "DIGITE A OBSERVAÇÃO:" in message.get("question", ""))
        self.assertEqual(prompt["type"], "poll")
        buttons = [option for option in prompt["options"] if option["id"] == SKIP_ID]
        self.assertEqual(buttons, [{"id": SKIP_ID, "reply": SKIP_ID, "label": SKIP_LABEL}])
        return buttons[0]

    def assert_no_observation(self, result):
        self.assertEqual(result["field"], "produto_lancamento")
        self.assertNotIn("DESCRIÇÃO", self.current["fields"])
        self.assertEqual(self.current["attachments"], [self.attachment])
        self.assertEqual(self.sharepoint.items, {})

    def test_skip_after_yes_advances_without_storing_the_action_label(self):
        self.choose_yes()
        button = self.skip_button()
        result = self.send("skip", reply_id=button["reply"])
        self.assert_no_observation(result)
        self.assertIsNone(self.current["answers"]["observacao_lancamento"])

    def test_existing_draft_shows_button_on_resume(self):
        self.choose_yes()
        persisted, etag = self.state.load(self.key)
        self.engine._resend_current_prompt(persisted, etag)
        self.sent = self.engine.messenger.drain()
        self.assert_no_observation(self.send("skip", reply_id=self.skip_button()["reply"]))

    def test_free_text_still_records_an_observation(self):
        self.choose_yes()
        result = self.send("observation", text="Pagamento por medição")
        self.assertEqual(result["field"], "produto_lancamento")
        self.assertEqual(self.current["fields"]["DESCRIÇÃO"], "PAGAMENTO POR MEDIÇÃO")
        self.assertEqual(self.current["attachments"], [self.attachment])
        self.assertEqual(self.sharepoint.items, {})

    def test_no_still_skips_from_the_first_question(self):
        self.assert_no_observation(self.send("no", reply_id="choice:tem_observacao_lancamento:2"))


if __name__ == "__main__":
    unittest.main()
