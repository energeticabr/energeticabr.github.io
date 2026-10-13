"""Inline catalog registrations for financial forms, using existing child flows."""
import copy

FINANCIAL_FLOWS = frozenset({
    'financial_movement',
    'investment_registration', 'institution_registration', 'investment_type_registration',
    'profitability_registration', 'taxation_registration',
})
CREATE_ID = 'financial_catalog_create'
CREATE_ACTION = 'start_financial_catalog_registration'
RETURN_TYPE = 'financial_catalog_registration'


def catalog(engine, state, step):
    source = step.get('source') or {}
    if (state.get('flow') not in FINANCIAL_FLOWS or step.get('kind') != 'selection'
            or source.get('type') != 'sharepoint_list'):
        return None
    for name in sorted(FINANCIAL_FLOWS):
        child = engine.config['sharepoint'].get(name + '_flow', {})
        if (name != state.get('flow') and child.get('target_list') == source.get('list')
                and source.get('label_field') in {s.get('target_field') for s in child.get('steps', [])}):
            return {'flow': name, 'label': child.get('completion_subject', 'dado'),
                    'label_field': source['label_field'],
                    'value_field': source.get('value_field', source['label_field'])}
    return None


def step_with_create(engine, state, step):
    info = catalog(engine, state, step)
    if info is None:
        return step
    displayed = copy.deepcopy(step)
    terminals = displayed.setdefault('terminal_options', [])
    if not any(str(o.get('id')) == CREATE_ID for o in terminals):
        terminals.append({'id': CREATE_ID, 'title': '➕ CADASTRAR ' + info['label'].upper(),
                          'action': CREATE_ACTION})
    return displayed


def start(engine, state, etag):
    info = catalog(engine, state, engine._current_step(state))
    if info is None:
        raise RuntimeError('Cadastro financeiro indisponível para esta pergunta')
    # A delayed page action from the parent must not render its choices in a
    # child text question. Returning reloads the parent catalog from its source.
    state.pop('option_pagination', None)
    return engine._start_embedded_launch_registration(
        state, etag, flow=info['flow'], return_type=RETURN_TYPE,
        heading='➕ CADASTRO DE ' + info['label'].upper())


def restore_parent(state):
    embedded = state.get('embedded_return') or {}
    if embedded.get('type') != RETURN_TYPE or not isinstance(embedded.get('state'), dict):
        raise RuntimeError('Retorno do cadastro financeiro não encontrado')
    parent = copy.deepcopy(embedded['state'])
    shared = {key: copy.deepcopy(state[key]) for key in (
        'schema_version', 'navigation_storage_version', 'key', 'batch_id', 'conversation_id',
        'group_id', 'group_subject', 'sender', 'sender_name', 'phone_number_id', 'created_at',
        'processed_message_ids') if key in state}
    state.clear()
    state.update(shared)
    state.update(parent)
    if 'processed_message_ids' in shared:
        state['processed_message_ids'] = shared['processed_message_ids']


def complete(engine, state, etag, item_id):
    child_fields = copy.deepcopy(state.get('fields', {}))
    restore_parent(state)
    step = engine._current_step(state)
    info = catalog(engine, state, step)
    if info is None:
        raise RuntimeError('A pergunta de origem não corresponde ao catálogo cadastrado')
    # The child investment may belong to another institution. It must never
    # populate a parent's filtered description with a mismatched registration.
    context = engine._context(state)
    for condition in step.get('source', {}).get('filters', []):
        expected = context.get(condition['value_from']) if 'value_from' in condition else condition.get('equals')
        if child_fields.get(condition['field']) != expected:
            engine._send_text(state, 'O CADASTRO FOI GRAVADO. SELECIONE UMA DESCRIÇÃO VINCULADA À INSTITUIÇÃO DESTA MOVIMENTAÇÃO.')
            state['options'] = []
            return engine._prompt_next_or_summary(state, etag)
    label = child_fields.get(info['label_field'])
    value = item_id if info['value_field'] in {'Id', 'ID'} else child_fields.get(info['value_field'])
    if str(label or '').strip() and value not in (None, ''):
        engine._apply_selected_option(state, step, {
            'id': item_id, 'title': str(label), 'value': value,
            'source_values': {**child_fields, 'Id': item_id},
        })
    # Optional blank catalog records cannot silently fill the parent question.
    state['options'] = []
    return {**engine._prompt_next_or_summary(state, etag),
            'financial_catalog_registered': True, 'registered_catalog_item_id': item_id}


def cancel(engine, state, etag):
    restore_parent(state)
    state['options'] = []
    return {**engine._prompt_next_or_summary(state, etag), 'financial_catalog_cancelled': True}
