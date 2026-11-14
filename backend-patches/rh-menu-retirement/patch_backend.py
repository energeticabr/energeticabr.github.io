"""Remove the retired HR menu entries from a private workflow source and config."""

import argparse
import json
from pathlib import Path
import re
import sys


FLOWS = {
    "attendance_payment_link",
    "attendance_single_day_report",
    "attendance_period_report",
    "attendance_supplier_report",
}
SUBMENUS = {"hr_reports", "attendance_reports_by_date"}
ROOT_ACTIONS = {"action_link_attendance_payment", "action_hr_reports"}


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise ValueError(f"Expected one workflow anchor: {old[:100]!r}")
    return source.replace(old, new, 1)


def patch_config(source):
    config = json.loads(source)
    whatsapp = config["whatsapp"]
    actions = whatsapp["start_actions"]
    retired = [a for a in actions if a.get("id") in ROOT_ACTIONS]
    if {a["id"] for a in retired if a.get("group") == "group_human_resources"} != ROOT_ACTIONS:
        raise ValueError("Expected both HR actions")
    whatsapp["start_actions"] = [a for a in actions if a not in retired]
    for submenu in SUBMENUS:
        del whatsapp["submenus"][submenu]
    for flow in FLOWS:
        del config["sharepoint"][f"{flow}_flow"]
    # Preserve the original serialization of unrelated sections.
    for action in retired:
        source = remove_fallback(source, f'        "id": "{action["id"]}",', 6, "},")
    for names, indent in [
        (SUBMENUS, 6),
        ({f"{flow}_flow" for flow in FLOWS}, 4),
    ]:
        for name in sorted(names):
            start = re.search(rf'(?m)^ {"{"}{indent}{"}"}"{name}": \{{', source)
            if start is None:
                raise ValueError(f"Missing configuration block: {name}")
            end = re.search(rf'(?m)^ {"{"}{indent}{"}"}\}},\n', source[start.end():])
            if end is None:
                raise ValueError(f"Missing configuration block end: {name}")
            source = source[:start.start()] + source[start.end() + end.end():]
    if json.loads(source) != config:
        raise ValueError("Unexpected changes to workflow configuration")
    return source


GUARDS = '''_RETIRED_HR_FLOWS = frozenset({
    "attendance_payment_link",
    "attendance_single_day_report",
    "attendance_period_report",
    "attendance_supplier_report",
})
_RETIRED_HR_SUBMENUS = frozenset({"hr_reports", "attendance_reports_by_date"})
_RETIRED_HR_REPLIES = frozenset({
    "action_link_attendance_payment",
    "action_hr_report",
    "action_hr_reports",
    "action_attendance_reports_by_date",
    "action_attendance_supplier_report",
    "action_attendance_single_day_report",
    "action_attendance_period_report",
})


def _is_retired_hr_context(state):
    return bool(state and (
        state.get("flow") in _RETIRED_HR_FLOWS
        or state.get("selected_submenu") in _RETIRED_HR_SUBMENUS
    ))


'''


RECOVERY = '''    def _leave_retired_hr_context(self, state, etag, event=None):
        event = event or {}
        message_id = event.get("message_id")
        identity = {**state, "message_id": message_id or f"{state['batch_id']}:retired_hr"}
        fresh = self._new_state(identity, state["key"])
        fresh["attachments"] = self._all_state_attachments(state)
        fresh["processed_message_ids"] = list(state.get("processed_message_ids", []))
        is_attachment = event.get("kind") == "attachment"
        if message_id and not is_attachment:
            self._mark_processed(fresh, message_id)
        fresh["stage"] = "choosing_action"
        fresh["selected_group"] = "group_human_resources"
        saved_etag = self._save(fresh, etag)
        state.clear()
        state.update(fresh)
        if is_attachment:
            return self._handle_attachment(event, state, saved_etag, state["key"])
        self._send_group_action_menu(state)
        result = {"status": "awaiting_action", "batch_id": state["batch_id"], "etag": saved_etag}
        if not state["attachments"]:
            result["returned_to_main_menu"] = True
        return result

'''


