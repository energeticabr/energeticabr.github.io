"""Sequential DOCUMENTOS registration; the existing form owns field validation."""
from __future__ import annotations

import copy
from datetime import datetime
from zoneinfo import ZoneInfo

try:
    from .logic import condition_matches, normalize_text
except ImportError:
    from logic import condition_matches, normalize_text

MODE_STAGE = 'choosing_document_mode'
DEFAULTS_STAGE = 'document_batch_defaults'
STAGES = frozenset({MODE_STAGE, DEFAULTS_STAGE})
SINGLE = 'document_mode_single'
MULTIPLE = 'document_mode_multiple'
ADD = 'document_add_another'
FINISH = 'document_submit_final'
PROCEED = 'document_defaults_proceed'


def active(state):
    return state.get('flow') == 'document' and (state.get('document_batch') or {}).get('mode') == 'multiple'


def start(engine, state, etag):
    state['document_batch'] = {'mode': None, 'index': 0, 'submitted': []}
    return prompt_mode(engine, state, etag)


def prompt_mode(engine, state, etag):
    state['stage'], state['options'] = MODE_STAGE, []
    engine._send_actions(state, 'DESEJA ADICIONAR APENAS UM DOCUMENTO OU DIVERSOS DOCUMENTOS?', [
        {'id': SINGLE, 'title': '📄 APENAS UM DOCUMENTO'},
        {'id': MULTIPLE, 'title': '📑 DIVERSOS DOCUMENTOS'},
    ], allow_back=False)
    etag = engine._save(state, etag)
    return {'status': 'awaiting_document_mode', 'batch_id': state['batch_id'], 'etag': etag}


def prompt_defaults(engine, state, etag):
    batch = state['document_batch']
    batch['editing_defaults'] = True
    state['stage'], state['options'] = DEFAULTS_STAGE, []
    state.pop('edit_step_indices', None)
    state['step_index'] = len(engine._flow_config(state)['steps'])
    labels = {row['field']: row['label'] for row in engine._flow_config(state).get('summary_fields', [])}
    options = [{'id': PROCEED, 'title': '✅ PROSSEGUIR SEM EDITAR', 'value': '__document_proceed__'}]
    for index, step in enumerate(engine._flow_config(state)['steps']):
        if step.get('editable') is False or step['key'] == 'tipo_documento':
            continue
        if not condition_matches(step.get('when'), engine._context(state)):
            continue
        target = step.get('target_field')
        label = step.get('edit_label') or labels.get(target) or step['prompt'].rstrip('?')
        if step['key'] == 'pessoa_relacionada':
            label = 'FORNECEDOR / PESSOA RELACIONADA'
        options.append({'id': index + 1, 'title': label, 'value': index})
    state['options'] = options
    engine._send_options(state, {'key': 'edit_field', 'prompt':
        'DESEJA EDITAR ALGUM DADO PARA O NOVO DOCUMENTO?', 'allow_navigation_back': False}, options)
    etag = engine._save(state, etag)
    return {'status': 'awaiting_document_defaults', 'batch_id': state['batch_id'], 'etag': etag}


def handle_text(engine, event, state, etag):
    if state.get('flow') != 'document':
        return None
    command = normalize_text(event.get('reply_id') or event.get('text') or '')
    if state.get('stage') == MODE_STAGE:
        engine._mark_processed(state, event.get('message_id'))
        if command in {SINGLE, '1', 'apenas um documento', 'um documento'}:
            state['document_batch']['mode'] = 'single'
        elif command in {MULTIPLE, '2', 'diversos documentos'}:
            state['document_batch']['mode'] = 'multiple'
        else:
            return prompt_mode(engine, state, etag)
        state['stage'] = 'selecting_fields'
        return engine._prompt_next_or_summary(state, etag)
    if active(state) and state.get('stage') == DEFAULTS_STAGE:
        if command in {PROCEED, 'prosseguir sem editar', 'prosseguir'}:
            engine._mark_processed(state, event.get('message_id'))
            state['document_batch']['editing_defaults'] = False
            index = next(i for i, step in enumerate(engine._flow_config(state)['steps'])
                         if step['key'] == 'tipo_documento')
            state.update(step_index=index, edit_step_indices=[index], stage='selecting_fields', options=[])
            return engine._prompt_next_or_summary(state, etag)
        return engine._handle_edit_field_reply(event, state, etag)
    return None


