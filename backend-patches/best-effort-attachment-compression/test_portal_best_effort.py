"""Real HTTP endpoints and media/state stores with synthetic document bytes."""
import random
import unittest

import test_portal_attachments as harness
from test_best_effort import photo_bytes


class BestEffortPortalTests(unittest.TestCase):
    def setUp(self):
        self.h = harness.PortalAttachmentTests()
        self.h.setUp()
        self.addCleanup(self.h.doCleanups)

    def start(self, content, filename):
        h = self.h
        state = h.seed_state()
        original = h.attachment(state, filename, content)
        original["size"] = 123
        state["attachments"] = [original]
        h.save(state)
        selected = h.snapshot()[0]
        status, response = h.request("/portal/chat", {
            "action": "attachment_compress", "attachmentId": selected["id"],
        })
        self.assertEqual(status, 200, response)
        question = response["messages"][0]["question"].casefold()
        self.assertIn("mais restritiva", question)
        self.assertIn("possível", question)
        status, response = h.request("/portal/chat", {
            "action": "attachment_compression_choice", "choice": "attachment_compression_level_very_high",
        })
        self.assertEqual(status, 200, response)
        return state, original, response

    def preview_choice(self, choice):
        h = self.h
        content = photo_bytes()
        state, original, response = self.start(content, "photo.jpg")
        self.assertEqual(response["operation"], "awaiting_portal_attachment_compression_choice")
        saved, _ = h.bridge.engine.state_store.load(state["key"])
        pending = saved["portal_attachment_compression"]
        self.assertFalse(pending["compressed"]["compression_target_met"])
        self.assertEqual(saved["attachments"][0]["object_name"], original["object_name"])
        self.assertEqual(h.bridge.engine.media_repository.read(original), content)
        poll = next(m for m in response["messages"] if m["type"] == "poll")
        self.assertIn("não foi atingida", poll["question"].casefold())
        self.assertIn("melhor", poll["question"].casefold())
        summary = poll["attachment_compression_preview"]["goal"]
        self.assertFalse(summary["met"])
        self.assertEqual(summary["targetBytes"], len(content) // 10)
        self.assertGreater(summary["actualBytes"], summary["targetBytes"])
        self.assertEqual(summary["actualBytes"], pending["compressed"]["size"])
        for version in ("original", "compressed"):
            descriptor = poll["attachment_compression_preview"][version]
            self.assertEqual(h.request(descriptor["mediaUrl"], method="GET")[0], 200)
        status, result = h.request("/portal/chat", {
            "action": "attachment_compression_choice", "choice": choice,
        })
        self.assertEqual(status, 200, result)
        selected = pending["compressed"] if choice.endswith("_compressed") else original
        saved, _ = h.bridge.engine.state_store.load(state["key"])
        self.assertNotIn("portal_attachment_compression", saved)
        self.assertEqual(saved["attachments"][0]["object_name"], selected["object_name"])
        self.assertEqual(saved["stage"], state["stage"])
        self.assertEqual(saved["fields"], state["fields"])

    def test_goal_miss_can_be_previewed_and_accepted(self):
        self.preview_choice("attachment_compression_use_compressed")

    def test_goal_miss_can_be_previewed_and_original_kept(self):
        self.preview_choice("attachment_compression_use_original")

    def test_incompressible_file_returns_receipt_and_clears_pending_level(self):
        h = self.h
        content = random.Random(3).randbytes(5000)
        state, original, response = self.start(content, "random.bin")
        self.assertEqual(response["operation"], "attachment_compression_unchanged")
        self.assertTrue(all(m["type"] == "text" for m in response["messages"]))
        self.assertIn("original", response["messages"][0]["text"].casefold())
        saved, _ = h.bridge.engine.state_store.load(state["key"])
        self.assertNotIn("portal_attachment_compression", saved)
        self.assertEqual(saved["attachments"][0]["object_name"], original["object_name"])
        self.assertEqual(h.bridge.engine.media_repository.read(original), content)
        self.assertEqual(saved["stage"], state["stage"])
        self.assertEqual(saved["fields"], state["fields"])


if __name__ == "__main__":
    unittest.main()
