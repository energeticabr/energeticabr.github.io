"""Create isolated, independently checked candidates for both server roots."""
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
    if text.count('    def _prompt_attendance_supplier_defaults(') != 1 or text.count('    def _attendance_batch_supplier_plan(') != 1:
        raise RuntimeError('Unexpected patch anchor: supplier comparison')
    start = text.index('    def _prompt_attendance_supplier_defaults(')
    end = text.index('    def _attendance_batch_supplier_plan(', start)
    text = text[:start] + (ROOT/'prompt.py.inc').read_text().rstrip() + '\n\n' + text[end:]
    text = replace_once(text, '        state.pop("attendance_supplier_defaults_answer", None)\n        rows = self._attendance_batch_summary_rows(state)',
        '        state.pop("attendance_supplier_defaults_answer", None)\n        state.pop("attendance_supplier_defaults_preview", None)\n        rows = self._attendance_batch_summary_rows(state)')
    text = replace_once(text, '        if state.get("attendance_supplier_defaults_question"):\n            if command == "attendance_supplier_defaults_back":',
        '        if state.get("attendance_supplier_defaults_question"):\n            if command == "attendance_supplier_defaults_retry":\n                state.pop("attendance_supplier_defaults_preview", None)\n                return self._prompt_attendance_supplier_defaults(state, etag)\n            if command == "attendance_supplier_defaults_yes" and not state.get("attendance_supplier_defaults_preview"):\n                return self._prompt_attendance_supplier_defaults(state, etag)\n            if command == "attendance_supplier_defaults_back":')
    text = replace_once(text, '            supplier_plan = self._attendance_batch_supplier_plan(state, supplier_changes) if state.get("attendance_supplier_defaults_answer") else []\n',
        '''            supplier_plan = self._attendance_batch_supplier_plan(state, supplier_changes) if state.get("attendance_supplier_defaults_answer") else []
            if state.get("attendance_supplier_defaults_answer"):
                preview = state.get("attendance_supplier_defaults_preview") or []
                def snapshot(entries):
                    return [(entry["item_id"], entry["supplier"], entry["branch"], entry["updates"], entry["original"]) for entry in entries]
                if snapshot(preview) != snapshot(supplier_plan):
                    state.pop("attendance_supplier_defaults_preview", None)
                    state.pop("attendance_supplier_defaults_answer", None)
                    self._send_text(state, "⚠️ OS PADRÕES MUDARAM. CONFIRA O ANTES E DEPOIS ATUALIZADO.")
                    return self._prompt_attendance_supplier_defaults(state, etag)
''')
    text = replace_once(text, '        state.pop("attendance_supplier_defaults_question", None)\n        state["stage"] = "attendance_batch_committing"',
        '        state.pop("attendance_supplier_defaults_question", None)\n        state.pop("attendance_supplier_defaults_preview", None)\n        state["stage"] = "attendance_batch_committing"')
    ast.parse(text)
    return text.encode('utf-8')

def package():
    manifest = {}
    for name in ('app', 'build'):
        original = (ROOT/'baseline'/f'workflow-{name}.py').read_bytes()
        result = transform(original)
        candidate = ROOT/'candidate'/name/'worker'/'workflow.py'
        candidate.parent.mkdir(parents=True, exist_ok=True)
        candidate.write_bytes(result)
        manifest[name] = {'relative':'worker/workflow.py','before':hashlib.sha256(original).hexdigest(),'after':hashlib.sha256(result).hexdigest()}
    (ROOT/'deploy-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps(manifest))

if __name__ == '__main__':
    package()
