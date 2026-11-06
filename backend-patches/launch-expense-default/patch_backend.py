"""Restore the existing product-derived auto-selection in launch/settlement."""
from pathlib import Path
import sys


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Source anchor drift: ' + old[:100])
    return text.replace(old, new, 1)


def patch(relative, data):
    text = data.decode('utf-8')
    if relative == 'worker/financial_catalog_registration.py':
        text = replace_once(text,
            "    if (state.get('flow') in {'supply_product_registration', 'launch', 'payment_settlement'}\n",
            "    if (state.get('flow') == 'supply_product_registration'\n")
        text = replace_once(text,
            '    # Product expense types share one catalog, including product-derived choices.\n',
            '    # Choose/create a type only while registering the product.\n'
            '    # Launch and settlement inherit CADASTROPRODUTO.TIPODESPESA automatically.\n')
        text = replace_once(text,
            'def complete(engine, state, etag, item_id):\n',
            '''def restore_legacy_product_expense_parent(state):
    embedded = state.get('embedded_return') or {}
    parent = embedded.get('state') or {}
    if (state.get('flow') == 'supply_material_type_registration'
            and embedded.get('type') == RETURN_TYPE
            and parent.get('flow') in {'launch', 'payment_settlement'}):
        restore_parent(state)
        state['options'] = []
        state.pop('option_pagination', None)
        return True
    return False


def complete(engine, state, etag, item_id):
    # A child already committed before recovery must not replace the product type.
    if restore_legacy_product_expense_parent(state):
        return engine._prompt_next_or_summary(state, etag)
''')
    elif relative == 'worker/workflow.py':
        text = replace_once(text,
            '        if (((state or {}).get("embedded_return") or {}).get("type") == financial_catalog.RETURN_TYPE\n',
            '''        # Old pagination is dispatched before normal text handling. Route the
        # obsolete expense question through default recovery first.
        if (state and event.get("kind") == "text"
                and self._is_option_next(event.get("reply_id"))
                and state.get("flow") in {"launch", "payment_settlement"}
                and state.get("stage") == "selecting_fields"):
            step = self._current_step(state)
            if step and step.get("key") in {"tipo_despesa_lancamento", "tipo_despesa_baixa"}:
                return self._handle_text(event, state, etag)
        if (((state or {}).get("embedded_return") or {}).get("type") == financial_catalog.RETURN_TYPE
''')
        text = replace_once(text,
            '        # Delayed parent choices/searches must never become a new type name.\n',
            '''        if financial_catalog.restore_legacy_product_expense_parent(state):
            self._mark_processed(state, event.get("message_id"))
            return self._prompt_next_or_summary(state, etag)
        # Migrate a question left open before product defaults were restored.
        # Ignore its stale create/search/page controls and reload the product type.
        if (state.get("flow") in {"launch", "payment_settlement"}
                and state.get("stage") == "selecting_fields"):
            step = self._current_step(state)
            if step and step.get("key") in {"tipo_despesa_lancamento", "tipo_despesa_baixa"}:
                self._mark_processed(state, event.get("message_id"))
                state["options"] = []
                state.pop("option_pagination", None)
                return self._prompt_next_or_summary(state, etag)
        # Delayed parent choices/searches must never become a new type name.
''')
        text = replace_once(text,
            '    def _resend_current_prompt(self, state: dict, etag: str | None) -> dict:\n',
            '''    def _resend_current_prompt(self, state: dict, etag: str | None) -> dict:
        if financial_catalog.restore_legacy_product_expense_parent(state):
            return self._prompt_next_or_summary(state, etag)
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
