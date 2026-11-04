import ast, hashlib, json
from pathlib import Path
ROOT = Path(__file__).resolve().parent

def replace_once(text, before, after):
    if text.count(before) != 1:
        raise RuntimeError('Unexpected patch anchor: ' + before[:100])
    return text.replace(before, after, 1)

def transform(raw):
    text = raw.decode('utf-8')
    text = replace_once(text, '    def _attendance_batch_supplier_changes(', (ROOT/'methods.py.inc').read_text(encoding='utf-8-sig').rstrip() + '\n\n    def _attendance_batch_supplier_changes(')
    text = replace_once(text, '        elif field == "ATIVIDADEEXECUTADA" and source.get("ETAPA") not in {None, ""}:\n            changes["ETAPA"] = source["ETAPA"]\n        return self._prompt_attendance_batch_confirmation(state, etag)',
        '        elif field == "ATIVIDADEEXECUTADA":\n            if source.get("ETAPA") not in {None, ""}:\n                changes["ETAPA"] = source["ETAPA"]\n            if "IDDESCRITIVOETAPA" in changes:\n                self._attendance_copy_offer(state, record)\n        return self._prompt_attendance_batch_confirmation(state, etag)')
    text = replace_once(text, '            "title": "📋 RESUMO DAS PRESENÇAS SELECIONADAS",\n            "kind": "presence",\n            "rows": rows,',
        '            "title": "📋 RESUMO DAS PRESENÇAS SELECIONADAS",\n            "kind": "presence",\n            "rows": rows,\n            **({"copy_offer": state["attendance_copy_offer"]} if state.get("attendance_copy_offer") else {}),')
    text = replace_once(text, '        if command.startswith("attendance_inline:"):\n            return self._handle_attendance_inline(command, state, etag)',
        '        if command.startswith(("attendance_copy:", "attendance_copy_skip:")):\n            return self._handle_attendance_copy(command, state, etag)\n        if command.startswith("attendance_inline:"):\n            state.pop("attendance_copy_offer", None)\n            return self._handle_attendance_inline(command, state, etag)')
    text = replace_once(text, '        if command == "attendance_batch_cancel":\n            return self._prompt_attendance_batch_action(state, etag)',
        '        if command == "attendance_batch_cancel":\n            state.pop("attendance_copy_offer", None)\n            return self._prompt_attendance_batch_action(state, etag)')
    text = replace_once(text, '        if command == "attendance_batch_confirm" and state.get("attendance_inline_catalog_errors"):',
        '        if command == "attendance_batch_confirm":\n            state.pop("attendance_copy_offer", None)\n        if command == "attendance_batch_confirm" and state.get("attendance_inline_catalog_errors"):')
    ast.parse(text)
    return text.encode('utf-8')

def package():
    manifest = {}
    for name in ('app','build'):
        original=(ROOT/'baseline'/f'workflow-{name}.py').read_bytes()
        result=transform(original)
        target=ROOT/'candidate'/name/'worker'/'workflow.py'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(result)
        manifest[name]={'relative':'worker/workflow.py','before':hashlib.sha256(original).hexdigest(),'after':hashlib.sha256(result).hexdigest()}
    (ROOT/'deploy-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps(manifest))
if __name__ == '__main__': package()
