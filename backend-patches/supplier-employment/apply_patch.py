"""Build isolated candidates; refuse source drift and preserve unrelated settings."""
import hashlib
import json
from pathlib import Path
import sys

WORKFLOW_SHA = 'c064da3e06afece45e8ea16b4d1aa05d7ed506b5572b7208dc9be9987c7daf54'
CONFIG_SHA = '5036ce110dcdaa4d3a5a382f804509ad297eae49843ad849cc87a0b2b2ef05f7'
LINK = 'vinculo_fornecedor_suprimentos'
ROLE = 'cargo_fornecedor_suprimentos'
ROLES = ['SERVENTE DE PEDREIRO I', 'SERVENTE DE PEDREIRO II', 'SERVENTE DE PEDREIRO III',
         'PEDREIRO I', 'PEDREIRO II', 'PEDREIRO III', 'MESTRE DE OBRAS']

METHODS = '''
    def _migrate_supplier_employment_steps(self, state: dict) -> None:
        if state.get("flow") != "supply_supplier_registration" or state.get("supplier_employment_version") == 1:
            return
        steps = self._flow_config(state)["steps"]
        added = {"vinculo_fornecedor_suprimentos", "cargo_fornecedor_suprimentos"}
        if not added.issubset({step["key"] for step in steps}):
            return
        legacy = [step for step in steps if step["key"] not in added]
        indices = {step["key"]: index for index, step in enumerate(steps)}
        def translate(index):
            return indices[legacy[index]["key"]] if index < len(legacy) else len(steps)
        state["step_index"] = translate(state["step_index"])
        if state.get("edit_step_indices") is not None:
            state["edit_step_indices"] = [translate(index) for index in state["edit_step_indices"]]
        if state.get("stage") == "editing_field_choice":
            for option in state.get("options") or []:
                value = option.get("value")
                if isinstance(value, int) and not isinstance(value, bool) and 0 <= value < len(legacy):
                    option["value"] = translate(value)
        state["supplier_employment_version"] = 1

    def _supplier_employment_review(self, state: dict, etag):
        if state.get("flow") != "supply_supplier_registration":
            return None
        self._migrate_supplier_employment_steps(state)
        steps = self._flow_config(state)["steps"]
        keys = ("vinculo_fornecedor_suprimentos", "cargo_fornecedor_suprimentos")
        selected = {step["key"]: (index, step) for index, step in enumerate(steps) if step["key"] in keys}
        if len(selected) != 2:
            return None
        fields = state.get("fields") or {}
        if normalize_text(str(fields.get("EMPREITEIRO") or "")) != "sim":
            for _, step in selected.values():
                self._clear_step_value(state, step)
            return None
        link = fields.get("VINCULO")
        links = {option["value"] for option in selected[keys[0]][1]["source"]["options"]}
        roles = {option["value"] for option in selected[keys[1]][1]["source"]["options"]}
        missing = []
        if link not in links:
            missing = [selected[keys[0]][0], selected[keys[1]][0]]
        elif link == "CLT":
            if fields.get("CARGO") not in roles:
                missing = [selected[keys[1]][0]]
        else:
            self._clear_step_value(state, selected[keys[1]][1])
        if not missing:
            return None
        for index in missing:
            self._clear_step_value(state, steps[index])
        state["edit_step_indices"] = missing
        state["step_index"] = missing[0]
        state["stage"] = "selecting_fields"
        state["options"] = []
        return self._prompt_next_or_summary(state, etag)

'''

def replace_once(text, before, after):
    if text.count(before) != 1:
        raise RuntimeError('Patch context is absent or ambiguous.')
    return text.replace(before, after, 1)

