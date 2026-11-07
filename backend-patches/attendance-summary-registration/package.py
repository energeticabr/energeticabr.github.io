"""Patch independently captured app/build sources, rejecting drifted anchors."""
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise RuntimeError('Unexpected patch anchor: ' + before[:100])
    return text.replace(before, after, 1)


def transform(raw):
    text = raw.decode('utf-8')
    anchor = '    def _prompt_attendance_batch_confirmation(self, state: dict, etag: str | None) -> dict:\n'
    text = replace_once(text, anchor, (ROOT / 'methods.py.inc').read_text(encoding='utf-8-sig').rstrip() + '\n\n' + anchor)
    text = replace_once(text, anchor + '        state["stage"] = "attendance_batch_confirmation"\n', anchor + '        state["stage"] = "attendance_batch_confirmation"\n        if state.get("attendance_summary_registration_menu"):\n            return self._prompt_attendance_summary_registration(state, etag)\n')
    anchor = '                {"id": "attendance_batch_confirm", "title": "✅ SUBMETER TODOS"},'
    text = replace_once(text, anchor, '                {"id": "attendance_batch_register", "title": "➕ CADASTRAR"},\n' + anchor)
    anchor = '    def _confirm_attendance_batch(self, event: dict, state: dict, etag: str | None) -> dict:\n        command = str(event.get("reply_id") or event.get("text") or "").strip()\n        self._mark_processed(state, event.get("message_id"))\n'
    text = replace_once(text, anchor, anchor + '        registration = self._handle_attendance_summary_registration(command, state, etag)\n        if registration is not None:\n            return registration\n')
    anchor = '        parent_keys = (*parent_keys, *PROVISION_STATE_KEYS, "document_batch")\n'
    text = replace_once(text, anchor, anchor + '        if return_type == "attendance_summary_registration":\n            parent_keys = tuple(key for key in state if not key.startswith("_outbound"))\n')
    anchor = '        self._apply_fixed_fields(state)\n        if initial_step_values:\n'
    text = replace_once(text, anchor, '        if return_type == "attendance_summary_registration":\n            for key in list(state):\n                if key.startswith("attendance_") or key.startswith("pending_attendance_"):\n                    state.pop(key, None)\n            state.pop("option_pagination", None)\n' + anchor)
    anchor = '        if embedded_type == "attendance_demonstrative_registration":\n'
    text = replace_once(text, anchor, '        if embedded_type == "attendance_summary_registration":\n            return self._resume_attendance_summary_registration(state, etag, item_id)\n' + anchor)
    anchor = '    def _navigate_back(self, state: dict, etag: str | None) -> dict:\n'
    text = replace_once(text, anchor, anchor + '        if state.get("stage") == "attendance_batch_confirmation" and state.pop("attendance_summary_registration_menu", False):\n            return self._prompt_attendance_batch_confirmation(state, etag)\n')
    anchor = '        if not state:\n            if not (show_menu or resume or explicit_save):\n'
    guard = '''        if (state and (state.get("embedded_return") or {}).get("type") == "attendance_summary_registration"
                and state.get("stage") in CANCELLABLE_STAGES
                and state.get("stage") not in DRAFT_BUSY_STAGES
                and command in {"fim", "cancelar", "confirm_cancel", "cancel_failed_submission"}):
            if event.get("message_id") in state.get("processed_message_ids", []):
                return {"status": "duplicate", "message_id": event.get("message_id"), "batch_id": state.get("batch_id")}
            self._mark_processed(state, event.get("message_id"))
            return self._restore_embedded_supply_ancestor(state, etag, 1)
'''
    text = replace_once(text, anchor, guard + anchor)
    ast.parse(text)
    return text.encode('utf-8')


def package():
    manifest = {}
    for name in ('app', 'build'):
        raw = (ROOT / 'baseline' / f'workflow-{name}.py').read_bytes()
        result = transform(raw)
        path = ROOT / 'candidate' / name / 'worker/workflow.py'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(result)
        manifest[name] = {'relative': 'worker/workflow.py', 'before': hashlib.sha256(raw).hexdigest(), 'after': hashlib.sha256(result).hexdigest()}
    (ROOT / 'deploy-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest))


if __name__ == '__main__':
    package()
