"""Patch individually captured live roots using exact anchors and hashes."""
import ast
import difflib
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
    text = replace_once(text, '    def _attendance_batch_summary_rows(', (ROOT/'methods.py.inc').read_text().rstrip() + '\n\n' + '    def _attendance_batch_summary_rows(')
    text = replace_once(text, '        state["attendance_batch_changes"] = {}\n',
        '        state.pop("attendance_supplier_defaults_question", None)\n        state.pop("attendance_supplier_defaults_answer", None)\n        state["attendance_batch_changes"] = {}\n')
    text = replace_once(text, '    def _prompt_attendance_batch_action(self, state: dict, etag: str | None) -> dict:\n',
        '    def _prompt_attendance_batch_action(self, state: dict, etag: str | None) -> dict:\n        state.pop("attendance_supplier_defaults_question", None)\n        state.pop("attendance_supplier_defaults_answer", None)\n')
    text = replace_once(text, '        state["stage"] = "attendance_batch_confirmation"\n        rows = self._attendance_batch_summary_rows(state)',
        '        state["stage"] = "attendance_batch_confirmation"\n        if state.get("attendance_supplier_defaults_question"):\n            return self._prompt_attendance_supplier_defaults(state, etag)\n        state.pop("attendance_supplier_defaults_answer", None)\n        rows = self._attendance_batch_summary_rows(state)')
    text = replace_once(text, '        if command == "attendance_batch_cancel":\n            return self._prompt_attendance_batch_action(state, etag)\n        if command.startswith("attendance_inline:"):',
        '        if state.get("attendance_supplier_defaults_question"):\n            if command == "attendance_supplier_defaults_back":\n                state.pop("attendance_supplier_defaults_question", None)\n                state.pop("attendance_supplier_defaults_answer", None)\n                return self._prompt_attendance_batch_confirmation(state, etag)\n            if command not in {"attendance_supplier_defaults_yes", "attendance_supplier_defaults_no"}:\n                return self._prompt_attendance_supplier_defaults(state, etag)\n            state["attendance_supplier_defaults_question"] = False\n            state["attendance_supplier_defaults_answer"] = command == "attendance_supplier_defaults_yes"\n            command = "attendance_batch_confirm"\n        if command == "attendance_batch_cancel":\n            return self._prompt_attendance_batch_action(state, etag)\n        if command.startswith("attendance_inline:"):')
    text = replace_once(text, '        updates = {**changes, "PRESENCA": presence}\n',
        '        try:\n            supplier_changes = self._attendance_batch_supplier_changes(state)\n        except Exception as exc:\n            self._send_text(state, f"⚠️ LOTE NÃO SUBMETIDO: {exc}")\n            return self._prompt_attendance_batch_confirmation(state, etag)\n        if supplier_changes and "attendance_supplier_defaults_answer" not in state:\n            return self._prompt_attendance_supplier_defaults(state, etag)\n        updates = {**changes, "PRESENCA": presence}\n')
    text = replace_once(text, 'fields = list(dict.fromkeys(["PRESENCA", "DATA", *row_updates, *ATTENDANCE_CONSISTENCY_FIELDS]))',
        'fields = list(dict.fromkeys(["PRESENCA", "DATA", "FORNECEDOR", "FILIAL", "IDDESCRITIVOETAPA", "ATIVIDADEEXECUTADA", *row_updates, *ATTENDANCE_CONSISTENCY_FIELDS]))')
    text = replace_once(text, '                final_fields = {\n                    **(option.get("source_values") or {}),',
        '                source_identity = option.get("source_values") or {}\n                if state.get("attendance_supplier_defaults_answer"):\n                    for field in ("FORNECEDOR", "FILIAL", "IDDESCRITIVOETAPA", "ATIVIDADEEXECUTADA"):\n                        if not self._same_attendance_value(current.get(field), source_identity.get(field)):\n                            raise RuntimeError(f"O CAMPO {field} DO ID {item_id} FOI ALTERADO")\n                final_fields = {\n                    **(option.get("source_values") or {}),')
    text = replace_once(text, '        state["attendance_batch_commit"] = {"entries": entries, "updates": updates, "presence": presence}\n',
        '        try:\n            supplier_plan = self._attendance_batch_supplier_plan(state, supplier_changes) if state.get("attendance_supplier_defaults_answer") else []\n        except Exception as exc:\n            self._send_text(state, f"⚠️ LOTE NÃO SUBMETIDO: {exc}")\n            return self._prompt_attendance_batch_confirmation(state, etag)\n        state["attendance_batch_commit"] = {"entries": entries, "updates": updates, "presence": presence, "supplier_defaults": supplier_plan}\n        state.pop("attendance_supplier_defaults_answer", None)\n        state.pop("attendance_supplier_defaults_question", None)\n')
    text = replace_once(text, '            if journal.get("origin") == "supplier_sync":\n                for entry in journal["entries"]:',
        '            self._commit_attendance_batch_supplier_defaults(journal)\n            if journal.get("origin") == "supplier_sync":\n                for entry in journal["entries"]:')
    ast.parse(text)
    return text.encode('utf-8')

def package():
    manifest = {}
    for name in ('app', 'build'):
        baseline = (ROOT/'baseline'/f'workflow-{name}.py').read_bytes()
        candidate = transform(baseline)
        path = ROOT/'candidate'/name/'worker'/'workflow.py'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(candidate)
        (ROOT/f'{name}.patch').write_text(''.join(difflib.unified_diff(baseline.decode().splitlines(True), candidate.decode().splitlines(True), fromfile='a/worker/workflow.py', tofile='b/worker/workflow.py')))
        manifest[name] = {'relative':'worker/workflow.py','before':hashlib.sha256(baseline).hexdigest(),'after':hashlib.sha256(candidate).hexdigest()}
    (ROOT/'deploy-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest))

if __name__ == '__main__':
    package()