def remove_fallback(source, marker, indent, closing):
    start = source.index(marker)
    end = source.index("\n" + " " * indent + closing, start)
    if marker.lstrip().startswith('"id"'):
        start = source.rindex("\n" + " " * indent + "{", 0, start) + 1
    return replace_once(source, source[start:end + 1 + indent + len(closing) + 1], "")


def patch_workflow(source):
    for action in sorted(ROOT_ACTIONS):
        marker = f'                    "id": "{action}",'
        if marker in source:
            source = remove_fallback(source, marker, 16, "},")
    for submenu in sorted(SUBMENUS):
        source = remove_fallback(source, f'                "{submenu}": {{', 16, "},")

    anchor = "class WorkflowEngine(ProvisionDescriptionSettlement, PaymentProvisionFlow):"
    source = replace_once(source, anchor, GUARDS + anchor)
    anchor = "        # Old inline task polls may survive"
    source = replace_once(source, anchor, '''        if _is_retired_hr_context(state):
            return self._leave_retired_hr_context(state, etag, event)
        reply = str(event.get("reply_id") or "").strip().lower()
        if reply in _RETIRED_HR_REPLIES or reply.removeprefix("choice:") in _RETIRED_HR_REPLIES:
            if state and state.get("stage") == "choosing_action" and state.get("selected_group") == "group_human_resources":
                self._send_group_action_menu(state)
            return {"status": "retired_hr_action", "batch_id": (state or {}).get("batch_id")}
''' + anchor)
    # The legacy config cases were explicit for the three reports and dynamic
    # for attendance_payment_link. Keep read-only status checks safe until a
    # legacy conversation receives its next event.
    anchor = "    def _flow_config(self, state: dict) -> dict:\n"
    source = replace_once(source, anchor, anchor + '''        if _is_retired_hr_context(state):
            return {"mode": "report", "steps": []}
''')
    for flow in sorted(FLOWS - {"attendance_payment_link"}):
        pattern = (
            rf'(?m)^        if state.get\("flow"\) == "{flow}":\n'
            rf'            return self.config\["sharepoint"\]\[\s*"{flow}_flow"\s*\]\n'
        )
        source, count = re.subn(pattern, "", source)
        if count != 1:
            raise ValueError(f"Expected one explicit workflow configuration: {flow}")

    anchor = "    def _resend_current_prompt(self, state: dict, etag: str | None) -> dict:\n"
    source = replace_once(source, anchor, RECOVERY + anchor + '''        if _is_retired_hr_context(state):
            return self._leave_retired_hr_context(state, etag)
''')
    anchor = '            if entry["batch_id"] != active_batch or entry["flow"] != state.get("flow")'
    source = replace_once(source, anchor, '''            if entry["flow"] not in _RETIRED_HR_FLOWS
            and (entry["batch_id"] != active_batch or entry["flow"] != state.get("flow"))''')
    for method in ("_prompt_draft_resume", "_resume_draft"):
        start = source.index(f"    def {method}(")
        end = source.index("\n    def ", start + 1)
        before = source[start:end]
        after = replace_once(before, "        if not entry:\n",
                             '        if not entry or entry["flow"] in _RETIRED_HR_FLOWS:\n')
        source = source[:start] + after + source[end:]
    start = source.index("    def _finish_draft_resume_confirmation(")
    end = source.index("\n    def ", start + 1)
    before = source[start:end]
    after = replace_once(before, 'if confirm and (not entry or entry.get("revision") != pending.get("revision")):',
                         'if confirm and (not entry or entry["flow"] in _RETIRED_HR_FLOWS\n'
                         '                        or entry.get("revision") != pending.get("revision")):')
    source = source[:start] + after + source[end:]
    compile(source, "workflow.py", "exec")
    return source


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Private worker source directory")
    parser.add_argument("output", type=Path, help="New directory for the candidate pair")
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        sys.exit("Candidate and source must be different directories.")
    workflow = patch_workflow((args.source / "workflow.py").read_text(encoding="utf-8"))
    config = patch_config((args.source / "workflow_config.json").read_text(encoding="utf-8"))
    args.output.mkdir(parents=True)
    (args.output / "workflow.py").write_text(workflow, encoding="utf-8")
    (args.output / "workflow_config.json").write_text(config, encoding="utf-8")
