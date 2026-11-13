"""Exercise the deployed workflow against SharePoint's numeric REST values."""
import ast
import os
from pathlib import Path
import unittest
from decimal import Decimal, InvalidOperation


def workflow_methods():
    path = Path(os.environ.get("WORKFLOW_SOURCE", "worker/workflow.py"))
    tree = ast.parse(path.read_text(encoding="utf-8"))
    engine = next(node for node in tree.body if isinstance(node, ast.ClassDef)
                  and node.name == "WorkflowEngine")
    stages = {node.targets[0].id: ast.literal_eval(node.value) for node in tree.body
              if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)
              and node.targets[0].id.startswith("LAUNCH_PAYROLL_")
              and (node.targets[0].id.endswith("_STAGE") or node.targets[0].id == "LAUNCH_PAYROLL_YES_ID")}
    namespace = {"Decimal": Decimal, "InvalidOperation": InvalidOperation, **stages}
    methods = [node for node in engine.body if isinstance(node, ast.FunctionDef) and node.name in {
        "_maybe_prompt_settlement_payroll", "_settlement_has_payroll_link",
        "_settlement_payroll_lookup_failed", "_reconcile_pending_settlement_payroll",
    }]
    for node in engine.body:
        if not isinstance(node, ast.FunctionDef) or not node.name.startswith("_handle_launch_payroll_") or not node.name.endswith("_reply"):
            continue
        # Run the real reply handler through its reconciliation guard. A fallthrough
        # sentinel represents the pre-existing, potentially mutating reply body.
        if node.name not in {"_handle_launch_payroll_decision_reply", "_handle_launch_payroll_entries_reply",
                             "_handle_launch_payroll_sheet_reply", "_handle_launch_payroll_type_reply"}:
            continue
        old_body = next((i for i, part in enumerate(node.body)
                         if "_reconcile_pending_settlement_payroll" in ast.unparse(part)), None)
        if old_body is not None:
            node.body = node.body[:old_body + 2] + ast.parse("return {'status': 'original_handler'}").body
        else:
            node.body = ast.parse("return {'status': 'original_handler'}").body
        methods.append(node)
    future = ast.parse("from __future__ import annotations").body
    module = ast.fix_missing_locations(ast.Module(body=future + methods, type_ignores=[]))
    exec(compile(module, str(path), "exec"), namespace)
    return namespace


METHODS = workflow_methods()
DECISION = METHODS["LAUNCH_PAYROLL_DECISION_STAGE"]
SELECTION = METHODS["LAUNCH_PAYROLL_SELECTION_STAGE"]
SHEET = METHODS["LAUNCH_PAYROLL_SHEET_STAGE"]
PAYMENT_TYPE = METHODS["LAUNCH_PAYROLL_TYPE_STAGE"]


class Worker:
    def __init__(self, links=None, offline=False):
        self.sharepoint = self
        self.links = links or {}
        self.offline = offline
        self.lookups = []
        self.actions = []

    def get_options(self, step, context):
        source = step["source"]
        assert source["list"] == "FOLHAPGTO"
        query, = source["filters"]
        assert query["field"] == "IDPROVISAO" and query["kind"] == "number"
        provision_id = query["equals"]
        self.lookups.append(provision_id)
        if self.offline:
            raise TimeoutError("SharePoint unavailable")
        return [{"source_values": row} for row in self.links.get(provision_id, [])]

    def _launch_payroll_total(self, fields):
        return Decimal(fields["VALOR UNITÁRIO"])

    def _maybe_prompt_launch_payroll(self, state, etag, items):
        self.candidates = [item["provision_id"] for item in items]

    def _send_actions(self, state, prompt, actions, **kwargs):
        self.actions = actions

    def _mark_processed(self, state, message_id):
        state.setdefault("processed_message_ids", []).append(message_id)

    def _save(self, state, etag):
        return "saved"

    def _continue_launch_after_payroll(self, state, etag):
        state.pop("pending_launch_payroll")
        state["stage"] = "completed"
        return {"status": "completed"}

    def _resend_current_prompt(self, state, etag):
        return self._reconcile_pending_settlement_payroll(state, etag) or {
            "status": "prompt", "stage": state["stage"]
        }


for name, method in METHODS.items():
    if name.startswith("_") and callable(method):
        setattr(Worker, name, method)


def link(provision_id, sheet_id):
    return {"IDPROVISAO": provision_id, "IDFOLHA": sheet_id}


def settlement(*ids):
    return {
        "flow": "payment_settlement", "batch_id": "settled",
        "sharepoint": {"line_items": [
            {"item_id": item_id, "verified": True,
             "expected_fields": {"ID PROVISÃO": item_id, "VALOR TOTAL": "10", "QTD": "1"}}
            for item_id in ids
        ]},
    }


def pending_settlement(stage, *ids):
    state = settlement(*ids)
    entries = [{"item_id": item_id, "provision_id": item_id, "eligible": True} for item_id in ids]
    state.update(stage=stage, options=["stale"], option_pagination={"page": 1},
                 settlement_payroll_batch=state["batch_id"],
                 pending_launch_payroll={
                     "entries": entries, "selected_entries": [entry.copy() for entry in entries],
                     "eligible_ids": [str(item_id) for item_id in ids],
                     "launch_item_ids": list(ids), "selected_ids": [str(item_id) for item_id in ids],
                     "sheet_entry_index": 1, "type_index": 1, "current_sheet_launch_id": ids[0],
                 })
    return state


