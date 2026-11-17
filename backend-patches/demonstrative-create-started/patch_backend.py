"""Update descriptor creation in each worker's own sources."""

import json

CONFIG = "worker/workflow_config.json"
WORKFLOW = "worker/workflow.py"
FLOW = "construction_stage_demonstrative_create"
FLOW_NAME = FLOW + "_flow"
END_STEP = "data_finalizacao_demonstrativo_etapa"
STATUS_STEP = "status_demonstrativo_etapa"


def replace_once(source, anchor, replacement):
    if source.count(anchor) != 1:
        raise ValueError(f"Unexpected descriptor creation source anchor: {anchor!r}")
    return source.replace(anchor, replacement, 1)


def patch_config(source):
    start = f'    "{FLOW_NAME}": {{\n'.encode()
    end = b'    "construction_stage_demonstrative_edit_flow": {\n'
    prefix, marker, tail = source.partition(start)
    block, end_marker, suffix = tail.partition(end)
    if not marker or not end_marker or source.count(start) != 1:
        raise ValueError("Could not locate descriptor creation in the workflow config")

    anchor = b'      "summary_fields": [\n'
    fixed_status = b'''      "fixed_fields": [
        {
          "target_field": "STATUS",
          "value": "ATIVIDADE INICIADA"
        }
      ],
'''
    block = replace_once(block, anchor, fixed_status + anchor)
    block = replace_once(block, '''        {
          "field": "DATAPREVISTO",
          "label": "DATA FINALIZAÇÃO"
        },
'''.encode(), b"")
    # Preserve positional step indices already saved in open conversations.
    for key, kind in ((END_STEP, "date"), (STATUS_STEP, "selection")):
        anchor = f'          "key": "{key}",\n          "kind": "{kind}",\n'.encode()
        block = replace_once(block, anchor, anchor + b'''          "editable": false,
          "when": {
            "any": []
          },
''')
    candidate = prefix + start + block + end + suffix
    json.loads(candidate)
    return candidate


def patch_workflow(source):
    anchor = b'    def _apply_fixed_fields(self, state: dict) -> None:\n'
    candidate = replace_once(source, anchor, anchor + b'''        if state.get("flow") == "construction_stage_demonstrative_create":
            # An older draft may already contain a completion date.
            state["fields"].pop("DATAPREVISTO", None)
            state["display_values"].pop("DATAPREVISTO", None)
''')
    anchor = b'''    def _handle_step_reply(self, event, state, etag) -> dict:
        provision_result = self._provision_reissue_skipped_freight(state, etag, event)
        if provision_result is not None:
            return provision_result
'''
    replacement = anchor + b'''        previous_index = state["step_index"]
        step = self._current_step(state)
        if (
            state.get("flow") == "construction_stage_demonstrative_create"
            and state["step_index"] != previous_index
        ):
            # A reply to a removed question belongs to the previous prompt.
            self._mark_processed(state, event["message_id"])
            return self._prompt_next_or_summary(state, etag)
'''
    anchor += b'        step = self._current_step(state)\n'
    candidate = replace_once(candidate, anchor, replacement)
    compile(candidate, WORKFLOW, "exec")
    return candidate


def patch(relative, source):
    transform = {CONFIG: patch_config, WORKFLOW: patch_workflow}.get(relative)
    if transform is None:
        raise ValueError(f"Unexpected source: {relative}")
    normalized = source.replace(b"\r\n", b"\n")
    if normalized == source:
        return transform(source)
    if normalized.replace(b"\n", b"\r\n") != source:
        raise ValueError(f"Mixed line endings: {relative}")
    return transform(normalized).replace(b"\n", b"\r\n")
