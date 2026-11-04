"""Small, exact replacements against the reviewed live workflow baseline."""
from pathlib import Path
import sys


def patch(relative, data):
    if relative != 'worker/workflow.py':
        raise RuntimeError('Unexpected patch scope')
    source = data.decode('utf-8')

    def replace(before, after, count=1):
        nonlocal source
        if source.count(before) != count:
            raise RuntimeError('Source drift: ' + before[:100])
        source = source.replace(before, after)

    replace('''        elif state.get("stage") == "choosing_multi_launch_grouping_supplier":
''', '''        elif (parent_flow == "launch"
              and (state.get("single_launch_order_supplier") or {}).get("phase") == "select"
              and self._current_step(state).get("kind") == "supplier_pending_provision_check"):
            return_type = "single_launch_order_supplier_registration"
        elif state.get("stage") == "choosing_multi_launch_grouping_supplier":
''')
    replace('''        parent_keys = (*parent_keys, *PROVISION_STATE_KEYS, "document_batch")
''', '''        parent_keys = (*parent_keys, *PROVISION_STATE_KEYS, "document_batch")
        if return_type == "single_launch_order_supplier_registration":
            parent_keys = (*parent_keys, "single_launch_order_supplier")
''')
    replace('''        if return_type in {"recurring_expense_supplier_registration",
                           "multi_launch_grouping_supplier_registration"}:
''', '''        if return_type in {"recurring_expense_supplier_registration",
                           "multi_launch_grouping_supplier_registration",
                           "single_launch_order_supplier_registration"}:
''')
    replace('''            "recurring_expense_supplier_registration",
            "multi_launch_grouping_supplier_registration",
        }:
''', '''            "recurring_expense_supplier_registration",
            "multi_launch_grouping_supplier_registration",
            "single_launch_order_supplier_registration",
        }:
''')
    replace('''        if return_type == "multi_launch_grouping_supplier_registration":
            state["multi_launch_grouping_supplier"] = supplier
''', '''        if return_type == "single_launch_order_supplier_registration":
            choice = state["single_launch_order_supplier"]
            choice.update(phase="done", supplier=str(supplier))
            choice.pop("options", None)
        elif return_type == "multi_launch_grouping_supplier_registration":
            state["multi_launch_grouping_supplier"] = supplier
''')
    replace('''        if embedded_type in {"recurring_expense_supplier_registration",
                             "multi_launch_grouping_supplier_registration"}:
''', '''        if embedded_type in {"recurring_expense_supplier_registration",
                             "multi_launch_grouping_supplier_registration",
                             "single_launch_order_supplier_registration"}:
''')
    replace('''        if supplier_return in {"recurring_expense_supplier_registration",
                               "multi_launch_grouping_supplier_registration"}:
''', '''        if supplier_return in {"recurring_expense_supplier_registration",
                               "multi_launch_grouping_supplier_registration",
                               "single_launch_order_supplier_registration"}:
''')
    replace('''                "choice:fornecedor_despesa_recorrente:",
''', '''                "choice:fornecedor_despesa_recorrente:",
                "choice:fornecedor_pedido_lancamento_unico:",
                "single_order_supplier:", "single_order_supplier_yes:", "single_order_supplier_no:",
''')
    replace('''                "button_label": "ESCOLHER FORNECEDOR DO PEDIDO",
''', '''                "button_label": "ESCOLHER FORNECEDOR DO PEDIDO",
                "terminal_options_first": True,
                "terminal_option": {
                    "id": "NOVO_FORNECEDOR_PEDIDO",
                    "title": "➕ CADASTRAR NOVO FORNECEDOR",
                    "value": "__CADASTRAR_NOVO_FORNECEDOR__",
                    "action": "start_embedded_supplier_registration"},
''')
    replace('''            state["options"] = copy.deepcopy(choice["options"])
            self._send_options(state, step, state["options"])
''', '''            state["options"] = self._single_launch_order_supplier_options(choice)
            self._send_options(state, step, state["options"])
''')
    replace('''    def _handle_single_launch_order_supplier_reply(self, event: dict, state: dict, etag: str | None) -> dict | None:
''', '''    def _single_launch_order_supplier_options(self, choice: dict) -> list[dict]:
        # Also upgrade catalogs cached by conversations opened before this release.
        for option in choice.get("options", []):
            supplier_id = option["catalog_id"]
            supplier_name = str(option.get("value") or option.get("title") or "")
            option["title"] = f"{supplier_id} - {supplier_name}"
        return self._include_terminal_option(self._single_launch_order_supplier_step(),
                                             copy.deepcopy(choice.get("options", [])))

    def _handle_single_launch_order_supplier_reply(self, event: dict, state: dict, etag: str | None) -> dict | None:
''')
    replace('''        options = choice.get("options", [])
        if normalize_text(raw) in {"filter_clear", "limpar filtro", "refresh_options"}:
''', '''        options = self._single_launch_order_supplier_options(choice)
        if normalize_text(raw) in {"filter_clear", "limpar filtro", "refresh_options"}:
''')
    replace('''        if selected:
            choice.update(phase="done", supplier=str(selected["value"]))
''', '''        if selected:
            if selected.get("action") == "start_embedded_supplier_registration":
                return self._start_embedded_supplier_registration(state, etag)
            choice.update(phase="done", supplier=str(selected["value"]))
''')
    replace('''        matches = [option for option in options if all(term in normalize_text(
''', '''        matches = [option for option in options if not option.get("terminal_option") and all(term in normalize_text(
''')
    replace('''        self._send_filtered_options(state, displayed, matches)
        etag = self._save(state, etag)
        return {"status": "filtered_single_launch_order_suppliers",''', '''        self._send_filtered_options(state, displayed, self._include_terminal_option(step, matches))
        etag = self._save(state, etag)
        return {"status": "filtered_single_launch_order_suppliers",''')
    # Ignore a repeated registration control while the embedded wizard is active.
    replace('''            )) or stale_reply == "NOVO_FORNECEDOR"
''', '''            )) or stale_reply in {"NOVO_FORNECEDOR", "NOVO_FORNECEDOR_PEDIDO"}
''')
    compile(source, relative, 'exec')
    return source.encode('utf-8')


if __name__ == '__main__':
    root = Path(sys.argv[1])
    target = root / 'worker/workflow.py'
    target.write_bytes(patch('worker/workflow.py', target.read_bytes()))
