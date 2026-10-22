"""Hash-pinned backend-only patch. Never edits its input or channel_bridge.py."""
import ast
import hashlib
from pathlib import Path
import sys
import textwrap

BEFORE = 'e4b5af06230e8b761f13d98a19cec4e3e97237ea1674fc80c3a186dfe63d55ef'


def method(source, name, replacement):
    tree = ast.parse(source)
    engine = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'WorkflowEngine')
    nodes = [n for n in engine.body if isinstance(n, ast.FunctionDef) and n.name == name]
    if len(nodes) != 1:
        raise RuntimeError('Method anchor drift: ' + name)
    node = nodes[0]
    lines = source.splitlines(keepends=True)
    lines[node.lineno - 1:node.end_lineno] = [textwrap.indent(textwrap.dedent(replacement).strip(), '    ') + '\n']
    return ''.join(lines)


RECOVER = '''
def _recover_legacy_attachment_compression(self, state: dict, etag: str | None) -> dict:
    """Restore originals without interpreting the reply that triggered migration."""
    pending = state.get("pending_attachment_compression") or {}
    entries = [pending, *(state.get("attachment_compression_queue") or [])]
    resume = pending.get("resume_stage") or state.get("attachment_compression_resume_stage")
    if not resume or resume in {
        "confirming_attachment_compression", "confirming_compressed_attachment_choice",
        "confirming_intermediate_attachment_choice", "awaiting_attachment_compression_consent",
        "committing", "notifying", "compressing_attachments", "summarizing",
    }:
        resume = "awaiting_confirmation" if state.get("flow") else (
            "choosing_action" if state.get("selected_group") else "choosing_group"
        )
    state["stage"] = resume
    for name in (
        "attachment_compression_processed_count", "attachment_compression_all_approved",
        "attachment_compression_all_level", "attachment_compression_resume_stage",
        "attachment_compression_approved", "attachment_compression_result",
    ):
        state.pop(name, None)
    previews = []
    result = None
    state["legacy_attachment_compression_recovery"] = True
    for index, entry in enumerate(entries):
        original = entry.get("attachment") or {}
        if not original:
            continue
        # A durable save inside a flow handler must still retain every
        # unprocessed original if the process exits before returning.
        state["pending_attachment_compression"] = entry
        state["attachment_compression_queue"] = entries[index + 1:]
        for name in ("compressed_attachment", "intermediate_attachment"):
            preview = entry.get(name) or {}
            if preview.get("object_name") and preview.get("object_name") != original.get("object_name"):
                previews.append(preview)
        if any(
            (original.get("message_id") and item.get("message_id") == original["message_id"])
            or (original.get("object_name") and item.get("object_name") == original["object_name"])
            for item in state.get("attachments", [])
        ):
            continue
        original["compression_offer_handled"] = True
        original["compression_decision"] = "kept_original"
        if self._is_construction_diary_flow(state) and self.diary_evidence_builder is not None:
            original["compression_decision"] = (
                "diary_pdf_pipeline" if self.diary_evidence_builder.is_image(original)
                else "diary_final_batch"
            )
        event = dict(entry.get("event") or {})
        event["message_id"] = original.get("message_id") or event.get("message_id")
        if not event["message_id"]:
            raise ValueError("Legacy attachment has no message identity")
        event["kind"] = "attachment"
        result = self._continue_preprocessed_attachment(
            event, state, etag, str(entry.get("key") or state["key"]),
            original, initial=bool(entry.get("initial")),
        )
        etag = result.get("etag", etag)
    state.pop("pending_attachment_compression", None)
    state.pop("attachment_compression_queue", None)
    state.pop("legacy_attachment_compression_recovery", None)
    etag = self._save(state, etag)
    retained = {item.get("object_name") for item in self._all_state_attachments(state)}
    self._delete_staged_attachments(
        [item for item in previews if item.get("object_name") not in retained], state=state
    )
    if result is not None:
        return {**result, "etag": etag, "legacy_attachment_compression_recovered": True}
    return self._resend_current_prompt(state, etag)
'''


