"""Narrow, fail-closed patch from independently captured production variants."""
import copy
import hashlib
import json
from pathlib import Path
import sys

KEY = 'homologacao_fornecedor_suprimentos'
FLOW = 'supply_supplier_registration_flow'
BEFORE = {
    'workflow-app.py': '5381bee49c38d73928c27818579d5da727439d4d43e3c5ea2916c6bcfc7e4521',
    'workflow.py': '92cfeb7cf370d5f53fb10b9477da420202c24f8f07b26a3d4ef068009cff36e7',
    'workflow_config.json': '605496578bd8550c6fc9d6a74b938f96b776b29a52130543d05c6134d1732232',
}


def patch_config(config):
    result = copy.deepcopy(config)
    matches = [step for step in result['sharepoint'][FLOW]['steps'] if step.get('key') == KEY]
    if len(matches) != 1:
        raise ValueError('Homologation question is missing or ambiguous')
    step = matches[0]
    if (step.get('kind') != 'selection' or step.get('target_field') != 'HOMOLOGAÇÃO'
            or step.get('confirm_recommended') is not True):
        raise ValueError('Homologation question differs from reviewed source')
    source = step['source']
    if source.get('type') != 'conditional' or len(source.get('branches', [])) != 1:
        raise ValueError('Unexpected supplier branches')
    branch = source['branches'][0]
    if branch.get('when') != {'field': 'EMPREITEIRO', 'equals': 'SIM'}:
        raise ValueError('Unexpected contractor condition')
    for choices, expected in [(branch['source'], {1: 'SIM', 2: 'NÃO'}),
                              (source['default'], {1: 'NÃO', 2: 'SIM'})]:
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
    before = '        control = normalize_text(str(raw_reply))\n'
    after = before + '''        # Refresh this binary question in sessions holding the old default menu.
        # Keep the configured IDs so legacy keep buttons never invert a value.
        if (state.get("flow") == "supply_supplier_registration"
                and step.get("key") == "homologacao_fornecedor_suprimentos"):
            state["options"] = self._selection_options(state, step)
'''
    if method.count(before) != 1 or 'legacy keep buttons never invert' in method:
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
