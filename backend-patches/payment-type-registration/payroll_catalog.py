# Payroll payment-type catalog, appended to the existing catalog module.
try:
    from .logic import normalize_text as _payroll_normalize
except ImportError:
    from logic import normalize_text as _payroll_normalize

PAYROLL_LIST = 'CADASTROTIPOPAGAMENTO'
PAYROLL_CREATE = 'launch_payroll_type_create'
PAYROLL_CONFIRM = PAYROLL_CREATE + '_confirm'
PAYROLL_CANCEL = PAYROLL_CREATE + '_cancel'
PAYROLL_RETRY = 'launch_payroll_type_refresh'
PAYROLL_PAGE_SIZE = 8


def payroll_rows(engine):
    return engine.sharepoint.get_options({'key': 'launch_payroll_types', 'source': {
        'type': 'sharepoint_list', 'list': PAYROLL_LIST, 'id_field': 'Id',
        'label_field': 'TIPOPGTO', 'value_field': 'TIPOPGTO',
        'fields': ['CHAVE'], 'sort_field': 'Id', 'sort_direction': 'asc',
        'fetch_all_pages': True, 'top': 5000,
    }}, {})


def payroll_choices(engine, legacy):
    rows = payroll_rows(engine)
    aliases = {_payroll_normalize(title): identifier for identifier, title in legacy}
    rank = {_payroll_normalize(title): i for i, (_, title) in enumerate(legacy)}
    seen, choices = set(), []
    for row in rows:
        name = str(row.get('value') or row.get('title') or '').strip()
        key = _payroll_normalize(name)
        if not key or key in seen:
            continue
        seen.add(key)
        identifier = aliases.get(key, 'launch_payroll_type_catalog_' + str(int(row['id'])))
        choices.append((identifier, name))
    return sorted(choices, key=lambda pair: (rank.get(_payroll_normalize(pair[1]), len(rank)), _payroll_normalize(pair[1])))


def payroll_scope(state, identifier):
    pending = state.get('pending_launch_payroll') or {}
    if pending.get('type_assignment_mode') == 'individual':
        entry = (pending.get('selected_entries') or [])[int(pending.get('type_index', 0))]
        return f"launch_payroll_type_for_{entry['item_id']}:{identifier}"
    return identifier


