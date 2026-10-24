"""Generate guarded candidates from independently captured app/build sources."""
import copy
import hashlib
import json
from pathlib import Path
import sys

KEY = 'atividade_demonstrativo_etapa'
INSTRUCTION = ('SE PREFERIR, DIGITE SUA PRÓPRIA DESCRIÇÃO E CLIQUE EM ENVIAR PARA USÁ-LA '
               'COMO DESCRIÇÃO DA ATIVIDADE. VOCÊ TAMBÉM PODE FILTRAR E SELECIONAR UMA DAS OPÇÕES.')


def replace_once(source, before, after):
    if source.count(before) != 1:
        raise ValueError('Reviewed source anchor differs or is ambiguous')
    return source.replace(before, after, 1)


def patch_config(config):
    result = copy.deepcopy(config)
    steps = result['sharepoint']['construction_stage_demonstrative_create_flow']['steps']
    matches = [step for step in steps if step.get('key') == KEY]
    if len(matches) != 1:
        raise ValueError('Activity question is missing or ambiguous')
    step = matches[0]
    if (step.get('target_field') != 'ATIVIDADEEXECUTADA' or step.get('kind') != 'selection'
            or step.get('source', {}).get('list') != 'ATIVIDADE EXECUTADA'
            or any(key in step for key in ('free_text_target_field', 'filter_with_direct_text', 'direct_text_instruction'))):
        raise ValueError('Activity question contract differs from reviewed source')
    step.update(free_text_target_field='ATIVIDADEEXECUTADA', filter_with_direct_text=True,
                direct_text_instruction=INSTRUCTION)
    # Absence of catalog suggestions must no longer exit a valid free-text step.
    step.pop('empty_message', None)
    return result


def patch_workflow(source):
    start = source.index('    def _direct_text_selection_step(')
    end = source.index('\n    def ', start + 1)
    method = replace_once(source[start:end],
        '''        instruction = (
            "DIGITE DIRETAMENTE A OBSERVAÇÃO OU DESCRIÇÃO, "
            "OU SELECIONE UMA DAS OPÇÕES ABAIXO."
        )''',
        '''        instruction = str(step.get("direct_text_instruction") or (
            "DIGITE DIRETAMENTE A OBSERVAÇÃO OU DESCRIÇÃO, "
            "OU SELECIONE UMA DAS OPÇÕES ABAIXO."
        )).strip()''')
    result = source[:start] + method + source[end:]
    compile(result, 'workflow.py', 'exec')
    return result


def patch_bridge(source):
    start = source.index('    def _send_option_poll(')
    end = source.index('\n\nclass ', start + 1)
    method = replace_once(source[start:end],
        '            and not step.get("accepts_direct_text")\n            and self.messages\n',
        '            and (not step.get("accepts_direct_text") or step.get("filter_with_direct_text") is True)\n            and self.messages\n')
    method = replace_once(method,
        '            self.messages[-1]["databaseFilterKey"] = str(step["key"])\n',
        '            self.messages[-1]["databaseFilterKey"] = str(step["key"])\n'
        '            if step.get("accepts_direct_text") and step.get("filter_with_direct_text") is True:\n'
        '                self.messages[-1]["acceptsCustomText"] = True\n')
    result = source[:start] + method + source[end:]
    compile(result, 'channel_bridge.py', 'exec')
    return result


def generate(source, output):
    entries = []
    for scope, prefix in [('app', '/opt/energetica-whatsapp'), ('build', '/home/opc/energetica-build')]:
        for relative, original, transform in [
            ('worker/workflow.py', 'workflow-app.py' if scope == 'app' else 'workflow.py', patch_workflow),
            ('channel_bridge.py', 'channel_bridge-app.py' if scope == 'app' else 'channel_bridge.py', patch_bridge),
            ('worker/workflow_config.json', 'workflow_config.json',
             lambda text: json.dumps(patch_config(json.loads(text)), ensure_ascii=False, indent=2) + '\n'),
        ]:
            before = (source / original).read_bytes()
            after = transform(before.decode('utf-8')).encode('utf-8')
            candidate = output / scope / relative
            candidate.parent.mkdir(parents=True, exist_ok=True)
            candidate.write_bytes(after)
            entries.append({'destination': prefix + '/' + relative, 'candidate': scope + '/' + relative,
                'before_sha256': hashlib.sha256(before).hexdigest(), 'after_sha256': hashlib.sha256(after).hexdigest()})
    manifest = {'files': entries}
    (output / 'deploy-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    return manifest


if __name__ == '__main__':
    generate(Path(sys.argv[1]), Path(sys.argv[2]))
