"""Add Screen16_3/Form53_1 taxation registration while preserving previous settings."""
import copy
import hashlib
import json
import sys
from pathlib import Path

CONFIG_SHA = 'bf26a24ad1902791127609a522153549dcedb0492155c7a77572e3c964876f04'
FIELDS = [('TRIBUTACAO', 'TRIBUTAÇÃO'), ('STATUS', 'STATUS'), ('DESCRICAO', 'DESCRIÇÃO')]


def taxation_flow():
    return {
        'target_list': 'TRIBUTAÇÃO',
        'idempotency_field': 'Title',
        'powerapps_reference': 'Screen16_3.pa.yaml#Form53_1',
        'attachments_after_fields': False, 'attachments_required': False,
        'fixed_fields': [],
        'confirmation_prompt': 'CONFIRMA O CADASTRO DESTA TRIBUTAÇÃO?',
        'completion_subject': 'Tributação', 'completion_verb': 'cadastrada',
        'summary_fields': [{'field': field, 'label': label} for field, label in FIELDS],
        'steps': [
            {'key': field.lower() + '_cadastro_tributacao', 'kind': 'text',
             'target_field': field, 'edit_label': label,
             'prompt': f'INFORME {label} OU ESCOLHA EM BRANCO.',
             'blank_commands': ['EM BRANCO', 'PULAR'],
             'blank_option': {'id': 'taxation_blank', 'title': 'EM BRANCO', 'reply': 'taxation_blank'}}
            for field, label in FIELDS
        ]
    }


def apply_config(original):
    candidate = copy.deepcopy(original)
    assert 'taxation_registration_flow' not in candidate['sharepoint'], 'Fluxo já existe'
    actions = candidate['whatsapp']['submenus']['financial_registrations']['actions']
    assert [a['id'] for a in actions] == [
        'action_register_investment', 'action_register_institution',
        'action_register_investment_type', 'action_register_profitability'], 'Menu mudou; revisar'
    actions.append({'id': 'action_register_taxation', 'title': '📋 CADASTRO TRIBUTAÇÃO',
                    'aliases': ['CADASTRO TRIBUTAÇÃO', 'CADASTRO TRIBUTACAO', 'CADASTRAR TRIBUTAÇÃO'],
                    'flow': 'taxation_registration'})
    candidate['sharepoint']['taxation_registration_flow'] = taxation_flow()
    recovered = copy.deepcopy(candidate)
    recovered['whatsapp']['submenus']['financial_registrations']['actions'].pop()
    recovered['sharepoint'].pop('taxation_registration_flow')
    assert recovered == original
    return candidate


if __name__ == '__main__':
    source, destination = map(Path, sys.argv[1:3])
    assert hashlib.sha256(source.read_bytes()).hexdigest() == CONFIG_SHA, 'Configuração mudou; não substituir'
    candidate = apply_config(json.loads(source.read_text(encoding='utf-8')))
    sys.path.insert(0, '/opt/energetica-whatsapp/worker')
    from config import validate_workflow_config
    validate_workflow_config(candidate)
    with destination.open('w', encoding='utf-8') as stream:
        json.dump(candidate, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    destination.chmod(0o600)
    print('Configuração preparada: CADASTRO TRIBUTAÇÃO (Form53_1); demais configurações preservadas.')
