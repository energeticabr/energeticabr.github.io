"""Exercise the shared workflow with local conversation state only."""
from copy import deepcopy
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock

ROOT = Path(os.environ["BACKEND_ROOT"])
sys.path[:0] = [str(ROOT), str(ROOT / "worker")]
from channel_bridge import ChannelMessenger
from local_app import LocalStateStore, load_workflow_config
from workflow import WorkflowEngine, conversation_key


class ProvisionPayrollHomeTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.store = LocalStateStore(Path(temp.name))
        self.messenger = ChannelMessenger()
        self.engine = WorkflowEngine(
            load_workflow_config(), self.store, Mock(), self.messenger, Mock()
        )
        self.engine.sharepoint.get_options.return_value = []
        self.engine._send_start_group_menu = Mock(
            side_effect=lambda state, *args: self.messenger.send_text(state, "MENU PRINCIPAL")
        )
        self.event = {"kind": "text", "sender": "regression", "conversation_id": "regression",
                      "message_id": "home", "trusted_portal": True, "reply_id": "portal_confirm_main_menu"}
        self.key = conversation_key(self.event)

    def confirmed(self, stage="selecting_launch_payroll_type"):
        state = self.engine._new_state(self.event, self.key)
        attachment = {"object_name": "staged.pdf", "sharepoint_name": "verified.pdf"}
        parent = {"item_id": 7, "attachment_names": ["verified.pdf"],
                  "verified": {"fields": True, "attachments": True}}
        child = {"item_id": 11, "verified": {"fields": True, "attachments": True}}
        state.update(
            flow="payment_settlement", stage=stage, attachments=[attachment],
            sharepoint={**parent, "line_items": [child], "selected_ids": ["11"]},
            provision_description={"parent_id": 7, "journal": {
                "intent": {"FORMAPGTO": "PIX"}, "parent": deepcopy(parent),
                "children": {"11": deepcopy(child)}, "attachments": [deepcopy(attachment)],
            }},
            pending_launch_payroll={"sheet_entry_index": 0, "selected_entries": [
                {"item_id": 11, "provision_id": 11, "eligible": True, "IDFOLHA": 13,
                 "fields": {"VALOR UNITÁRIO": "10", "QUANTIDADE": "1"}},
            ], "settlement_links_checked": True},
            settlement_payroll_batch=state["batch_id"],
        )
        return state

    def test_home_from_each_optional_payroll_stage(self):
        for index, stage in enumerate(("asking_launch_payroll", "selecting_launch_payroll_entries",
                                       "selecting_launch_payroll_sheet", "selecting_launch_payroll_type")):
            with self.subTest(stage=stage):
                state = self.confirmed(stage)
                self.store.save(self.key, state, self.store.load(self.key)[1])
                event = dict(self.event, message_id=f"home-{index}")
                result = self.engine.handle(event)
                self.assertTrue(result.get("returned_to_main_menu"), result)
                self.assertTrue(result["resetConversation"])
                current, _ = self.store.load(self.key)
                self.assertEqual(current["stage"], "choosing_group")
                self.assertEqual(current["attachments"], [])
                self.assertNotIn("pending_launch_payroll", current)
                self.assertEqual([msg["text"] for msg in self.messenger.drain()], ["MENU PRINCIPAL"])
        self.assertEqual(self.engine.sharepoint.mock_calls, [])

    def test_menu_action_survives_payroll_lookup_outage(self):
        state = self.confirmed("asking_launch_payroll")
        state.pop("settlement_payroll_batch")
        state["pending_launch_payroll"] = {"settlement_loading": True}
        self.store.save(self.key, state, None)
        result = self.engine.handle(dict(self.event, reply_id="navigation_main_menu"))
        self.assertTrue(result.get("returned_to_main_menu"), result)
        self.assertEqual(self.engine.sharepoint.mock_calls, [])

    def test_unconfirmed_child_cannot_leave(self):
        state = self.confirmed()
        state["sharepoint"]["line_items"][0]["verified"]["attachments"] = False
        self.store.save(self.key, state, None)
        result = self.engine.handle(self.event)
        self.assertEqual(result["status"], "provision_submission_locked")
        current, _ = self.store.load(self.key)
        self.assertEqual(current["attachments"], state["attachments"])
        self.assertEqual(current["provision_description"], state["provision_description"])

    def test_inflight_settlement_cannot_leave(self):
        state = self.confirmed()
        state["provision_description"]["journal"]["in_flight"] = {"id": "12"}
        self.store.save(self.key, state, None)
        result = self.engine.handle(self.event)
        self.assertFalse(result.get("returned_to_main_menu"))
        self.assertEqual(self.store.load(self.key)[0]["stage"], state["stage"])

    def test_unconfirmed_attachment_cannot_be_discarded(self):
        state = self.confirmed()
        state["attachments"].append({"object_name": "pending.pdf", "sharepoint_name": "pending.pdf"})
        self.store.save(self.key, state, None)
        result = self.engine.handle(self.event)
        self.assertFalse(result.get("returned_to_main_menu"))
        self.assertEqual(self.store.load(self.key)[0]["attachments"], state["attachments"])


if __name__ == "__main__":
    unittest.main()
