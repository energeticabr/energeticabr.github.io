"""Apply the narrowly scoped Home selection contract to a copied live backend.

Run on an isolated candidate directory; anchors must match exactly once.
The legacy TRANSFERIR button remains unchanged. No user files are deleted.
"""
import ast
import sys
from pathlib import Path


METHOD = '''    def portal_home_attachment_transfer(self, identity, body, *, allowed_emails):
        """Stage only explicitly selected, unsubmitted user files for Home."""
        from workflow_drafts import DRAFT_BUSY_STAGES
        with self.lock:
            key, state = self._portal_state(identity)
            self.portal_owners.authorize(key, identity, state_exists=bool(state),
                                         bind=bool(state), allowed_emails=allowed_emails)
            current, etag = self.engine.state_store.load(key)
            if current != state:
                raise ValueError("O fluxo mudou. Retome a conversa antes de sair.")
            if not state or state.get("stage") in DRAFT_BUSY_STAGES:
                raise ValueError("Aguarde a conclusão da etapa antes de sair.")
            if body.get("operation") == "confirm":
                pending = state.get("pending_portal_transfer") or {}
                receipt = body.get("homeTransferReceipt") or {}
                from workflow import PORTAL_TRANSFER_EXIT_STAGE
                if (not isinstance(receipt, dict) or not pending.get("home_message_id")
                    or state.get("stage") != PORTAL_TRANSFER_EXIT_STAGE
                    or "selected_attachments" not in pending
                    or receipt.get("requestId") != pending["home_message_id"]
                    or receipt.get("contextId") != pending["home_context_id"]
                    or receipt.get("attachmentIds") != pending["home_attachment_ids"]):
                    raise ValueError("A transferência mudou. Retome a conversa antes de confirmar.")
                event = normalize_channel_events(portal_channel_payload({
                    "messageId": body.get("messageId"), "replyId": "portal_transfer_draft_discard"}, identity))[0]
                self.messenger.reset()
                result = self.engine._finish_portal_transfer_exit(event, state, etag, key, save=False)
                return {"status": "processed", "results": [result], "messages": self.messenger.drain()}
            ids = body.get("attachmentIds")
            request_id = str(body.get("messageId") or "").strip()
            expected = str(body.get("expectedContextId") or "")
            if not request_id or len(request_id) > 128 or not isinstance(ids, list) or not ids or len(ids) > 1000:
                raise ValueError("Seleção de anexos inválida")
            if any(not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value) for value in ids):
                raise ValueError("Identificador de anexo inválido")
            if len(set(ids)) != len(ids):
                raise ValueError("Seleção de anexos duplicada")
            pending = state.get("pending_portal_transfer") or {}
            if pending.get("home_message_id") == request_id:
                if pending.get("home_attachment_ids") != ids or pending.get("home_context_id") != expected:
                    raise ValueError("A tentativa de transferência mudou")
                self.messenger.reset()
                self.engine._send_portal_transfer_exit_prompt(state)
                return {"status": "processed", "results": [{"status": "awaiting_portal_transfer"}],
                        "messages": self.messenger.drain()}
            if pending:
                raise ValueError("Retome a transferência em andamento antes de sair.")
            active = self.engine.active_flow_status(state)
            context_id = self._portal_saved_context(state)[0] if active else ""
            if expected != context_id:
                raise ValueError("O fluxo mudou. Retome a conversa antes de sair.")
            hidden = {str((state.get(name) or {}).get("object_name") or "") for name in (
                "document_signing_signature_attachment", "document_signing_epi_signed_attachment",
                "document_signing_payment_signed_attachment", "document_signing_pending_signed_attachment")}
            available = {self._portal_attachment_id(identity, state, item): item
                         for item in self.engine._all_state_attachments(state)
                         if isinstance(item, dict) and item.get("object_name")
                         and item["object_name"] not in hidden
                         and not item.get("existing_attachment") and not item.get("read_only")}
            if any(value not in available for value in ids):
                raise ValueError("Um anexo selecionado não está mais disponível ou já foi submetido.")
            media_root = Path(self.engine.media_repository.directory).resolve()
            for value in ids:
                path = (media_root / str(available[value]["object_name"])).resolve()
                if not path.is_relative_to(media_root / key[:12]) or not path.is_file():
                    raise ValueError("Um anexo selecionado não está mais disponível.")
            event = normalize_channel_events(portal_channel_payload({
                "messageId": request_id, "replyId": "portal_transfer_attachments"}, identity))[0]
            self.messenger.reset()
            result = self.engine._prompt_portal_transfer_exit(event, state, etag,
                selected_attachments=[available[value] for value in ids],
                home_receipt={"home_message_id": request_id, "home_attachment_ids": ids,
                              "home_context_id": expected})
            return {"status": "processed", "results": [result], "messages": self.messenger.drain()}

'''


