"""Retire the property question while preserving saved settlement step indices."""


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise ValueError(f'Unexpected settlement source near {old.splitlines()[0]!r}')
    return source.replace(old, new, 1)


def change(relative, data):
    source = data.decode('utf-8')
    newline = '\r\n' if '\r\n' in source else '\n'
    if newline == '\r\n' and '\n' in source.replace('\r\n', ''):
        raise ValueError(f'Mixed line endings in {relative}')
    source = source.replace('\r\n', '\n')
    if relative == 'worker/workflow.py':
        source = patch_workflow(source)
        compile(source, relative, 'exec')
    elif relative == 'worker/workflow_config.json':
        source = patch_config(source)
    else:
        raise ValueError(f'Unexpected settlement target {relative}')
    return source.replace('\n', newline).encode('utf-8')


def patch_config(source):
    source = replace_once(source, '''        {
          "field": "IMOVEL",
          "label": "IMÓVEL",
          "edit_step_key": "preencher_imovel_baixa"
        },
''', '')
    first = source.index('        {\n          "key": "preencher_imovel_baixa",')
    last = source.index('        {\n          "key": "preencher_produto_baixa",', first)
    # Keep the old array position for drafts that persisted numeric step codes.
    return source[:first] + '''        {
          "key": "preencher_imovel_baixa",
          "kind": "text",
          "prompt": "IMÓVEL DA PROVISÃO",
          "persist": false,
          "edit_only": true,
          "editable": false,
          "when": {"any": []}
        },
''' + source[last:]


def patch_workflow(source):
    old = '''        command = _control_command(event.get("reply_id") or event.get("text") or "")
        blank_items = self._payment_settlement_blank_review_items(state)
'''
    source = replace_once(source, old, '''        blank_items = self._payment_settlement_blank_review_items(state)
        if not blank_items:
            return self._route_next_payment_settlement_blank_field(state, etag)
        command = _control_command(event.get("reply_id") or event.get("text") or "")
''')
    old = '''        elif stage == "reviewing_payment_settlement_blank_fields":
            self._send_payment_settlement_blank_review(state)
'''
    source = replace_once(source, old, '''        elif stage == "reviewing_payment_settlement_blank_fields":
            if not self._payment_settlement_blank_review_items(state):
                return self._route_next_payment_settlement_blank_field(state, etag)
            self._send_payment_settlement_blank_review(state)
''')
    old = '''        edited_step = steps[target_index]
        if (
            state.get("flow") == "attendance_validation"
'''
    source = replace_once(source, old, '''        edited_step = steps[target_index]
        if (state.get("flow") == "payment_settlement"
                and edited_step["key"] == "preencher_imovel_baixa"):
            return self._prompt_edit_field(state, etag)
        if (
            state.get("flow") == "attendance_validation"
''')
    old = '''        previous_index = state["step_index"]
        step = self._current_step(state)
'''
    return replace_once(source, old, '''        previous_index = state["step_index"]
        if state.get("flow") == "payment_settlement" and state.get("edit_step_indices"):
            steps = self._flow_config(state)["steps"]
            if (previous_index < len(steps)
                    and steps[previous_index]["key"] == "preencher_imovel_baixa"):
                self._mark_processed(state, event["message_id"])
                state["options"] = []
                return self._prompt_next_or_summary(state, etag)
        step = self._current_step(state)
''')