def patch(data):
    if hashlib.sha256(data).hexdigest() != BEFORE:
        raise RuntimeError('Workflow baseline hash mismatch')
    source = data.decode('utf-8')
    # Keep the diary final-PDF branch byte for byte. Replace only the former
    # consent branch; final posting still recalculates the actual stored bytes.
    start = source.index('        state["stage"] = "awaiting_attachment_compression_consent"', source.index('    def _request_attachment_compression('))
    end = source.index('\n    def _request_received_attachment_compression(', start)
    source = source[:start] + '''        state["stage"] = "awaiting_confirmation"
        state.pop("attachment_compression_approved", None)
        state.pop("attachment_compression_resume_stage", None)
        state["options"] = []
        etag = self._save(state, etag)
        self._send_actions(
            state,
            f"⚠️ ENVIO BLOQUEADO: OS ANEXOS TOTALIZAM {_human_size(total)}. "
            f"O CONJUNTO DEVE SER MENOR QUE {_human_size(self._attachment_size_limit())}. "
            "REMOVA OU SUBSTITUA ANEXOS PARA CONTINUAR. OS DADOS DO FORMULÁRIO FORAM PRESERVADOS.",
            [{"id": "confirm_edit", "title": "EDITAR"},
             {"id": "confirm_cancel", "title": "❌ CANCELAR"}],
            allow_back=False,
        )
        return {
            "status": "attachment_limit_exceeded", "batch_id": state["batch_id"],
            "attachment_total_bytes": total,
            "attachment_limit_bytes": self._attachment_size_limit(), "etag": etag,
        }
''' + source[end:]
    source = method(source, '_request_received_attachment_compression', '''
def _request_received_attachment_compression(
    self, state: dict, etag: str | None, resume_stage: str,
) -> dict | None:
    """Uploads retain originals; posting enforces the verified byte limit."""
    return None
''')
    # Preserve the diary image/final-batch classification above this anchor.
    start = source.index('        threshold = self._attachment_compression_offer_threshold(state)', source.index('    def _begin_attachment_compression_check('))
    end = source.index('\n    def _is_legacy_diary_individual_compression(', start)
    source = source[:start] + '''        attachment["compression_offer_handled"] = True
        attachment["compression_decision"] = "kept_original"
        return self._continue_preprocessed_attachment(
            event, state, etag, key, attachment, initial=initial,
        )

''' + textwrap.indent(textwrap.dedent(RECOVER).strip(), '    ') + '\n' + source[end:]
    source = source.replace('"""Oferece compactação universal somente acima do limite configurado."""',
                            '"""Preserva originais; compactação avulsa exige o ícone manual."""', 1)
    start = source.index('        if state and state.get("stage") in {\n            "confirming_attachment_compression",')
    end = source.index('        # Anexos recebidos depois da janela de silêncio', start)
    source = source[:start] + '''        if state and (state.get("legacy_attachment_compression_recovery") or state.get("stage") in {
            "confirming_attachment_compression", "confirming_compressed_attachment_choice",
            "confirming_intermediate_attachment_choice", "awaiting_attachment_compression_consent",
        }):
            recovered = self._recover_legacy_attachment_compression(state, etag)
            recovered_etag = recovered.get("etag", etag)
            if event.get("message_id") in state.get("processed_message_ids", []):
                return {**recovered, "status": "duplicate"}
            if event.get("kind") == "attachment":
                return self._handle_incoming_attachment(event, state, recovered_etag, key)
            reply = event.get("reply_id") or event.get("text") or ""
            if self._is_navigation_main_menu(reply):
                return self._return_to_main_menu(event, state, recovered_etag, key)
            if self._is_navigation_back(reply):
                self._mark_processed(state, event.get("message_id"))
                return self._navigate_back(state, recovered_etag)
            self._mark_processed(state, event.get("message_id"))
            recovered["etag"] = self._save(state, recovered_etag)
            return recovered

''' + source[end:]
    anchor = '    def _resend_current_prompt(self, state: dict, etag: str | None) -> dict:\n'
    if source.count(anchor) != 1:
        raise RuntimeError('Resend anchor drift')
    source = source.replace(anchor, anchor + '''        if state.get("legacy_attachment_compression_recovery") or state.get("stage") in {
            "confirming_attachment_compression", "confirming_compressed_attachment_choice",
            "confirming_intermediate_attachment_choice", "awaiting_attachment_compression_consent",
        }:
            return self._recover_legacy_attachment_compression(state, etag)
''')
    start = source.index(anchor)
    end = source.index('    def _send_attachment_actions(', start)
    resend = source[start:end]
    old = '''        self._save(state, etag)
        return {
            "status": "current_question_resent",
'''
    if resend.count(old) != 1:
        raise RuntimeError('Resend result anchor drift')
    resend = resend.replace(old, '''        etag = self._save(state, etag)
        return {
            "etag": etag,
            "status": "current_question_resent",
''')
    source = source[:start] + resend + source[end:]
    # This path saves again while resending the field. Carry that ETag into
    # the next recovered queued attachment instead of writing a stale version.
    start = source.index('    def _handle_attachment(self, event, state, etag, key) -> dict:')
    end = source.index('    @staticmethod\n    def _is_construction_diary_flow', start)
    handler = source[start:end]
    old = '''            self._resend_current_prompt(state, etag)
            return {
                "status": "attachment_staged",
'''
    if handler.count(old) != 1:
        raise RuntimeError('Form attachment ETag anchor drift')
    handler = handler.replace(old, '''            resumed = self._resend_current_prompt(state, etag)
            etag = resumed.get("etag", etag)
            return {
                "status": "attachment_staged",
''')
    source = source[:start] + handler + source[end:]
    compile(source, 'worker/workflow.py', 'exec')
    return source.encode('utf-8')


def main():
    if len(sys.argv) != 3:
        raise SystemExit('Usage: patch_workflow.py private-baseline.py private-candidate.py')
    original, candidate = map(Path, sys.argv[1:])
    if original.resolve() == candidate.resolve():
        raise RuntimeError('Input must remain unchanged')
    data = patch(original.read_bytes())
    if candidate.exists() and candidate.read_bytes() != data:
        raise RuntimeError('Candidate already exists with different bytes')
    candidate.parent.mkdir(parents=True, exist_ok=True)
    candidate.write_bytes(data)
    print(hashlib.sha256(data).hexdigest())


if __name__ == '__main__':
    main()