class SettlementPayrollTest(unittest.TestCase):
    def test_existing_sharepoint_decimal_link_is_skipped(self):
        worker = Worker({463: [link(463.0, "23")]})
        state = settlement(463)
        worker._maybe_prompt_settlement_payroll(state, None)
        self.assertEqual(worker.candidates, [])
        self.assertEqual(worker.actions, [])

    def test_mixed_batch_only_offers_unlinked_provisions(self):
        worker = Worker({463: [link("463.0", 23.0)], 464: [link(464, "24")]})
        worker._maybe_prompt_settlement_payroll(settlement(463, 464, 465), None)
        self.assertEqual(worker.candidates, [465])

    def test_wrong_provision_and_missing_or_invalid_sheet_are_not_links(self):
        worker = Worker({463: [link(463.5, "23"), link(463, "0"), link(463.0, None),
                               link(463, "23.5"), link(463, "NaN")]})
        worker._maybe_prompt_settlement_payroll(settlement(463), None)
        self.assertEqual(worker.candidates, [463])

    def test_initial_lookup_failure_keeps_retry_without_repeating_settlement(self):
        worker = Worker(offline=True)
        state = settlement(463)
        result = worker._maybe_prompt_settlement_payroll(state, None)
        self.assertEqual(result["status"], "settlement_payroll_load_failed")
        self.assertTrue(state["pending_launch_payroll"]["settlement_loading"])
        self.assertNotIn("settlement_payroll_batch", state)

    def test_stale_reply_or_resume_finishes_when_all_pending_rows_are_linked(self):
        for stage, event in [(DECISION, None), (SELECTION, {"message_id": "select"}),
                             (SHEET, {"message_id": "old-sheet"}), (PAYMENT_TYPE, None)]:
            with self.subTest(stage=stage):
                worker = Worker({463: [link(463.0, "23")]})
                state = pending_settlement(stage, 463)
                result = worker._reconcile_pending_settlement_payroll(state, None, event)
                self.assertEqual(result["status"], "completed")
                self.assertNotIn("pending_launch_payroll", state)
                if event:
                    self.assertIn(event["message_id"], state["processed_message_ids"])

    def test_mixed_draft_preserves_remaining_choices_and_verified_rows(self):
        worker = Worker({463: [link(463.0, "23")]})
        state = pending_settlement(PAYMENT_TYPE, 463, 464, 465)
        pending = state["pending_launch_payroll"]
        pending["selected_entries"][1].update(IDFOLHA=24, FOLHAPGTO_ID=182)
        pending["selected_entries"][2].update(IDFOLHA=25)
        pending["awaiting_type_mode"] = True
        result = worker._reconcile_pending_settlement_payroll(state, None, {"message_id": "old-type"})
        self.assertEqual(result, {"status": "prompt", "stage": PAYMENT_TYPE})
        self.assertEqual(worker.lookups, [463, 465])
        self.assertEqual(pending["eligible_ids"], ["464", "465"])
        self.assertEqual(pending["selected_ids"], ["464", "465"])
        self.assertEqual([entry["IDFOLHA"] for entry in pending["selected_entries"]], [24, 25])
        self.assertEqual(pending["selected_entries"][0]["FOLHAPGTO_ID"], 182)
        self.assertEqual(pending["type_index"], 0)
        self.assertNotIn("awaiting_type_mode", pending)
        self.assertNotIn("option_pagination", state)
        self.assertEqual(state["options"], [])

    def test_stale_lookup_failure_preserves_draft_and_retries(self):
        worker = Worker(offline=True)
        state = pending_settlement(SHEET, 463, 464)
        result = worker._reconcile_pending_settlement_payroll(state, None, {"message_id": "old"})
        self.assertEqual(result["status"], "settlement_payroll_load_failed")
        self.assertEqual(state["pending_launch_payroll"]["selected_ids"], ["463", "464"])
        worker.offline = False
        worker.links = {463: [link(463.0, "23")]}
        result = worker._reconcile_pending_settlement_payroll(state, "saved", {"message_id": "retry"})
        self.assertEqual(result["status"], "prompt")
        self.assertEqual(state["pending_launch_payroll"]["selected_ids"], ["464"])

    def test_reply_handlers_also_cover_direct_dispatch_for_frozen_groups(self):
        for stage, handler in [
            (DECISION, "_handle_launch_payroll_decision_reply"),
            (SELECTION, "_handle_launch_payroll_entries_reply"),
            (SHEET, "_handle_launch_payroll_sheet_reply"),
            (PAYMENT_TYPE, "_handle_launch_payroll_type_reply"),
        ]:
            with self.subTest(stage=stage):
                worker = Worker({463: [link(463.0, "23")]})
                state = pending_settlement(stage, 463)
                result = getattr(worker, handler)({"message_id": "stale"}, state, None)
                self.assertEqual(result["status"], "completed")

    def test_optional_write_retry_can_still_verify_existing_payment_and_attachments(self):
        worker = Worker({463: [{**link(463.0, "23"), "Title": "WA-provision-payroll-463"}]})
        state = pending_settlement(PAYMENT_TYPE, 463)
        result = worker._handle_launch_payroll_type_reply({"message_id": "retry"}, state, None)
        self.assertEqual(result["status"], "original_handler")
        self.assertEqual(worker.lookups, [463])
        self.assertEqual(state["pending_launch_payroll"]["selected_ids"], ["463"])

    def test_regular_launch_and_already_checked_draft_do_not_query(self):
        worker = Worker(offline=True)
        state = pending_settlement(SHEET, 463)
        state["flow"] = "launch"
        self.assertIsNone(worker._reconcile_pending_settlement_payroll(state, None))
        state["flow"] = "payment_settlement"
        state["pending_launch_payroll"]["settlement_links_checked"] = True
        self.assertIsNone(worker._reconcile_pending_settlement_payroll(state, None))
        self.assertEqual(worker.lookups, [])
