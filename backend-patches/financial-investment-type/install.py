"""Add the Screen16_1/Form55 registration while preserving all prior settings."""
import copy
import hashlib
import json
import sys
from pathlib import Path

CONFIG_SHA = 'c7bf283e1d5b1ba42d7f838b2b9be5dff7904c560e76768117a9442cbab87e66'


def investment_type_flow():
    return {
        'target_list': 'CADASTROTIPOINVESTIMENTO',
        'idempotency_field': 'Title',
        'powerapps_reference': 'Screen16_1.pa.yaml#Form55',
        'attachments_after_fields': False, 'attachments_required': False,
        'fixed_fields': [],
        'confirmation_prompt': 'CONFIRMA O CADASTRO DESTE TIPO DE INVESTIMENTO?',
        'completion_subject': 'Tipo de investimento', 'completion_verb': 'cadastrado',
        'summary_fields': [{'field': 'TIPO', 'label': 'TIPO'},
                           {'field': 'DESCRICAO', 'label': 'DESCRIÇÃO'},
                           {'field': 'STATUS', 'label': 'STATUS'}],
        'steps': [
            {'key': 'tipo_cadastro_tipo_investimento', 'kind': 'selection',
             'target_field': 'TIPO', 'edit_label': 'TIPO',
             'prompt': 'SELECIONE O TIPO DE INVESTIMENTO.', 'button_label': 'ESCOLHER TIPO',
             'source': {'type': 'static', 'options': [
                 {'id': 1, 'title': 'RENDA FIXA', 'value': 'RENDA FIXA'},
                 {'id': 2, 'title': 'RENDA VARIÁVEL', 'value': 'RENDA VARIÁVEL'}]}},
            {'key': 'descricao_cadastro_tipo_investimento', 'kind': 'text',
             'target_field': 'DESCRICAO', 'edit_label': 'DESCRIÇÃO',
             'prompt': 'INFORME A DESCRIÇÃO OU ESCOLHA EM BRANCO.',
             'blank_commands': ['EM BRANCO', 'PULAR'],
             'blank_option': {'id': 'investment_type_blank', 'title': 'EM BRANCO', 'reply': 'investment_type_blank'}},
            {'key': 'status_cadastro_tipo_investimento', 'kind': 'selection',
             'target_field': 'STATUS', 'edit_label': 'STATUS',
             'prompt': 'SELECIONE O STATUS.', 'button_label': 'ESCOLHER STATUS',
             'source': {'type': 'static', 'options': [
                 {'id': 1, 'title': 'ATIVO', 'value': 'ATIVO'},
                 {'id': 2, 'title': 'INATIVO', 'value': 'INATIVO'}]}}
        ]
    }


def apply_config(original):
    candidate = copy.deepcopy(original)
    assert 'investment_type_registration_flow' not in candidate['sharepoint'], 'Fluxo já existe'
    actions = candidate['whatsapp']['submenus']['financial_registrations']['actions']
    assert [a['id'] for a in actions] == ['action_register_investment', 'action_register_institution'], 'Menu mudou; revisar'
    actions.append({'id': 'action_register_investment_type', 'title': '📊 CADASTRO TIPO INVESTIMENTO',
                    'aliases': ['CADASTRO TIPO INVESTIMENTO', 'CADASTRAR TIPO INVESTIMENTO'],
                    'flow': 'investment_type_registration'})
    candidate['sharepoint']['investment_type_registration_flow'] = investment_type_flow()
    recovered = copy.deepcopy(candidate)
    recovered['whatsapp']['submenus']['financial_registrations']['actions'].pop()
    recovered['sharepoint'].pop('investment_type_registration_flow')
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
    print('Configuração preparada: CADASTRO TIPO INVESTIMENTO (Form55); demais configurações preservadas.')
