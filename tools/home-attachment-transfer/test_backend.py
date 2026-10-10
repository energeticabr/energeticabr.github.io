"""Contract tests against the real portal/engine in an isolated DRY_RUN fixture.

Usage: python test_backend.py CANDIDATE_ROOT BACKEND_ROOT
The backend's existing HTTP test fixture supplies temporary state and files.
"""
import importlib.util
import sys
import unittest
from pathlib import Path
from types import MethodType

candidate, backend = map(Path, sys.argv[1:3])
all_contracts = "--all" in sys.argv[3:]
sys.argv = sys.argv[:1]
sys.path[:0] = [str(candidate), str(backend), str(backend / "worker"), str(backend / "tests")]
from test_portal_attachments import PortalAttachmentTests


class HomeTransferTests(PortalAttachmentTests):
    def setUp(self):
        super().setUp()
        spec = importlib.util.spec_from_file_location("home_workflow", candidate / "worker/workflow.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for name in ("_prompt_portal_transfer_exit", "_finish_portal_transfer_exit"):
            setattr(self.bridge.engine, name, MethodType(getattr(module.WorkflowEngine, name), self.bridge.engine))

    def home_setup(self):
        state = self.seed_state()
        state.update(flow="document_signing", stage="document_signing_waiting_position")
        pdf = self.attachment(state, "visible-user.pdf", b"visible PDF")
        signature = self.attachment(state, "hidden-signature.png", b"hidden signature")
        old = self.attachment(state, "already-posted.pdf", b"existing PDF")
        old.update(existing_attachment=True, read_only=True)
        state["attachments"] = [pdf]
        state["document_signing_document_attachment"] = pdf
        state["document_signing_signature_attachment"] = signature
        state["existing_attachments"] = [old]
        self.save(state)
        context = self.bridge.portal_flow_status(self.alice, allowed_emails={self.alice["email"]})["contextId"]
        body = {"action": "home_attachment_transfer", "replyId": "portal_transfer_attachments",
                "messageId": "home-selection", "expectedContextId": context,
                "attachmentIds": [self.bridge._portal_attachment_id(self.alice, state, pdf)]}
        return state, body, signature, old

    def test_home_remote_state_contains_only_selected_visible_user_file(self):
        state, body, _, _ = self.home_setup()
        status, response = self.request("/portal/chat", body)
        self.assertEqual(status, 200, response)
        receipt = response["activeFlow"]["homeAttachmentTransfer"]
        self.assertEqual(receipt["contextId"], body["expectedContextId"])
        self.assertEqual(receipt["attachmentIds"], body["attachmentIds"])
        self.assertNotEqual(response["activeFlow"]["contextId"], body["expectedContextId"])
        status, response = self.request("/portal/chat", self.confirm_body(body))
        self.assertEqual(status, 200, response)
        current, _ = self.bridge.engine.state_store.load(state["key"])
        self.assertEqual([item["original_name"] for item in current["attachments"]], ["visible-user.pdf"])
        self.assertEqual([item["fileName"] for item in response["attachments"]], ["visible-user.pdf"])
        self.assertEqual(self.bridge.engine.pending_drafts(current), [])

    def confirm_body(self, body):
        return {"action": "home_attachment_transfer", "operation": "confirm",
                "messageId": "home-confirm", "replyId": "portal_transfer_draft_discard",
                "homeTransferReceipt": {"requestId": body["messageId"],
                    "contextId": body["expectedContextId"], "attachmentIds": body["attachmentIds"]}}

    def test_home_stale_confirmation_cannot_confirm_a_later_legacy_transfer(self):
        state, body, _, _ = self.home_setup()
        self.assertEqual(self.request("/portal/chat", body)[0], 200)
        self.assertEqual(self.request("/portal/chat", {"messageId": "other-cancel", "replyId": "portal_transfer_cancel"})[0], 200)
        self.assertEqual(self.request("/portal/chat", {"messageId": "other-transfer", "replyId": "portal_transfer_attachments"})[0], 200)
        before = self.bridge.engine.state_store.load(state["key"])
        self.assertEqual(self.request("/portal/chat", self.confirm_body(body))[0], 422)
        self.assertEqual(self.bridge.engine.state_store.load(state["key"]), before)

    def test_home_rejects_stale_context_without_changing_state(self):
        state, body, _, _ = self.home_setup()
        before = self.bridge.engine.state_store.load(state["key"])
        body["expectedContextId"] = "another-context"
        status, _ = self.request("/portal/chat", body)
        self.assertEqual(status, 422)
        self.assertEqual(self.bridge.engine.state_store.load(state["key"]), before)

    def test_home_rejects_hidden_existing_and_foreign_ids_atomically(self):
        state, body, signature, old = self.home_setup()
        for wrong in (self.bridge._portal_attachment_id(self.alice, state, signature),
                      self.bridge._portal_attachment_id(self.alice, state, old), "a" * 64):
            before = self.bridge.engine.state_store.load(state["key"])
            status, _ = self.request("/portal/chat", {**body, "attachmentIds": [*body["attachmentIds"], wrong]})
            self.assertEqual(status, 422)
            self.assertEqual(self.bridge.engine.state_store.load(state["key"]), before)

    def test_home_replayed_start_recovers_same_selected_confirmation(self):
        state, body, _, _ = self.home_setup()
        self.assertEqual(self.request("/portal/chat", body)[0], 200)
        before = self.bridge.engine.state_store.load(state["key"])
        status, response = self.request("/portal/chat", body)
        self.assertEqual(status, 200, response)
        self.assertEqual(self.bridge.engine.state_store.load(state["key"]), before)
        self.assertTrue(any(option.get("reply") == "portal_transfer_draft_discard"
                            for message in response["messages"] for option in message.get("options", [])))

    def test_home_missing_file_rejects_without_changing_state(self):
        state, body, _, _ = self.home_setup()
        (Path(self.bridge.engine.media_repository.directory) / state["attachments"][0]["object_name"]).unlink()
        before = self.bridge.engine.state_store.load(state["key"])
        self.assertEqual(self.request("/portal/chat", body)[0], 422)
        self.assertEqual(self.bridge.engine.state_store.load(state["key"]), before)

    def test_home_replayed_changed_selection_rejects_without_changing_state(self):
        state, body, _, _ = self.home_setup()
        self.assertEqual(self.request("/portal/chat", body)[0], 200)
        before = self.bridge.engine.state_store.load(state["key"])
        self.assertEqual(self.request("/portal/chat", {**body, "attachmentIds": ["a" * 64]})[0], 422)
        self.assertEqual(self.bridge.engine.state_store.load(state["key"]), before)

    def test_home_other_account_cannot_transfer_selected_user_file(self):
        state, body, _, _ = self.home_setup()
        before = self.bridge.engine.state_store.load(state["key"])
        status, _ = self.request("/portal/chat", body, token="bob")
        self.assertIn(status, (403, 422))
        self.assertEqual(self.bridge.engine.state_store.load(state["key"]), before)

    def test_home_empty_selection_never_falls_back_to_all_attachments(self):
        state, body, _, _ = self.home_setup()
        before = self.bridge.engine.state_store.load(state["key"])
        self.assertEqual(self.request("/portal/chat", {**body, "attachmentIds": []})[0], 422)
        self.assertEqual(self.bridge.engine.state_store.load(state["key"]), before)


if __name__ == "__main__":
    suite = unittest.TestSuite(HomeTransferTests(name) for name in unittest.defaultTestLoader.getTestCaseNames(HomeTransferTests)
                               if all_contracts or name.startswith("test_home_"))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(not result.wasSuccessful())