def replace_once(source, anchor, replacement):
    if source.count(anchor) != 1:
        raise ValueError(f"Unsafe patch: anchor count {source.count(anchor)} for {anchor[:90]!r}")
    return source.replace(anchor, replacement, 1)


def patch(root):
    bridge_path, engine_path = root / "channel_bridge.py", root / "worker/workflow.py"
    bridge, engine = bridge_path.read_text(encoding="utf-8"), engine_path.read_text(encoding="utf-8")
    # Reuse the exact deployed context definition, including provision fields
    # and inactivity normalization, so this contract cannot hash a partial draft.
    context_start = bridge.index('            stage = state.get("stage")', bridge.index('    def portal_flow_status('))
    context_end = bridge.index('            # The engine already builds', context_start)
    context_body = bridge[context_start:context_end]
    helper = ('    def _portal_saved_context(self, state):\n'
              + '\n'.join(line[4:] if line.startswith('    ') else line for line in context_body.rstrip().split('\n'))
              + '\n        return context_id, paused\n\n')
    bridge = replace_once(bridge, context_body, '            context_id, paused = self._portal_saved_context(state)\n')
    bridge = replace_once(bridge, '    def portal_flow_status(', helper + '    def portal_flow_status(')
    bridge = replace_once(bridge, '            result = {**active, "contextId": context_id, "rows": rows, "paused": paused}\n',
        '            result = {**active, "contextId": context_id, "rows": rows, "paused": paused}\n'
        '            pending = state.get("pending_portal_transfer") or {}\n'
        '            if pending.get("home_message_id") and "selected_attachments" in pending:\n'
        '                result["homeAttachmentTransfer"] = {\n'
        '                    "requestId": pending["home_message_id"],\n'
        '                    "contextId": pending["home_context_id"],\n'
        '                    "attachmentIds": list(pending["home_attachment_ids"]),\n'
        '                }\n')
    bridge = replace_once(bridge, "    def portal_attachment_delete(\n", METHOD + "    def portal_attachment_delete(\n")
    bridge = replace_once(bridge, '                elif action == "attachment_delete":\n',
        '                elif action == "home_attachment_transfer":\n'
        '                    result = self.bridge.portal_home_attachment_transfer(\n'
        '                        identity, body, allowed_emails=self.portal_authenticator.allowed_emails,\n'
        '                    )\n'
        '                elif action == "attachment_delete":\n')
    engine = replace_once(engine,
        '    def _prompt_portal_transfer_exit(self, event: dict, state: dict, etag: str | None) -> dict:\n',
        '    def _prompt_portal_transfer_exit(self, event: dict, state: dict, etag: str | None, *, selected_attachments=None, home_receipt=None) -> dict:\n')
    engine = replace_once(engine, '        state["pending_portal_transfer"] = pending\n',
        '        if selected_attachments is not None:\n'
        '            pending["selected_attachments"] = copy.deepcopy(selected_attachments)\n'
        '            pending.update(home_receipt or {})\n'
        '        state["pending_portal_transfer"] = pending\n')
    finish_header = ('    def _finish_portal_transfer_exit(\n'
        '        self, event: dict, previous_state: dict, etag: str | None, key: str, *, save: bool\n'
        '    ) -> dict:\n')
    engine = replace_once(engine, finish_header + '        previous_attachments = self._all_state_attachments(previous_state)\n',
        finish_header + '        pending = previous_state.get("pending_portal_transfer") or {}\n'
        '        previous_attachments = (pending["selected_attachments"] if "selected_attachments" in pending\n'
        '                                else self._all_state_attachments(previous_state))\n')
    ast.parse(bridge)
    ast.parse(engine)
    bridge_path.write_text(bridge, encoding="utf-8")
    engine_path.write_text(engine, encoding="utf-8")


if __name__ == "__main__":
    patch(Path(sys.argv[1]))
