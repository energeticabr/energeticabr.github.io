"""Patch only the scheduled settlement payment-method picker."""
import json


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError("Payment method frequency source anchor changed")
    return text.replace(old, new, 1)


def patch(relative, data):
    text = data.decode("utf-8")
    if relative == "worker/workflow_config.json":
        old = '''          "key": "forma_pgto_baixa",
          "kind": "selection",
          "target_field": "FORMAPGTO",
          "prompt": "QUAL É A FORMA DE PAGAMENTO?",
          "button_label": "ESCOLHER CONTA",
          "source": {
            "type": "sharepoint_list",
            "list": "CADASTROCONTA",'''
        new = old.replace('          "source": {', '''          "presentation": "payment_method_frequency",
          "source": {''')
        result = replace_once(text, old, new)
        json.loads(result)
        return result.encode("utf-8")
    if relative != "worker/workflow.py":
        raise RuntimeError("Unexpected source: " + relative)

    old = "        return self._rank_recent_launch_account_options(state, step, normalized)\n"
    new = '''        normalized = self._rank_recent_launch_account_options(state, step, normalized)
        return self._rank_settlement_payment_method_options(state, step, normalized)

    def _rank_settlement_payment_method_options(self, state, step, options):
        """Rank methods by frequency in the 100 most recently paid scheduled provisions."""
        if state.get("flow") != "payment_settlement" or step.get("key") != "forma_pgto_baixa" or not options:
            return options
        # Sort after the catalog query so its deduplication keeps the same IDs.
        options = sorted(options, key=lambda item: (
            int(item["id"]) if str(item["id"]).isdecimal() else float("inf")
        ))
        try:
            rows = self.sharepoint.get_options({
                "key": "recent_settlement_payment_methods",
                "source": {
                    "type": "sharepoint_list", "list": "PROVISÃO PGTOS",
                    "id_field": "Id", "label_field": "Id", "value_field": "FORMAPGTO",
                    "filters": [{"field": "PGTOAGENDADO", "equals": "PAGO"}],
                    "top": 100, "sort_field": "DATAPGTOEFETUADO", "sort_direction": "desc",
                    "preserve_source_order": True,
                },
            }, {})
        except Exception:
            # The catalog remains usable during a history outage.
            return options
        counts = {}
        for row in rows[:100]:
            method = normalize_text(str(row.get("value") or ""))
            if method:
                counts[method] = counts.get(method, 0) + 1
        return sorted(options, key=lambda item: -counts.get(
            normalize_text(str(item.get("value") or "")), 0))
'''
    return replace_once(text, old, new).encode("utf-8")