def payroll_actions(engine, state, legacy):
    pending = state['pending_launch_payroll']
    try:
        choices = payroll_choices(engine, legacy)
    except Exception:
        engine._send_text(state, '❌ NÃO FOI POSSÍVEL CONSULTAR OS TIPOS DE PAGAMENTO NO SHAREPOINT. TENTE NOVAMENTE.')
        choices = []
    pages = max(1, (len(choices) + PAYROLL_PAGE_SIZE - 1) // PAYROLL_PAGE_SIZE)
    page = min(max(0, int(pending.get('catalog_page', 0))), pages - 1)
    pending['catalog_page'] = page
    actions = [(PAYROLL_CREATE, '➕ CADASTRAR TIPO DE PAGAMENTO')]
    actions += choices[page * PAYROLL_PAGE_SIZE:(page + 1) * PAYROLL_PAGE_SIZE]
    if page:
        actions.append((f'launch_payroll_type_page_{page-1}', '⬅️ TIPOS ANTERIORES'))
    if page + 1 < pages:
        actions.append((f'launch_payroll_type_page_{page+1}', '➡️ PRÓXIMOS TIPOS'))
    if not choices:
        actions.append((PAYROLL_RETRY, '🔄 TENTAR NOVAMENTE'))
    return [{'id': payroll_scope(state, identifier), 'title': title,
             'reply': payroll_scope(state, identifier)} for identifier, title in actions]


def payroll_draft(state):
    return (state.get('pending_launch_payroll') or {}).get('catalog_registration')


def payroll_prompt_draft(engine, state, etag):
    draft = payroll_draft(state)
    actions = [{'id': PAYROLL_CANCEL + ':' + draft['nonce'], 'title': '❌ CANCELAR CADASTRO', 'reply': PAYROLL_CANCEL + ':' + draft['nonce']}]
    if draft.get('name'):
        prompt = f"CADASTRAR O TIPO DE PAGAMENTO {draft['name']}?"
        actions.insert(0, {'id': PAYROLL_CONFIRM + ':' + draft['nonce'], 'title': '✅ CADASTRAR', 'reply': PAYROLL_CONFIRM + ':' + draft['nonce']})
    else:
        prompt = 'QUAL O NOME DO NOVO TIPO DE PAGAMENTO?\n\n⌨️ RESPONDA DIGITANDO NA CONVERSA.'
    engine._send_actions(state, prompt, actions, allow_back=False)
    etag = engine._save(state, etag)
    return {'status': 'awaiting_payment_type_registration', 'batch_id': state['batch_id'], 'etag': etag}


def payroll_handle_draft(engine, event, state, etag, legacy):
    import re
    message_id = event.get('message_id')
    if message_id and message_id in state.get('processed_message_ids', []):
        return {'status': 'duplicate', 'message_id': message_id, 'batch_id': state['batch_id']}
    engine._mark_processed(state, message_id)
    draft = payroll_draft(state)
    raw = str(event.get('reply_id') or event.get('text') or '').strip()
    command = _payroll_normalize(raw)
    if (engine._is_navigation_back(raw) or command in {PAYROLL_CANCEL + ':' + draft['nonce'], 'cancelar', 'cancelar cadastro'}):
        state['pending_launch_payroll'].pop('catalog_registration', None)
        return engine._prompt_launch_payroll_type(state, etag)
    if raw == PAYROLL_CONFIRM + ':' + draft['nonce'] and draft.get('name'):
        name = draft['name']
        try:
            matches = [r for r in payroll_rows(engine)
                       if _payroll_normalize(str(r.get('value') or r.get('title') or '')) == _payroll_normalize(name)]
            if matches:
                saved_name = str(matches[0].get('value') or matches[0]['title'])
            else:
                item_id = engine.sharepoint.ensure_item(_payroll_normalize(name),
                    {'Title': name, 'TIPOPGTO': name}, target_list=PAYROLL_LIST,
                    idempotency_field='CHAVE', merge_existing=False)
                checked = engine.sharepoint.verify_item(item_id, {'TIPOPGTO': name}, [], target_list=PAYROLL_LIST)
                if not (checked is True or (isinstance(checked, dict) and checked.get('fields') is True)):
                    raise RuntimeError('Cadastro ainda não verificado')
                saved_name = name
            # Locate the new record on its catalog page. No financial row is posted.
            choices = payroll_choices(engine, legacy)
            index = next(i for i, (_, title) in enumerate(choices) if _payroll_normalize(title) == _payroll_normalize(saved_name))
        except Exception:
            engine._send_text(state, '❌ NÃO FOI POSSÍVEL CONFIRMAR O CADASTRO NO SHAREPOINT. O LANÇAMENTO FOI PRESERVADO. TENTE CADASTRAR NOVAMENTE.')
            return payroll_prompt_draft(engine, state, etag)
        pending = state['pending_launch_payroll']
        pending.pop('catalog_registration', None)
        pending['catalog_page'] = index // PAYROLL_PAGE_SIZE
        engine._send_text(state, f'✅ TIPO {saved_name} DISPONÍVEL. ESCOLHA O TIPO PARA O PAGAMENTO.')
        return engine._prompt_launch_payroll_type(state, etag)
    # Reply controls, including delayed parent/page/confirm actions, are never names.
    if (event.get('reply_id') or raw.startswith(('launch_payroll_', 'choice:', 'option_next'))
            or command in {'sim', 'nao', 'cadastrar tipo de pagamento', 'cadastrar', 'voltar'}):
        return payroll_prompt_draft(engine, state, etag)
    name = re.sub(r'\s+', ' ', str(event.get('text') or '')).strip().upper()
    if not name or len(name) > 255 or any(ord(ch) < 32 for ch in name):
        engine._send_text(state, '❌ INFORME UM NOME DE 1 A 255 CARACTERES PARA O TIPO DE PAGAMENTO.')
        return payroll_prompt_draft(engine, state, etag)
    try:
        duplicate = any(_payroll_normalize(str(r.get('value') or r.get('title') or '')) == _payroll_normalize(name) for r in payroll_rows(engine))
    except Exception:
        engine._send_text(state, '❌ NÃO FOI POSSÍVEL CONSULTAR DUPLICIDADES NO SHAREPOINT. TENTE NOVAMENTE.')
        return payroll_prompt_draft(engine, state, etag)
    if duplicate:
        engine._send_text(state, '❌ ESSE TIPO DE PAGAMENTO JÁ ESTÁ CADASTRADO. INFORME OUTRO NOME OU CANCELE PARA SELECIONÁ-LO.')
        return payroll_prompt_draft(engine, state, etag)
    import secrets
    draft['nonce'] = secrets.token_hex(12)
    draft['name'] = name
    return payroll_prompt_draft(engine, state, etag)


def payroll_control(engine, state, etag, raw, message_id):
    if raw in {PAYROLL_CREATE, PAYROLL_RETRY} or raw.startswith("launch_payroll_type_page_"):
        engine._mark_processed(state, message_id)
    if raw == PAYROLL_CREATE:
        import secrets
        state['pending_launch_payroll']['catalog_registration'] = {'nonce': secrets.token_hex(12)}
        return payroll_prompt_draft(engine, state, etag)
    if raw == PAYROLL_RETRY:
        return engine._prompt_launch_payroll_type(state, etag)
    if raw.startswith('launch_payroll_type_page_'):
        page = raw.removeprefix('launch_payroll_type_page_')
        if page.isdigit():
            state['pending_launch_payroll']['catalog_page'] = int(page)
        return engine._prompt_launch_payroll_type(state, etag)
    return None