def candidate_workflow(data):
    if hashlib.sha256(data).hexdigest() != WORKFLOW_SHA:
        raise RuntimeError('Workflow baseline drift.')
    source = data.decode('utf-8')
    source = replace_once(source, '    def _current_step(self, state: dict):\n',
                          METHODS + '    def _current_step(self, state: dict):\n        self._migrate_supplier_employment_steps(state)\n')
    source = replace_once(source, '    def _commit(self, state: dict, etag: str | None) -> dict:\n',
                          '    def _commit(self, state: dict, etag: str | None) -> dict:\n'
                          '        employment_review = self._supplier_employment_review(state, etag)\n'
                          '        if employment_review is not None:\n'
                          '            return employment_review\n')
    source = replace_once(source, '    def _prompt_edit_field(self, state: dict, etag: str | None) -> dict:\n',
                          '    def _prompt_edit_field(self, state: dict, etag: str | None) -> dict:\n'
                          '        self._migrate_supplier_employment_steps(state)\n')
    source = replace_once(source, '    def _handle_edit_field_reply(\n        self, event: dict, state: dict, etag: str | None\n    ) -> dict:\n',
                          '    def _handle_edit_field_reply(\n        self, event: dict, state: dict, etag: str | None\n    ) -> dict:\n'
                          '        self._migrate_supplier_employment_steps(state)\n')
    return source.encode('utf-8')

def candidate_config(data):
    if hashlib.sha256(data).hexdigest() != CONFIG_SHA:
        raise RuntimeError('Configuration baseline drift.')
    source = data.decode('utf-8').replace('\r\n','\n')
    prefix = '"supply_supplier_registration_flow": '
    start = source.index(prefix) + len(prefix)
    _, end = json.JSONDecoder().raw_decode(source, start)
    before, after = source[:start], source[end:]
    source = source[start:end]
    yes = {'field':'EMPREITEIRO', 'equals':'SIM'}
    clt = {'all':[yes, {'field':'VINCULO','equals':'CLT'}]}
    additions = [
        {'key':LINK,'kind':'selection','target_field':'VINCULO','prompt':'QUAL É O VÍNCULO DO FORNECEDOR?',
         'button_label':'ESCOLHER VÍNCULO','when':yes,'default_value':'','default_display_value':'',
         'source':{'type':'static','options':[{'id':i,'title':value,'value':value} for i,value in enumerate(['CLT','TERCEIRIZADO','INFORMAL'],1)]}},
        {'key':ROLE,'kind':'selection','target_field':'CARGO','prompt':'QUAL É O CARGO DO FORNECEDOR?',
         'button_label':'ESCOLHER CARGO','when':clt,'default_value':'','default_display_value':'',
         'source':{'type':'static','options':[{'id':i,'title':value,'value':value} for i,value in enumerate(ROLES,1)]}},
    ]
    encoded = ''.join('\n'.join('        '+line for line in json.dumps(step,ensure_ascii=False,indent=2).splitlines())+',\n' for step in additions)
    anchor = '        {\n          "key": "homologacao_fornecedor_suprimentos"'
    source = replace_once(source, anchor, encoded+anchor)
    summary = [{'field':'VINCULO','label':'VÍNCULO','when':yes},{'field':'CARGO','label':'CARGO','when':clt}]
    encoded = ''.join('\n'.join('        '+line for line in json.dumps(row,ensure_ascii=False,indent=2).splitlines())+',\n' for row in summary)
    anchor = '        {\n          "field": "PROFISSAO",\n          "label": "PROFISSÃO"'
    source = replace_once(source, anchor, encoded+anchor)
    source = before + source + after
    original, changed = json.loads(data), json.loads(source)
    original_flow = original['sharepoint']['supply_supplier_registration_flow']
    expected = json.loads(json.dumps(original_flow))
    index = next(i for i,s in enumerate(expected['steps']) if s['key']=='empreiteiro_fornecedor_suprimentos')+1
    expected['steps'][index:index] = additions
    index = next(i for i,s in enumerate(expected['summary_fields']) if s['field']=='PROFISSAO')
    expected['summary_fields'][index:index] = summary
    assert changed['sharepoint']['supply_supplier_registration_flow'] == expected
    changed['sharepoint']['supply_supplier_registration_flow'] = original_flow
    assert changed == original
    return source.replace('\n','\r\n').encode('utf-8') if b'\r\n' in data else source.encode('utf-8')

if __name__ == '__main__':
    root = Path(sys.argv[1]).resolve()
    candidates = [(root/'worker'/name, transform((root/'worker'/name).read_bytes())) for name, transform in [('workflow.py',candidate_workflow),('workflow_config.json',candidate_config)]]
    for path, data in candidates:
        path.write_bytes(data)
        name = path.name
        print(name,hashlib.sha256(path.read_bytes()).hexdigest())
