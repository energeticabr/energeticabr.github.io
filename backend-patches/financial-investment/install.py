"""Add the financial menu and Form45 contract without replacing other flows."""
import copy
import hashlib
import json
import sys
from pathlib import Path

CONFIG_SHA = '8ba5c2679be440604e81e1560e58a28f22a1a10c8478164780a80ed57a36f0fc'
FIELD_LABELS = [('DESCRICAO', 'DESCRIÇÃO'), ('TIPO', 'TIPO'),
                ('INVESTIMENTO', 'INVESTIMENTO'), ('TRIBUTAÇÃO', 'TRIBUTAÇÃO'),
                ('RENTABILIDADE', 'RENTABILIDADE'), ('LIQUIDEZ', 'LIQUIDEZ'), ('RISCO', 'RISCO')]


def investment_flow():
    steps = [{
        'key': 'instituicao_cadastro_investimento', 'kind': 'selection', 'target_field': 'INSTITUICAO',
        'prompt': '🏦 SELECIONE A INSTITUIÇÃO EMISSORA. CASO DESEJE FILTRAR, DIGITE UM TEXTO.',
        'edit_label': 'INSTITUIÇÃO', 'button_label': 'ESCOLHER INSTITUIÇÃO', 'allow_blank': True,
        'source': {'type': 'sharepoint_list', 'list': 'INSTITUICAOEMISSORA', 'id_field': 'Id',
                   'label_field': 'INSTITUICAOEMISSORA', 'value_field': 'INSTITUICAOEMISSORA',
                   'distinct': True, 'sort_field': 'Id', 'top': 5000},
    }]
    for field, label in FIELD_LABELS:
        steps.append({'key': field.lower() + '_cadastro_investimento', 'kind': 'text', 'target_field': field,
                      'prompt': f'📝 INFORME {label} OU ESCOLHA EM BRANCO.', 'edit_label': label,
                      'blank_commands': ['EM BRANCO', 'PULAR'],
                      'blank_option': {'id': 'investment_blank', 'title': 'EM BRANCO', 'reply': 'investment_blank'}})
    steps.append({'key': 'prazo_cadastro_investimento', 'kind': 'date', 'target_field': 'PRAZO',
                  'prompt': '📅 INFORME A DATA DO PRAZO OU ESCOLHA EM BRANCO.', 'edit_label': 'PRAZO',
                  'presets': [{'id': 'investment_date_today', 'title': 'HOJE', 'days_from_today': 0},
                              {'id': 'investment_date_other', 'title': 'OUTRA DATA', 'other': True},
                              {'id': 'investment_date_blank', 'title': 'EM BRANCO', 'blank': True}]})
    return {'target_list': 'CADASTRO INVESTIMENTO', 'idempotency_field': 'Title',
            'powerapps_reference': 'Screen15.pa.yaml#Form45', 'attachments_after_fields': False,
            'attachments_required': False, 'fixed_fields': [],
            'confirmation_prompt': 'CONFIRMA O CADASTRO DESTE INVESTIMENTO?',
            'completion_subject': 'Investimento', 'completion_verb': 'cadastrado',
            'summary_fields': [{'field': 'INSTITUICAO', 'label': 'INSTITUIÇÃO'}]
                              + [{'field': f, 'label': l} for f,l in FIELD_LABELS]
                              + [{'field': 'PRAZO', 'label': 'PRAZO'}], 'steps': steps}


def apply_config(original):
    candidate = copy.deepcopy(original)
    whatsapp = candidate['whatsapp']
    assert not any(g['id'] == 'group_financial' for g in whatsapp['start_groups']), 'Menu financeiro já existe'
    assert 'investment_registration_flow' not in candidate['sharepoint'], 'Fluxo já existe'
    group = {'id': 'group_financial', 'title': '💵 FINANCEIRO', 'aliases': ['FINANCEIRO']}
    index = next(i for i,g in enumerate(whatsapp['start_groups']) if g['id'] == 'group_supplies') + 1
    whatsapp['start_groups'].insert(index, group)
    whatsapp['start_actions'].append({'id': 'action_financial_registrations', 'title': '🗂️ CADASTROS',
                                      'aliases': ['CADASTROS', 'CADASTROS FINANCEIROS'],
                                      'group': 'group_financial', 'submenu': 'financial_registrations'})
    assert 'financial_registrations' not in whatsapp['submenus'], 'Submenu já existe'
    whatsapp['submenus']['financial_registrations'] = {
        'title': '🗂️ CADASTROS', 'prompt': 'QUAL CADASTRO FINANCEIRO VOCÊ DESEJA EFETUAR?',
        'actions': [{'id': 'action_register_investment', 'title': '📈 CADASTRO INVESTIMENTO',
                     'aliases': ['CADASTRO INVESTIMENTO', 'CADASTRAR INVESTIMENTO'],
                     'flow': 'investment_registration'}]}
    candidate['sharepoint']['investment_registration_flow'] = investment_flow()
    # Removing only the additions must recover every original setting exactly.
    recovered = copy.deepcopy(candidate)
    recovered['whatsapp']['start_groups'].pop(index)
    recovered['whatsapp']['start_actions'].pop()
    recovered['whatsapp']['submenus'].pop('financial_registrations')
    recovered['sharepoint'].pop('investment_registration_flow')
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
    print('Configuração preparada: FINANCEIRO → CADASTROS → CADASTRO INVESTIMENTO; demais configurações preservadas.')
