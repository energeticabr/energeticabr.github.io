"""Exact, reproducible additions to the current shared catalog workflow."""
from pathlib import Path
import sys


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Source anchor drift: ' + old[:100])
    return text.replace(old, new, 1)


def patch(relative, data):
    text = data.decode('utf-8')
    if relative == 'worker/financial_catalog_registration.py':
        text = replace_once(text, "    source = step.get('source') or {}\n", """    source = step.get('source') or {}
    # Product expense types share one catalog, including product-derived choices.
    # RECORRENTE/NÃO RECORRENTE is a separate static personal classification.
    if (state.get('flow') in {'supply_product_registration', 'launch', 'payment_settlement'}
            and step.get('kind') == 'selection'
            and step.get('target_field', '').replace(' ', '') == 'TIPODESPESA'
            and source.get('type') == 'sharepoint_list'
            and source.get('list') in {'CADASTROTIPOMATERIAL', 'CADASTROPRODUTO'}):
        child = engine.config['sharepoint'].get('supply_material_type_registration_flow', {})
        if child.get('target_list') == 'CADASTROTIPOMATERIAL':
            return {'flow': 'supply_material_type_registration', 'label': 'TIPO DESPESA',
                    'label_field': 'TIPO', 'value_field': 'TIPO', 'first': True,
                    'product_expense_type': True}
""")
        text = replace_once(text,
            '    displayed = copy.deepcopy(step)\n',
            '''    displayed = copy.deepcopy(step)
    if info.get('product_expense_type'):
        # An empty catalog still has its create control; never select it as data.
        displayed['auto_select_single'] = False
''')
        text = replace_once(text,
            "    for condition in step.get('source', {}).get('filters', []):\n",
            "    conditions = [] if info.get('product_expense_type') else step.get('source', {}).get('filters', [])\n    for condition in conditions:\n")
    elif relative == 'worker/workflow.py':
        text = replace_once(text,
            '        document_result = document_batch.handle_text(self, event, state, etag)\n',
            '''        # Delayed parent choices/searches must never become a new type name.
        if (state.get("flow") == "supply_material_type_registration"
                and (state.get("embedded_return") or {}).get("type") == financial_catalog.RETURN_TYPE):
            reply = str(event.get("reply_id") or "")
            if (reply.startswith("choice:") or reply in {financial_catalog.CREATE_ID, "filter_query", "filter_clear", "refresh_options"}
                    or self._is_option_next(reply)):
                self._mark_processed(state, event.get("message_id"))
                return self._resend_current_prompt(state, etag)
        document_result = document_batch.handle_text(self, event, state, etag)
''')
        text = replace_once(text,
            '    def _selection_options(self, state: dict, step: dict) -> list[dict]:\n',
            '''    def _selection_options(self, state: dict, step: dict) -> list[dict]:
        if (financial_catalog.catalog(self, state, step) or {}).get("product_expense_type"):
            step = financial_catalog.step_with_create(self, state, step)
''')
        text = replace_once(text,
            '        raw_reply = event.get("reply_id") or event.get("text") or ""\n        control = normalize_text(str(raw_reply))\n        # Refresh this binary question',
            '''        raw_reply = event.get("reply_id") or event.get("text") or ""
        control = normalize_text(str(raw_reply))
        if (financial_catalog.catalog(self, state, step) or {}).get("product_expense_type"):
            step = financial_catalog.step_with_create(self, state, step)
            state["options"] = self._include_terminal_option(step, state.get("options", []))
        # Refresh this binary question''')
        text = replace_once(text,
            '        step = copy.deepcopy(pagination.get("step") or {})\n        options = copy.deepcopy(pagination.get("options") or [])\n',
            '''        step = copy.deepcopy(pagination.get("step") or {})
        if (financial_catalog.catalog(self, state, step) or {}).get("product_expense_type"):
            step = financial_catalog.step_with_create(self, state, step)
            pagination["step"] = copy.deepcopy(step)
            state["options"] = self._include_terminal_option(step, state.get("options", []))
        options = copy.deepcopy(pagination.get("options") or [])
''')
    else:
        raise RuntimeError('Unexpected patch scope: ' + relative)
    compile(text, relative, 'exec')
    return text.encode('utf-8')


if __name__ == '__main__':
    root = Path(sys.argv[1])
    for relative in ('worker/workflow.py', 'worker/financial_catalog_registration.py'):
        path = root / relative
        path.write_bytes(patch(relative, path.read_bytes()))
