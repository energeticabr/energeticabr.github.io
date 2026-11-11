"""Build the required-product change against either current backend source root."""

import copy
import json


FILES = (
    "worker/workflow_config.json",
    "worker/workflow.py",
    "worker/payment_provision_flow.py",
)


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise ValueError(f"Unexpected source context for {old.splitlines()[0]!r}")
    return source.replace(old, new, 1)


def patch_config(source):
    before = json.loads(source)
    expected = copy.deepcopy(before)
    steps = expected["sharepoint"]["payment_flow"]["steps"]
    product, = (step for step in steps if step["key"] == "produto_pagamento")
    if product["target_field"] != "PRODUTO" or product["allow_blank"] is not True:
        raise ValueError("Unexpected product step configuration")
    product["allow_blank"] = False
    start = source.index('"key": "produto_pagamento"')
    end = source.index('"key": "quantidade_pagamento"', start)
    updated = source[:start] + replace_once(
        source[start:end], '"allow_blank": true', '"allow_blank": false'
    ) + source[end:]
    if json.loads(updated) != expected:
        raise ValueError("Unrelated configuration change")
    return updated


def patch_workflow(source):
    old = '''                if (pagination.get("step") or {}).get("key") == step.get("key"):
                    self._emit_option_page(state)'''
    new = '''                if state.get("flow") == "payment" and step["key"] == "produto_pagamento" and any(
                    str(row["id"]) == "0"
                    for options in (state.get("options", []), pagination.get("options", []))
                    for row in options
                ):
                    result = self._prompt_next_or_summary(state, etag)
                    return {**result, "status": "draft_resumed", "draft_resumed": True,
                            "batch_id": state["batch_id"], "resumed_stage": state["stage"]}
                if (pagination.get("step") or {}).get("key") == step.get("key"):
                    self._emit_option_page(state)'''
    return replace_once(source, old, new)


def patch_provision(source):
    start = source.index("    def _provision_product_guard(")
    end = source.index("    def _provision_variation_changes(", start)
    if source[start:end].count('step.get("key") == "produto_pagamento"') != 1:
        raise ValueError("Unexpected product guard context")
    source = source[:start] + '''    def _provision_product_guard(self, event, state, etag, step):
        if state.get("flow") != "payment" or step.get("key") != "produto_pagamento":
            return None
        # Older sessions can retain the synthetic blank option after rollout.
        options = state.get("options", [])
        blank = [option for option in options
                 if str(option["id"]) == "0"
                 or (not option.get("action") and not str(option.get("value") or "").strip())]
        if not blank:
            return None
        state["options"] = [option for option in options if option not in blank]
        reply = event.get("reply_id") or event.get("text") or ""
        if resolve_option(reply, blank, step["key"]):
            self._mark_processed(state, event["message_id"])
            self._send_text(state, "ESCOLHA UM PRODUTO PARA ESTA PROVISÃO.")
            result = self._prompt_next_or_summary(state, etag)
            result["status"] = "provision_product_required"
            return result
        return None

''' + source[end:]
    old = '''            if self._provision_multiple(state) and any(
                    not str(line["fields"].get("PRODUTO") or "").strip() for line in lines):
                raise ValueError("Cada linha da provisão múltipla exige um produto")'''
    new = '''            if any(not str(line["fields"].get("PRODUTO") or "").strip() for line in lines):
                if self._provision_multiple(state) or len(lines) != 1:
                    raise ValueError("Cada linha da provisão exige um produto")
                # Reopen only the missing field in an old, uncommitted single-product draft.
                product_index, product_step = next(
                    (index, step) for index, step in enumerate(flow["steps"])
                    if step["key"] == "produto_pagamento"
                )
                self._clear_step_value(state, product_step)
                state.pop("completion_trigger_message_id", None)
                state.update(stage="selecting_fields", options=[], step_index=product_index,
                             edit_step_indices=[product_index], provision_current_saved=True)
                self._send_text(state, "ESCOLHA UM PRODUTO PARA ESTA PROVISÃO.")
                return self._prompt_next_or_summary(state, etag)'''
    return replace_once(source, old, new)


def patch(relative, data):
    changes = {
        FILES[0]: patch_config,
        FILES[1]: patch_workflow,
        FILES[2]: patch_provision,
    }
    newline = "\r\n" if b"\r\n" in data else "\n"
    source = data.decode("utf-8").replace("\r\n", "\n")
    return changes[relative](source).replace("\n", newline).encode("utf-8")
