"""Scoped provision changes presentation; no financial mutations."""

METHOD = '''    def _provision_variation_changes(self, state):
        if (state.get("flow") != "payment"
                or state.get("stage") != "choosing_provision_variation"
                or not state.get("provision_lines")
                or state.get("provision_current_saved")):
            return None
        previous = state["provision_lines"][-1].get("fields") or {}
        current = state.get("fields") or {}
        rows = []
        for field, label in (
            ("DATA PREVISTO PGTO", "DATA DE VENCIMENTO"),
            ("FORNECEDOR", "FORNECEDOR"), ("FILIAL", "FILIAL"),
            ("IMOVEL", "IMÓVEL"), ("FORMA PGTO", "FORMA DE PAGAMENTO"),
            ("OBS", "OBSERVAÇÃO"),
        ):
            before = str(previous.get(field) or "").strip()
            after = str(current.get(field) or "").strip()
            if field == "DATA PREVISTO PGTO":
                old_date, new_date = provision_due_date(before), provision_due_date(after)
                before = old_date.strftime("%d/%m/%Y") if old_date else before
                after = new_date.strftime("%d/%m/%Y") if new_date else after
            if before != after:
                rows.append({"field": label, "before": before or "EM BRANCO", "after": after or "EM BRANCO"})
        return {"kind": "provision_variation_changes", "rows": rows} if rows else None

'''

CHANGES = {
    'worker/payment_provision_flow.py': [
        ('    def _provision_question(self, state):\n', METHOD + '    def _provision_question(self, state):\n'),
        ('        return {"key":"variacao_linha_provisao",\n',
         '        changes = self._provision_variation_changes(state)\n        return {"key":"variacao_linha_provisao",\n'),
        ('                            for i,(key,label) in enumerate(keys,2)]}}\n',
         '                            for i,(key,label) in enumerate(keys,2)]},\n                **({"change_table": changes} if changes else {})}\n'),
    ],
    'worker/workflow.py': [
        ('        pending = state.get(\'pending_launch_payroll\') or {}\n        if (state.get(\'flow\') in {\'launch\', \'payment_settlement\'}\n',
         '''        if (state.get("flow") == "payment"
                and state.get("stage") == "choosing_provision_variation"
                and step.get("key") == "variacao_linha_provisao"
                and isinstance(step.get("change_table"), dict)):
            state["_outbound_change_table"] = copy.deepcopy(step["change_table"])
            return step
        pending = state.get('pending_launch_payroll') or {}
        if (state.get('flow') in {'launch', 'payment_settlement'}
'''),
    ],
    'channel_bridge.py': [
        ('            and is_supplier_edit_prompt\n',
         '''            and ((is_supplier_edit_prompt and change_table.get("kind") != "provision_variation_changes") or (
                change_table.get("kind") == "provision_variation_changes"
                and state.get("flow") == "payment"
                and state.get("stage") == "choosing_provision_variation"
                and "HÁ ALGUMA VARIAÇÃO EM RELAÇÃO À LINHA ANTERIOR?" in str(question).upper()
            ))
'''),
    ],
}


def patch(relative, data):
    if relative not in CHANGES:
        raise RuntimeError('Unexpected source scope')
    text = data.decode('utf-8')
    newline = '\r\n' if '\r\n' in text else '\n'
    if newline == '\r\n' and text.count('\n') != text.count('\r\n'):
        raise RuntimeError('Mixed source newlines require review')
    text = text.replace('\r\n', '\n')
    for before, after in CHANGES[relative]:
        if text.count(before) != 1:
            raise RuntimeError('Expected source anchor exactly once: '+relative)
        text = text.replace(before, after, 1)
    compile(text, relative, 'exec')
    return text.replace('\n', newline).encode('utf-8')
