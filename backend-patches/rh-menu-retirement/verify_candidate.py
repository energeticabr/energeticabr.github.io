"""Exercise the real engine with synthetic state and no external resources."""

import json
from pathlib import Path
import sys
from unittest.mock import Mock

from logic import conversation_key
from workflow import WorkflowEngine
from patch_backend import FLOWS, ROOT_ACTIONS, SUBMENUS


def verify(config):
    store = Mock()
    engine = WorkflowEngine(config, store, Mock(), Mock(), Mock())
    group = "group_human_resources"
    retained = {
        "action_create_supplier_attendance", "action_register_hr_activity",
        "action_hr_registrations", "action_validate_attendance", "action_construction_contracts",
    }
    assert retained <= {item["id"] for item in engine._actions_for_group(group)}
    assert not ROOT_ACTIONS & {item["id"] for item in engine._start_actions()}
    assert not SUBMENUS & engine._submenus().keys()
    assert not {f"{flow}_flow" for flow in FLOWS} & config["sharepoint"].keys()
    engine._send_group_action_menu = Mock()
    engine._save = Mock(return_value="saved")
    engine._handle_attachment = Mock(return_value={"status": "attachment_staged"})
    event = {"conversation_id": "synthetic", "sender": "synthetic", "message_id": "new",
             "trusted_portal": True, "kind": "text", "reply_id": "confirm_yes"}
    key = conversation_key(event)
    attachment = {"message_id": "prior-upload", "object_name": "test.pdf"}
    contexts = [("flow", flow) for flow in FLOWS] + [
        ("selected_submenu", submenu) for submenu in SUBMENUS
    ]
    for field, value in contexts:
        state = engine._new_state({**event, "message_id": "old"}, key)
        state.update({field: value, "stage": "awaiting_confirmation", "attachments": [attachment]})
        store.load.return_value = (state, "etag")
        assert engine.handle(event)["status"] == "awaiting_action", value
        assert state["flow"] is None and state["selected_submenu"] is None, value
        assert state["stage"] == "choosing_action" and state["selected_group"] == group, value
        assert state["attachments"] == [attachment], value
        assert "new" in state["processed_message_ids"], value
        engine._send_group_action_menu.assert_called_with(state)
    state = engine._new_state(event, key)
    state.update(flow="attendance_payment_link", stage="awaiting_confirmation")
    store.load.return_value = (state, "etag")
    uploaded = {**event, "kind": "attachment", "message_id": "upload"}
    assert engine.handle(uploaded)["status"] == "attachment_staged"
    engine._handle_attachment.assert_called_once_with(uploaded, state, "saved", key)
    assert "upload" not in state["processed_message_ids"]

    state = engine._new_state(event, key)
    state.update(flow="attendance_period_report", stage="attendance_report_period_end")
    assert engine._resend_current_prompt(state, "etag")["returned_to_main_menu"]
    assert state["selected_group"] == group and state["flow"] is None

    state.update(stage="selecting_fields", flow="attendance_validation")
    store.load.return_value = (state, "etag")
    for retired in ROOT_ACTIONS | {"action_attendance_single_day_report",
                                  "choice:action_attendance_supplier_report"}:
        assert engine.handle({**event, "reply_id": retired})["status"] == "retired_hr_action"
        assert state["flow"] == "attendance_validation"

    draft = {"draft_id": "old-draft", "revision": 1, "flow": "attendance_payment_link"}
    engine._draft_catalog = Mock()
    engine._draft_catalog.return_value.entries.return_value = [draft]
    engine._send_text = Mock()
    engine._send_draft_menu = Mock()
    state = engine._new_state(event, key)
    state["pending_draft_resume"] = {"draft_id": "old-draft", "revision": 1}
    outcome = engine._finish_draft_resume_confirmation(event, state, "etag", key, confirm=True)
    assert outcome["status"] == "draft_resume_conflict" and state["stage"] == "choosing_draft"
    engine._send_draft_menu.assert_called_once_with(state)
    assert not engine.sharepoint.mock_calls


if __name__ == "__main__":
    verify(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")))
    print("RH: menu, submenus, fluxos arquivados, retomada e anexos verificados.")
