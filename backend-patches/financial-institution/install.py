"""Extend Financial registrations with the Screen16/Form54 institution contract."""
import copy
import hashlib
import json
import sys
from pathlib import Path

CONFIG_SHA = '72ccd5c9c50d4be173cac492ab329c6a56871ed6836fba02a47b7ae8d8ce1cce'


def institution_flow():
    return {
        'target_list': 'INSTITUICAOEMISSORA',
        'idempotency_field': 'Title',
        'powerapps_reference': 'Screen16.pa.yaml#Form54',
        'attachments_after_fields': False, 'attachments_required': False,
        'fixed_fields': [],
        'confirmation_prompt': 'CONFIRMA O CADASTRO DESTA INSTITUIÇÃO?',
        'completion_subject': 'Instituição', 'completion_verb': 'cadastrada',
        'summary_fields': [{'field': 'INSTITUICAOEMISSORA', 'label': 'INSTITUIÇÃO EMISSORA'},
                           {'field': 'STATUS', 'label': 'STATUS'}],
        'steps': [
            {'key': 'nome_cadastro_instituicao', 'kind': 'text',
             'target_field': 'INSTITUICAOEMISSORA', 'edit_label': 'INSTITUIÇÃO EMISSORA',
             'prompt': '🏦 INFORME O NOME DA INSTITUIÇÃO EMISSORA OU ESCOLHA EM BRANCO.',
             'blank_commands': ['EM BRANCO', 'PULAR'],
             'blank_option': {'id': 'institution_blank', 'title': 'EM BRANCO', 'reply': 'institution_blank'}},
            {'key': 'status_cadastro_instituicao', 'kind': 'selection',
             'target_field': 'STATUS', 'edit_label': 'STATUS',
             'prompt': 'SELECIONE O STATUS DA INSTITUIÇÃO.', 'button_label': 'ESCOLHER STATUS',
             'source': {'type': 'static', 'options': [
                 {'id': 1, 'title': 'ATIVO', 'value': 'ATIVO'},
                 {'id': 2, 'title': 'INATIVO', 'value': 'INATIVO'}]}}
        ]
    }


def apply_config(original):
    candidate = copy.deepcopy(original)
    assert 'institution_registration_flow' not in candidate['sharepoint'], 'Fluxo já existe'
    actions = candidate['whatsapp']['submenus']['financial_registrations']['actions']
    assert [a['id'] for a in actions] == ['action_register_investment'], 'Menu mudou; revisar antes de substituir'
    actions.append({'id': 'action_register_institution', 'title': '🏦 CADASTRO INSTITUIÇÃO',
                    'aliases': ['CADASTRO INSTITUIÇÃO', 'CADASTRO INSTITUICAO', 'CADASTRAR INSTITUIÇÃO'],
                    'flow': 'institution_registration'})
    candidate['sharepoint']['institution_registration_flow'] = institution_flow()
    recovered = copy.deepcopy(candidate)
    recovered['whatsapp']['submenus']['financial_registrations']['actions'].pop()
    recovered['sharepoint'].pop('institution_registration_flow')
    assert recovered == original
    return candidate


if __name__ == '__main__':
    source, destination = map(Path, sys.argv[1:3])
    assert hashlib.sha256(source.read_bytes()).hexdigest() == CONFIG_SHA, 'Configuração mudou; não substituir'
    original = json.loads(source.read_text(encoding='utf-8'))
    candidate = apply_config(original)
    sys.path.insert(0, '/opt/energetica-whatsapp/worker')
    from config import validate_workflow_config
    validate_workflow_config(candidate)
    with destination.open('w', encoding='utf-8') as stream:
        json.dump(candidate, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    destination.chmod(0o600)
    print('Configuração preparada: CADASTRO INSTITUIÇÃO (Form54); demais configurações preservadas.')
