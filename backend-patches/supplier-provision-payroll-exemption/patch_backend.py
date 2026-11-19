"""Exact, reproducible patch; private workflow source is never committed."""
import argparse
from pathlib import Path


PAYROLL_CHECK = '''    def _supplier_has_payroll(self, state: dict) -> bool:
        """A folha pertence ao fornecedor do lançamento, sem limitar competência."""
        supplier = str(state.get("fields", {}).get("FORNECEDOR") or "").strip()
        if not supplier:
            return False
        step = {
            "key": "supplier_pending_provision_payroll",
            "source": {
                "type": "sharepoint_list",
                "list": "IDFOLHA",
                "id_field": "Id",
                "label_field": "FORNECEDOR",
                "value_field": "Id",
                "fields": ["FORNECEDOR"],
                "filters": [{"field": "FORNECEDOR", "equals": supplier}],
                "fetch_all_pages": True,
                "top": 5000,
            },
        }
        for option in self.sharepoint.get_options(step, {}):
            source = option.get("source_values") or {}
            if normalize_text(str(source.get("FORNECEDOR") or "")) != normalize_text(supplier):
                continue
            try:
                item_id = int(str(source.get("Id", option.get("id"))).strip())
            except (TypeError, ValueError):
                continue
            if item_id > 0:
                return True
        return False

'''


def patch(relative, data):
    if relative != 'worker/workflow.py':
        raise RuntimeError('Unexpected patch scope')
    text = data.decode('utf-8')

    def replace(before, after):
        nonlocal text
        if text.count(before) != 1:
            raise RuntimeError('Source drift at ' + before[:90])
        text = text.replace(before, after, 1)

    anchor = '    def _supplier_pending_provision_ids(\n'
    replace(anchor, PAYROLL_CHECK + anchor)
    replace('''        """Retorna provisões ainda pendentes para o fornecedor selecionado."""
        supplier''', '''        """Valida provisões pendentes exclusivamente para fornecedor sem folha."""
        if self._supplier_has_payroll(state):
            return []
        supplier''')
    replace('''        if order_supplier is not None:
            return order_supplier
        raw = event.get("reply_id") or event.get("text") or ""
        command = _control_command(str(raw))
        if command in {
            "confirm_supplier_pending_provisions_yes",''', '''        if order_supplier is not None:
            return order_supplier
        # Recheck persisted warnings before interpreting an old control reply.
        pending_ids = self._supplier_pending_provision_ids(state, step)
        if not pending_ids:
            state["answers"][step["key"]] = "SEM PENDÊNCIAS"
            state["supplier_pending_provision_ids"] = []
            state["options"] = []
            state["step_index"] += 1
            return self._prompt_next_or_summary(state, etag)
        state["supplier_pending_provision_ids"] = pending_ids
        raw = event.get("reply_id") or event.get("text") or ""
        command = _control_command(str(raw))
        if command in {
            "confirm_supplier_pending_provisions_yes",''')
    replace('''        pending_ids = state.get("supplier_pending_provision_ids", [])
        if not pending_ids:
            pending_ids = self._supplier_pending_provision_ids(state, step)
            state["supplier_pending_provision_ids"] = pending_ids
        self._send_supplier_pending_provision_question(state, pending_ids)''',
            '''        self._send_supplier_pending_provision_question(state, pending_ids)''')
    result = text.encode('utf-8')
    compile(result, relative, 'exec')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('baseline', type=Path)
    parser.add_argument('candidate', type=Path)
    args = parser.parse_args()
    target = args.candidate / 'worker/workflow.py'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(patch('worker/workflow.py', (args.baseline / 'worker/workflow.py').read_bytes()))