def after_fields(engine, state, etag):
    if active(state) and state['document_batch'].get('editing_defaults'):
        return prompt_defaults(engine, state, etag)
    return None


def send_confirmation(engine, state):
    if not active(state):
        return False
    engine._send_actions(state,
        'DESEJA ADICIONAR MAIS UM DOCUMENTO OU SUBMETER SEM ADICIONAR MAIS DOCUMENTOS?', [
            {'id': ADD, 'title': '➕ ADICIONAR MAIS UM DOCUMENTO'},
            {'id': FINISH, 'title': '✅ SUBMETER SEM ADICIONAR MAIS DOCUMENTOS'},
            {'id': 'confirm_edit', 'title': '✏️ EDITAR'},
            {'id': 'confirm_cancel', 'title': '❌ CANCELAR'},
        ], allow_back=False)
    return True


def confirmation(engine, event, state, etag):
    if not active(state):
        return None
    command = normalize_text(event.get('reply_id') or event.get('text') or '')
    if command not in {ADD, FINISH}:
        return None
    state['document_batch']['continuation'] = 'another' if command == ADD else 'finish'
    # Reuse mandatory attachment, duplicate and consistency checks unchanged.
    return engine._handle_confirmation_reply({**event, 'reply_id': 'confirm_yes'}, state, etag)


def resend(engine, state, etag):
    if state.get('flow') == 'document':
        if state.get('stage') == MODE_STAGE:
            return prompt_mode(engine, state, etag)
        if active(state) and state.get('stage') == DEFAULTS_STAGE:
            return prompt_defaults(engine, state, etag)
    return None


def commit(engine, state, etag, flow):
    batch = state['document_batch']
    token = f"WA-document-{state['batch_id']}:row:{batch['index']}"
    item_id = engine.sharepoint.ensure_item(token, state['fields'], target_list=flow['target_list'],
        idempotency_field=flow.get('idempotency_field', 'Title'), merge_existing=False)
    names = []
    for attachment in state['attachments']:
        engine.sharepoint.ensure_attachment(item_id, attachment['sharepoint_name'],
            engine.media_repository.read(attachment), attachment.get('mime_type'), target_list=flow['target_list'])
        names.append(attachment['sharepoint_name'])
    verification = engine.sharepoint.verify_item(item_id, state['fields'], names, target_list=flow['target_list'])
    state['sharepoint'] = {'item_id': item_id, 'attachment_names': names, 'verified': verification,
        'recorded_at': datetime.now(ZoneInfo('America/Sao_Paulo')).isoformat()}
    batch['submitted'].append(item_id)
    if batch.get('continuation') != 'another':
        state['stage'] = 'notifying'
        etag = engine._save(state, etag)
        return engine._notify_completed(state, etag)
    engine._send_text(state, f'✅ DOCUMENTO ID {item_id} GRAVADO. PREENCHA O PRÓXIMO DOCUMENTO.')
    return prepare_next(engine, state, etag)


def prepare_next(engine, state, etag):
    batch = state['document_batch']
    batch['index'] += 1
    batch.pop('continuation', None)
    type_step = next(step for step in engine._flow_config(state)['steps'] if step['key'] == 'tipo_documento')
    engine._clear_step_value(state, type_step)
    state.update(attachments=[], attachments_decision=None, attachments_phase_completed=False,
        attachment_compression_approved=False, attachment_compression_result={},
        attachment_compression_queue=[], attachment_compression_processed_count=0,
        attachment_compression_all_approved=False, sharepoint={}, options=[], navigation_history=[])
    for key in ('summary_card', 'option_pagination', 'edit_step_indices', 'submission_failure',
                'completion_id', 'completion_trigger_message_id', 'idempotency_token'):
        state.pop(key, None)
    engine._apply_fixed_fields(state)
    return prompt_defaults(engine, state, etag)
