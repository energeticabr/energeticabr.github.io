"""Build independent workflow candidates for the Gantt registration entry point."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def replace_once(source, anchor, replacement):
    if source.count(anchor) != 1:
        raise ValueError(f"Unexpected workflow anchor: {anchor[:100]}")
    return source.replace(anchor, replacement, 1)


def transform(raw):
    source = raw.decode("utf-8")
    anchor = '        state, etag = self.state_store.load(key)\n        document_result = document_batch.guard_event'
    source = replace_once(source, anchor, '''        state, etag = self.state_store.load(key)
        if event["kind"] == "text" and str(event.get("reply_id") or "").startswith("gantt_create_demonstrative:"):
            return self._start_gantt_demonstrative(event, key, state, etag)
        document_result = document_batch.guard_event''')

    anchor = '    def _start_embedded_attendance_demonstrative_registration('
    source = replace_once(source, anchor, '''    def _start_gantt_demonstrative(self, event, key, state, etag):
        if (event.get("trusted_portal") is not True or event.get("group_id")
                or event.get("phone_number_id") != "portal-admin"):
            return {"status": "ignored", "message_id": event.get("message_id")}
        if self._nb_portal_session(state or event):
            return {"status": "ignored", "message_id": event.get("message_id")}
        if state and event["message_id"] in state.get("processed_message_ids", []):
            return {"status": "duplicate", "message_id": event["message_id"], "batch_id": state["batch_id"]}
        if state and state.get("stage") not in {
            "choosing_group", "choosing_action", "choosing_subaction", "choosing_pending",
            "completed", "cancelled",
        }:
            self._send_text(state, "Conclua ou saia do fluxo em andamento para cadastrar pelo Gantt.")
            return {"status": "gantt_flow_busy", "batch_id": state["batch_id"]}

        match = re.fullmatch(r"gantt_create_demonstrative:([1-9][0-9]{0,9})", event["reply_id"])
        if not match:
            return {"status": "ignored", "message_id": event["message_id"]}
        parent_id = int(match[1])
        fields = self.sharepoint.get_item_fields(
            parent_id, ["FILIAL", "ETAPA", "STATUS", "TIPO"], target_list="LANCAMENTOOBRA",
        )
        linked_fields = {field: str(fields.get(field) or "").strip() for field in ("FILIAL", "ETAPA")}
        if (normalize_text(fields.get("STATUS")) != "iniciado"
                or normalize_text(fields.get("TIPO")) != "atividade comum"
                or not all(linked_fields.values())):
            self._send_text(
                state or self._new_state(event, key),
                "A etapa selecionada não está disponível para cadastro. Atualize o Gantt e confira a etapa.",
            )
            return {"status": "gantt_stage_unavailable"}

        if not state or state.get("stage") in {"completed", "cancelled"}:
            processed = list((state or {}).get("processed_message_ids", []))
            state = self._new_state(event, key)
            state["processed_message_ids"] = processed
        self._mark_processed(state, event["message_id"])
        return self._begin_action(
            state, etag,
            {"flow": "construction_stage_demonstrative_create", "group": "group_construction_stage",
             "title": "CADASTRAR DEMONSTRATIVO DE ETAPA"},
            preset_fields=linked_fields,
            preset_display_values=linked_fields,
            preset_answers={"gantt_parent_stage_id": parent_id},
        )

''' + anchor)

    anchor = '''        if state.get("flow") == "construction_stage_demonstrative_create":
            return self.config["sharepoint"][
                "construction_stage_demonstrative_create_flow"
            ]
'''
    source = replace_once(source, anchor, '''        if state.get("flow") == "construction_stage_demonstrative_create":
            flow = self.config["sharepoint"]["construction_stage_demonstrative_create_flow"]
            if state.get("answers", {}).get("gantt_parent_stage_id"):
                flow = {**flow, "steps": [
                    {**step, "when": {"any": []}, "editable": False}
                    if step.get("target_field") in {"FILIAL", "ETAPA"} else step
                    for step in flow["steps"]
                ]}
            return flow
''')
    anchor = '        preset_display_values: dict | None = None,\n'
    source = replace_once(source, anchor, anchor + '        preset_answers: dict | None = None,\n')
    anchor = '        if preset_display_values:\n            state["display_values"].update(preset_display_values)\n'
    source = replace_once(source, anchor, anchor + '        if preset_answers:\n            state["answers"].update(preset_answers)\n')
    compile(source, "worker/workflow.py", "exec")
    return source.encode("utf-8")


def package():
    targets = {"app": Path("/opt/energetica-whatsapp"), "build": Path("/home/opc/energetica-build")}
    relative = "worker/workflow.py"
    manifest = {}
    for name, target in targets.items():
        before = (target / relative).read_bytes()
        after = transform(before)
        output = ROOT / "candidate" / name / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(after)
        manifest[name] = {"relative": relative, "before": hashlib.sha256(before).hexdigest(),
                          "after": hashlib.sha256(after).hexdigest()}
    (ROOT / "deploy-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest))


if __name__ == "__main__":
    package()
