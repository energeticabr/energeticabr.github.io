"""Exercise the shared portal response and menu for a confirmed document replay."""
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(os.environ["SUBMISSION_MENU_SOURCE"]).resolve()
FIXTURES = Path(os.environ.get("SUBMISSION_MENU_FIXTURES", ROOT / "tests")).resolve()
sys.path[:0] = [str(ROOT), str(ROOT / "worker"), str(FIXTURES)]

from channel_bridge import (
    ChannelMessenger,
    PortalMediaStore,
    normalize_channel_events,
    portal_channel_payload,
    portal_public_result,
)
import test_workflow as fixtures


class PortalDocumentReplayTests(unittest.TestCase):
    def setUp(self):
        fixtures.WorkflowTests.setUp(self)
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.state.directory = temporary.name
        self.config["limits"]["inactivity_expiration_enabled"] = False
        self.config["limits"]["post_completion_menu_enabled"] = True
        self.identity = {"oid": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "name": "Teste"}
        self.engine.messenger = self.messenger = ChannelMessenger()
        self.media_store = PortalMediaStore(data_root=Path(temporary.name))
        event = self.event("submit-original")
        self.key = fixtures.conversation_key(event)
        state = self.engine._new_state(event, self.key)
        state.update(
            flow="document",
            stage="completed",
            document_batch={"mode": "single"},
            processed_message_ids=["submit-original"],
            completion_trigger_message_id="submit-original",
            sharepoint={
                "item_id": 801,
                "recorded_at": "2026-11-12T16:55:00+00:00",
                "attachment_names": ["documento-1.jpg"],
            },
        )
        self.engine._save(state, None)
        self.messenger.drain()

    def event(self, message_id):
        payload = portal_channel_payload(
            {"messageId": message_id, "replyId": "confirm_yes"}, self.identity
        )
        return normalize_channel_events(payload)[0]

    def assert_terminal_response(self, message_id):
        result = self.engine.handle(self.event(message_id))
        messages = self.messenger.drain()
        response = portal_public_result(
            {"status": "processed", "results": [result], "messages": messages},
            identity=self.identity, media_store=self.media_store, attachments=[],
        )
        self.assertIn("DOCUMENTOS ÀS 13:55", response["messages"][0]["text"])
        self.assertIn("ID 801", response["messages"][0]["text"])
        self.assertTrue(response["resetConversation"], "clear the already submitted attachment tray")
        self.assertEqual(response["results"][0]["attachment_count"], 1)
        control, = (message["control"] for message in messages if message["type"] == "deferred_control")
        self.assertEqual(response["deferredMenu"]["completionId"], control["completion_id"])
        self.assertEqual(self.engine.handle_deferred(control)["status"], "sent")
        menu, = self.messenger.drain()
        self.assertIn("QUAL ÁREA", menu["question"].upper())
        state, _ = self.state.load(self.key)
        self.assertEqual(state["stage"], "completed")
        self.assertEqual(state["sharepoint"]["item_id"], 801)
        self.assertEqual(self.sharepoint.items, {}, "replaying must never post a second document")

    def test_retry_with_same_message_id_resets_and_reopens_menu(self):
        self.assert_terminal_response("submit-original")

    def test_second_confirmation_resets_and_reopens_menu(self):
        self.assert_terminal_response("submit-second")


if __name__ == "__main__":
    unittest.main()
