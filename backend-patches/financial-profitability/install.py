"""Add Screen16_2/Form53 without replacing existing menus or registration flows."""
import copy
import hashlib
import json
import sys
from pathlib import Path

CONFIG_SHA = '8fbf00bfd699d680d33a1f72f06a5bed5461221145d11aa7c72eb4be884c153f'


def profitability_flow():
    return {
        'target_list': 'RENTABILIDADE',
        'idempotency_field': 'Title',
        'powerapps_reference': 'Screen16_2.pa.yaml#Form53',
        'attachments_after_fields': False, 'attachments_required': False,
        'fixed_fields': [],
        'confirmation_prompt': 'CONFIRMA O CADASTRO DESTA RENTABILIDADE?',
        'completion_subject': 'Rentabilidade', 'completion_verb': 'cadastrada',
        'summary_fields': [{'field': 'RENTABILIDADE', 'label': 'RENTABILIDADE'},
                           {'field': 'STATUS', 'label': 'STATUS'}],
        'steps': [
            {'key': 'nome_cadastro_rentabilidade', 'kind': 'text',
             'target_field': 'RENTABILIDADE', 'edit_label': 'RENTABILIDADE',
             'prompt': 'INFORME A RENTABILIDADE OU ESCOLHA EM BRANCO.',
             'blank_commands': ['EM BRANCO', 'PULAR'],
             'blank_option': {'id': 'profitability_blank', 'title': 'EM BRANCO', 'reply': 'profitability_blank'}},
            {'key': 'status_cadastro_rentabilidade', 'kind': 'selection',
             'target_field': 'STATUS', 'edit_label': 'STATUS',
             'prompt': 'SELECIONE O STATUS DA RENTABILIDADE.', 'button_label': 'ESCOLHER STATUS',
             'source': {'type': 'static', 'options': [
                 {'id': 1, 'title': 'ATIVO', 'value': 'ATIVO'},
                 {'id': 2, 'title': 'INATIVO', 'value': 'INATIVO'}]}}
        ]
    }


def apply_config(original):
    candidate = copy.deepcopy(original)
    assert 'profitability_registration_flow' not in candidate['sharepoint'], 'Fluxo já existe'
    actions = candidate['whatsapp']['submenus']['financial_registrations']['actions']
    assert [a['id'] for a in actions] == [
        'action_register_investment', 'action_register_institution',
        'action_register_investment_type'], 'Menu mudou; revisar'
    actions.append({'id': 'action_register_profitability', 'title': '📈 CADASTRO DE RENTABILIDADE',
                    'aliases': ['CADASTRO DE RENTABILIDADE', 'CADASTRO RENTABILIDADE', 'CADASTRAR RENTABILIDADE'],
                    'flow': 'profitability_registration'})
    candidate['sharepoint']['profitability_registration_flow'] = profitability_flow()
    recovered = copy.deepcopy(candidate)
    recovered['whatsapp']['submenus']['financial_registrations']['actions'].pop()
    recovered['sharepoint'].pop('profitability_registration_flow')
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
    print('Configuração preparada: CADASTRO DE RENTABILIDADE (Form53); demais configurações preservadas.')
