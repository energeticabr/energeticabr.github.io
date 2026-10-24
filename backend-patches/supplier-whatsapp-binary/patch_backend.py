"""Scoped WhatsApp binary correction from independently pinned live variants."""
import copy
import hashlib
import json
from pathlib import Path
import sys

KEY = 'whatsapp_fornecedor_suprimentos'
FLOW = 'supply_supplier_registration_flow'
BEFORE = {
    'workflow-app.py': 'daaa4bede95e2cc0b5ffae9111e650ec0d6888de2e65f27babaa2d260def110a',
    'workflow.py': '5b75fe7fd87a6ad48c0d0386affd1fc31a60da273ae8f3d8a2477f8cdc3dbc69',
    'workflow_config.json': '1c506179510c7763c6fee975b48b13d5a108238fddd02dda49ba4e91a127d216',
}


def patch_config(config):
    result = copy.deepcopy(config)
    matches = [step for step in result['sharepoint'][FLOW]['steps'] if step.get('key') == KEY]
    if len(matches) != 1:
        raise ValueError('WhatsApp question is missing or ambiguous')
    step = matches[0]
    if (step.get('kind') != 'selection' or step.get('target_field') != 'WHATSAPP'
            or step.get('confirm_recommended') is not True):
        raise ValueError('WhatsApp question differs from reviewed source')
    source = step['source']
    if source.get('type') != 'conditional' or len(source.get('branches', [])) != 1:
        raise ValueError('Unexpected phone branches')
    branch = source['branches'][0]
    if branch.get('when') != {'field': 'TELEFONECONTATO', 'is_blank': True}:
        raise ValueError('Unexpected blank-phone condition')
    for choices, expected in [(branch['source'], {1: 'NÃO', 2: 'SIM'}),
                              (source['default'], {1: 'SIM', 2: 'NÃO'})]:
        if (choices.get('type') != 'static' or len(choices['options']) != 2
                or {item['id']: item['value'] for item in choices['options']} != expected):
            raise ValueError('Legacy binary IDs or values have changed')
        for item in choices['options']:
            item['title'] = item['value']
            item.pop('recommended', None)
    del step['confirm_recommended']
    return result


def patch_workflow(source):
    start = source.index('    def _handle_selection_reply(')
    end = source.index('\n    def ', start + 1)
    method = source[start:end]
    before = '''        if (state.get("flow") == "supply_supplier_registration"
                and step.get("key") == "homologacao_fornecedor_suprimentos"):
            state["options"] = self._selection_options(state, step)
'''
    after = '''        if (state.get("flow") == "supply_supplier_registration"
                and step.get("key") in {
                    "homologacao_fornecedor_suprimentos", "whatsapp_fornecedor_suprimentos",
                }):
            state["options"] = self._selection_options(state, step)
'''
    if method.count(before) != 1:
        raise ValueError('Selection refresh anchor differs or is ambiguous')
    result = source[:start] + method.replace(before, after, 1) + source[end:]
    compile(result, 'workflow.py', 'exec')
    return result


def generate(source, output):
    originals = {name: (source / name).read_bytes() for name in BEFORE}
    for name, content in originals.items():
        if hashlib.sha256(content).hexdigest() != BEFORE[name]:
            raise ValueError('Captured source drift: ' + name)
    entries = []
    for scope, root, original in [('app', '/opt/energetica-whatsapp', 'workflow-app.py'),
                                   ('build', '/home/opc/energetica-build', 'workflow.py')]:
        for relative, name, transform in [
            ('worker/workflow.py', original, patch_workflow),
            ('worker/workflow_config.json', 'workflow_config.json',
             lambda text: json.dumps(patch_config(json.loads(text)), ensure_ascii=False, indent=2) + '\n'),
        ]:
            before = originals[name]
            after = transform(before.decode('utf-8')).encode('utf-8')
            target = output / scope / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(after)
            entries.append({'destination': root + '/' + relative, 'candidate': scope + '/' + relative,
                            'before_sha256': BEFORE[name], 'after_sha256': hashlib.sha256(after).hexdigest()})
    manifest = {'files': entries}
    (output / 'deploy-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    return manifest


if __name__ == '__main__':
    generate(Path(sys.argv[1]), Path(sys.argv[2]))
