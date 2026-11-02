"""Generate independent, exact-baseline candidates. No runtime/configuration writes."""
import argparse
import ast
import difflib
import hashlib
import json
from pathlib import Path

BASELINES = {
    'app': 'd63b34763d513710a0767ac6894811141ff895418c95012283fe16bf2afc2d5e',
    'build': '051268c3944d956cf40b81ba7e1558681387276df7694b61e5992fd2d0a39dad',
}
PATCH = Path(__file__).resolve().parent


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise RuntimeError('Unexpected patch anchor: ' + before[:100])
    return text.replace(before, after, 1)


def transform(data):
    text = data.decode('utf-8')
    if '\r' in text:
        raise RuntimeError('Unexpected line endings')
    text = replace_once(text, '    def _attendance_batch_summary_rows(', (PATCH/'methods.py.inc').read_text(encoding='utf-8-sig') + '    def _attendance_batch_summary_rows(')
    text = replace_once(text, '        state["attendance_batch_changes"] = {}\n', '        state["attendance_batch_changes"] = {}\n        for key in ("attendance_batch_row_changes", "attendance_inline_commands", "attendance_inline_catalog_errors"):\n            state.pop(key, None)\n')
    text = replace_once(text, '        state["stage"] = "attendance_batch_action"\n', '        state["stage"] = "attendance_batch_action"\n        state.pop("attendance_inline_commands", None)\n')
    text = replace_once(text, '        changes = state.get("attendance_batch_changes") or {}\n        presence = state.get("attendance_batch_presence") or "PENDENTE"', '        presence = state.get("attendance_batch_presence") or "PENDENTE"')
    text = replace_once(text, '        for option in state.get("attendance_batch_records", []):\n            source = option.get("source_values") or {}\n            descriptor_id', '        for option in state.get("attendance_batch_records", []):\n            source = option.get("source_values") or {}\n            changes = self._attendance_inline_context(state, option)\n            descriptor_id')
    text = replace_once(text, '        presence = state.get("attendance_batch_presence") or "PENDENTE"\n        rows = []', '        presence = state.get("attendance_batch_presence") or "PENDENTE"\n        detail_cache = {}\n        rows = []')
    text = replace_once(text, '''                    detail = self.sharepoint.get_item_fields(
                        int(str(descriptor_id)), ["ATIVIDADEEXECUTADA"], target_list="DEMONSTRATIVOETAPA"
                    )''', '''                    if str(descriptor_id) not in detail_cache:
                        detail_cache[str(descriptor_id)] = self.sharepoint.get_item_fields(
                            int(str(descriptor_id)), ["ATIVIDADEEXECUTADA"], target_list="DEMONSTRATIVOETAPA"
                        )
                    detail = detail_cache[str(descriptor_id)]''')
    text = replace_once(text, '        rows = self._attendance_batch_summary_rows(state)\n', '        rows = self._attendance_batch_summary_rows(state)\n        self._attendance_inline_editors(state, rows)\n        if state["attendance_inline_catalog_errors"]:\n            self._send_text(state, "⚠️ NÃO FOI POSSÍVEL CARREGAR TODOS OS SELETORES. TENTE NOVAMENTE ANTES DE SUBMETER.")\n')
    text = replace_once(text, '                {"id": "attendance_batch_cancel", "title": "↩️ VOLTAR"},\n', '                {"id": "attendance_batch_cancel", "title": "↩️ VOLTAR"},\n                *([{"id": "attendance_inline_retry", "title": "🔄 CARREGAR SELETORES"}] if state["attendance_inline_catalog_errors"] else []),\n')
    # Bulk edits supersede affected inline fields and their dependent copied values.
    text = replace_once(text, '        state.pop("attendance_batch_active_field", None)\n        return self._prompt_attendance_batch_edit_menu(state, etag)', '''        affected = {
            "IDDESCRITIVOETAPA": {"IDDESCRITIVOETAPA", "IMOVEL", "ETAPA", "ATIVIDADEEXECUTADA"},
            "IMOVEL": {"IMOVEL"},
            "ATIVIDADEEXECUTADA": {"ATIVIDADEEXECUTADA", "ETAPA"},
            "ETAPA": {"ETAPA", "ATIVIDADEEXECUTADA"},
        }[field]
        for row_changes in (state.get("attendance_batch_row_changes") or {}).values():
            for changed in affected:
                row_changes.pop(changed, None)
            if field == "ETAPA":
                row_changes["ATIVIDADEEXECUTADA"] = ""
        state.pop("attendance_inline_commands", None)
        state.pop("attendance_batch_active_field", None)
        return self._prompt_attendance_batch_edit_menu(state, etag)''')
    text = replace_once(text, '''        if command == "attendance_batch_cancel":
            return self._prompt_attendance_batch_action(state, etag)
        if command != "attendance_batch_confirm":''', '''        if command == "attendance_batch_cancel":
            return self._prompt_attendance_batch_action(state, etag)
        if command.startswith("attendance_inline:"):
            return self._handle_attendance_inline(command, state, etag)
        if command == "attendance_inline_retry":
            return self._prompt_attendance_batch_confirmation(state, etag)
        if command == "attendance_batch_confirm" and state.get("attendance_inline_catalog_errors"):
            result = self._prompt_attendance_batch_confirmation(state, etag)
            return {**result, "status": "attendance_batch_catalog_unavailable"}
        if command == "attendance_batch_confirm" and any(
            "ATIVIDADEEXECUTADA" in changes and not str(changes["ATIVIDADEEXECUTADA"] or "").strip()
            for changes in (state.get("attendance_batch_row_changes") or {}).values()
        ):
            self._send_text(state, "⚠️ SELECIONE A ATIVIDADE EXECUTADA DE CADA LINHA ALTERADA ANTES DE SUBMETER.")
            result = self._prompt_attendance_batch_confirmation(state, etag)
            return {**result, "status": "attendance_batch_incomplete"}
        if command != "attendance_batch_confirm":''')
    text = replace_once(text, '''            for option in records:
                item_id = int(str(option["value"]))
                fields = list(dict.fromkeys(["PRESENCA", "DATA", *updates, *ATTENDANCE_CONSISTENCY_FIELDS]))''', '''            for option in records:
                item_id = int(str(option["value"]))
                row_updates = {**updates, **((state.get("attendance_batch_row_changes") or {}).get(str(option["value"])) or {})}
                fields = list(dict.fromkeys(["PRESENCA", "DATA", *row_updates, *ATTENDANCE_CONSISTENCY_FIELDS]))''')
    text = replace_once(text, '''                    **current,
                    **changes,
                }
                review = self._attendance_consistency_record(final_fields, item_id=item_id)''', '''                    **current,
                    **row_updates,
                }
                review = self._attendance_consistency_record(final_fields, item_id=item_id)''')
    text = replace_once(text, '''                    "original": {field: current.get(field) for field in fields},
                    "etag": item_etag,
                })''', '''                    "original": {field: current.get(field) for field in fields},
                    "etag": item_etag,
                    "updates": row_updates,
                })''')
    cleanup = '"attendance_batch_motivation", "attendance_batch_finalized_ids"):'
    if text.count(cleanup) != 2: raise RuntimeError("Unexpected cleanup anchors")
    text = text.replace(cleanup, '"attendance_batch_motivation", "attendance_batch_finalized_ids", "attendance_batch_row_changes", "attendance_inline_commands", "attendance_inline_catalog_errors"):')
    ast.parse(text)
    return text.encode('utf-8')


def package():
    manifest = {}
    for name, expected in BASELINES.items():
        baseline = (PATCH/'baseline'/f'workflow-{name}.py').read_bytes()
        if hashlib.sha256(baseline).hexdigest() != expected:
            raise RuntimeError('Baseline hash mismatch: '+name)
        candidate = transform(baseline)
        folder = PATCH/'candidate'/name/'worker'
        folder.mkdir(parents=True, exist_ok=True)
        (folder/'workflow.py').write_bytes(candidate)
        (PATCH/f'{name}.patch').write_text(''.join(difflib.unified_diff(
            baseline.decode().splitlines(True), candidate.decode().splitlines(True),
            fromfile='a/worker/workflow.py',tofile='b/worker/workflow.py')), encoding='utf-8')
        manifest[name] = {'relative': 'worker/workflow.py', 'before': expected, 'after': hashlib.sha256(candidate).hexdigest()}
    (PATCH/'deploy-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n', encoding='utf-8')
    print(json.dumps(manifest,indent=2))

if __name__ == '__main__':
    package()


