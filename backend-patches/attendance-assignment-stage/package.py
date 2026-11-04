import ast,hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def replace_once(text, before, after):
    if text.count(before)!=1: raise RuntimeError('Unexpected patch anchor: '+before[:100])
    return text.replace(before,after,1)

def transform(raw):
    text=raw.decode('utf-8')
    if text.count('    @staticmethod\n    def _attendance_supplier_presence_changed_fields(') != 1 or text.count('    def _attendance_supplier_display_changes(') != 1: raise RuntimeError('Unexpected patch anchor: assignment')
    start=text.index('    @staticmethod\n    def _attendance_supplier_presence_changed_fields(')
    end=text.index('    def _attendance_supplier_display_changes(',start)
    text=text[:start]+(ROOT/'methods.py.inc').read_text(encoding='utf-8-sig').rstrip()+'\n\n'+text[end:]
    old='''                entries.append({
                    "item_id": target_id, "supplier_id": supplier_id,
                    "source_values": {**(target.get("source_values") or {}), **current, "Id": target_id},
                })'''
    new='''                if any(field in changed_presence_fields for field in ("IDDESCRITIVOETAPA", "ATIVIDADEEXECUTADA", "ETAPA")):
                    review = self._attendance_consistency_record({**current, **changed_presence_fields}, item_id=target_id)
                    if review:
                        raise RuntimeError(f"A PRESENÇA {target_id} NÃO PODE RECEBER ESTE PADRÃO: " + "; ".join(review["issues"]))
                entries.append({
                    "item_id": target_id, "supplier_id": supplier_id,
                    "source_values": {**(target.get("source_values") or {}), **current, "Id": target_id},
                })'''
    text=replace_once(text,old,new)
    old_stage = '''    @staticmethod
    def _sync_attendance_stage_from_activity(
        state: dict, selected: dict
    ) -> None:
        """Aplica a ETAPA da atividade, como o DefaultSelectedItems do Form20."""

        stage = (selected.get("source_values") or {}).get("ETAPA")
        if stage in {None, ""}:
            return
        state.setdefault("fields", {})["ETAPA"] = stage
        state.setdefault("display_values", {})["ETAPA"] = str(stage)
'''
    new_stage = '''    def _sync_attendance_stage_from_activity(
        self, state: dict, selected: dict
    ) -> None:
        """Use the linked descriptor's stage; never replace it with an unrelated activity stage."""
        descriptor_id = (state.get("fields") or {}).get("IDDESCRITIVOETAPA")
        if descriptor_id not in (None, ""):
            try:
                descriptor = self.sharepoint.get_item_fields(int(str(descriptor_id)), ["ETAPA"], target_list="DEMONSTRATIVOETAPA")
            except Exception:
                return  # Preserve the draft; the existing consistency guard fails closed.
            stage = descriptor.get("ETAPA")
        else:
            stage = (selected.get("source_values") or {}).get("ETAPA")
        if stage in (None, ""):
            return
        state.setdefault("fields", {})["ETAPA"] = stage
        state.setdefault("display_values", {})["ETAPA"] = str(stage)
'''
    text=replace_once(text,old_stage,new_stage)

    ast.parse(text)
    return text.encode('utf-8')

def package():
    manifest={}
    for name in ('app','build'):
        original=(ROOT/'baseline'/f'workflow-{name}.py').read_bytes()
        result=transform(original)
        dest=ROOT/'candidate'/name/'worker'/'workflow.py'
        dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(result)
        manifest[name]={'relative':'worker/workflow.py','before':hashlib.sha256(original).hexdigest(),'after':hashlib.sha256(result).hexdigest()}
    (ROOT/'deploy-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest))
if __name__=='__main__':package()
