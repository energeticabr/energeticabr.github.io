"""Apply small, exact changes to the bridge and launch gallery source."""
from pathlib import Path
import sys


OPERATIONS = '{"payroll_pending", "payroll_targets", "payroll_detail", "payroll_apply", "payroll_legacy_link"}'

BRIDGE_OPERATIONS = '''            "attachment", "attachment_add", "attachment_delete", "signature",
        } or not isinstance(payload, dict):
'''
BRIDGE_GALLERY_OWNER = '''            self.portal_owners.authorize(
                key, identity, state_exists=bool(state), bind=True, allowed_emails=allowed_emails,
            )
            from launch_gallery import LaunchGalleryService
'''
BRIDGE_AUTHORIZED_CHECK = '''            if operation in ''' + OPERATIONS + ''':
                configured = os.getenv("PAYROLL_PENDING_ALLOWED_EMAILS")
                payroll_emails = configured.split(",") if configured is not None else allowed_emails
                allowed = {email.strip().casefold() for email in payroll_emails if email.strip()}
                if str(identity.get("email") or "").strip().casefold() not in allowed:
                    raise PermissionError("Conta Microsoft sem acesso ao relatório de pagamentos IDFOLHA")
'''
BRIDGE_DISPATCH = '''                        result = self.bridge.portal_launch_gallery(
                            identity, operation, body.get("payload") or {}, self.portal_media_store,
                            allowed_emails=self.portal_authenticator.allowed_emails,
                        )
'''
BRIDGE_DISPATCH_PATCH = '''                        from launch_gallery import LaunchGalleryError
                        try:
                            result = self.bridge.portal_launch_gallery(
                                identity, operation, body.get("payload") or {}, self.portal_media_store,
                                allowed_emails=self.portal_authenticator.allowed_emails,
                            )
                        except LaunchGalleryError as exc:
                            if operation not in ''' + OPERATIONS + ''':
                                raise
                            return self._send_json(exc.status, {"error": str(exc), "code": exc.code, **exc.details}, cors_origin=origin)
'''
GALLERY_ENTRY = '''    def _handle(self, operation, payload):
        operations = {"snapshot", "detail", "schema", "update", "delete", "payment", "measurement",
'''
GALLERY_ENTRY_PATCH = '''    def _handle(self, operation, payload):
        if isinstance(operation, str) and operation in ''' + OPERATIONS + ''':
            if not isinstance(payload, dict):
                _fail("invalid_payload", "O payload deve ser um objeto.")
            if __package__:
                from .payroll_pending import handle
            else:
                from payroll_pending import handle
            return handle(self, operation, payload)
        operations = {"snapshot", "detail", "schema", "update", "delete", "payment", "measurement",
'''
UPDATE = '''            values = self._validate(LAUNCHES, payload.get("fields"), EDIT_FIELDS, current)
            self._check_measurement_pair(values, current)
'''
DELETE = '''        elif operation == "delete":
            self._delete_launch(item_id, current)
'''
LEGACY_LOAD = '''    def _payroll_transfer_plan(self, item_id, supplier, current):
        line_fields = ("FORNECEDOR", "IDFOLHA", "IDLANCAMENTO")
        sheet_fields = ("FORNECEDOR", "MESREFERENCIA", "STATUS")
        # IDLANCAMENTO is indexed text in FOLHAPGTO. Reject schema drift rather
        # than interpreting a failed/incorrect lookup as an unlinked launch.
        link = self._field("FOLHAPGTO", "IDLANCAMENTO")
        if link.get("TypeAsString") != "Text":
            _fail("payroll_schema", "A coluna IDLANCAMENTO da folha mudou de formato.", 503)
        linked = self._rows("FOLHAPGTO", ["IDLANCAMENTO"], f"{link['InternalName']} eq {_literal(item_id)}")
'''
LINK_HELPERS = '''    def _pending_payroll_rows(self, item_id):
        # Use the indexed origin column, including when checking whether a
        # previously unlinked launch can still be changed.
        link = self._field("FOLHAPGTO", "IDLANCAMENTO")
        if link.get("TypeAsString") != "Text":
            _fail("payroll_schema", "A coluna IDLANCAMENTO da folha mudou de formato.", 503)
        self._field("FOLHAPGTO", "Title")
        return self._rows("FOLHAPGTO", ["IDLANCAMENTO", "Title"], f"{link['InternalName']} eq {_literal(item_id)}")

    def _guard_pending_payroll_origin(self, item_id, operation, changes, current):
        protected = operation == "delete"
        for field in ("QUANTIDADE", "VALOR UNITÁRIO", "FRETE"):
            if field in changes and _number(changes[field], True) != _number(current.get(field), True):
                protected = True
        if "TIPO TRANSAÇÃO" in changes and _norm(changes["TIPO TRANSAÇÃO"]) != _norm(current.get("TIPO TRANSAÇÃO")):
            protected = True
        paid_date = "DATA PGTO EFETUADO"
        if paid_date in changes:
            before, after = current.get(paid_date), changes[paid_date]
            if _blank(before) or _blank(after):
                protected = protected or _blank(before) != _blank(after)
            elif _instant(before).astimezone(TZ).date() != _instant(after).astimezone(TZ).date():
                protected = True
        if not protected:
            return
        if __package__:
            from .payroll_pending import has_unresolved_application
        else:
            from payroll_pending import has_unresolved_application
        if any(str(row.get("Title") or "").startswith("IDFOLHA-PENDENTE:")
               for row in self._pending_payroll_rows(item_id)) or has_unresolved_application(self, item_id):
            _fail("payroll_allocated_origin", "O lançamento tem valores aplicados em IDFOLHA ou uma aplicação em andamento.", 409)

    def _payroll_transfer_plan(self, item_id, supplier, current):
        line_fields = ("FORNECEDOR", "IDFOLHA", "IDLANCAMENTO")
        sheet_fields = ("FORNECEDOR", "MESREFERENCIA", "STATUS")
        # These rows were deliberately assigned to their own suppliers.
        linked = [row for row in self._pending_payroll_rows(item_id)
                  if not str(row.get("Title") or "").startswith("IDFOLHA-PENDENTE:")]
'''


WORKER_HANDLER = '''    def _apply_launch_payroll_type(self, state, etag, selected_type):
        pending = state['pending_launch_payroll']
'''
WORKER_HANDLER_PATCH = '''    def _apply_launch_payroll_type(self, state, etag, selected_type):
        if __package__:
            from .launch_gallery import LaunchGalleryError
        else:
            from launch_gallery import LaunchGalleryError

        pending = state['pending_launch_payroll']
'''
WORKER_CREATE_OLD = '''        payroll_item_id = self.sharepoint.ensure_item(
            token,
            payroll_fields,
            target_list="FOLHAPGTO",
            idempotency_field="Title",
            merge_existing=False,
        )
        verification = self.sharepoint.verify_item(
            payroll_item_id,
            payroll_fields,
            [],
            target_list="FOLHAPGTO",
        )
        if not (verification is True or (
                isinstance(verification, dict) and verification.get("fields") is True
                and verification.get("attachments") is True)):
            raise RuntimeError("O vínculo à folha ainda não foi confirmado")
'''
WORKER_GUARD = '''        from contextlib import nullcontext

        if __package__:
            from .launch_gallery import LaunchGalleryService
            from .payroll_pending import legacy_origin_write
        else:
            from launch_gallery import LaunchGalleryService
            from payroll_pending import legacy_origin_write

        guard = nullcontext()
        if payroll_fields.get("IDLANCAMENTO"):
            guard = legacy_origin_write(LaunchGalleryService(self), str(payroll_fields["IDLANCAMENTO"]), token)
        with guard as already_created:
'''
WORKER_TRY = '''                try:
                    self._record_launch_payroll_type(state, entry, selected_type)
                except Exception:
'''
WORKER_TRY_PATCH = '''                try:
                    self._record_launch_payroll_type(state, entry, selected_type)
                except LaunchGalleryError as exc:
                    if exc.code != "payroll_allocation_locked":
                        self._send_text(state, f"❌ NÃO FOI POSSÍVEL CONFIRMAR O PAGAMENTO {entry.get('item_id')}. {exc}")
                        return self._prompt_launch_payroll_type(state, etag)
                    self._send_text(state, f"ℹ️ O PAGAMENTO {entry.get('item_id')} TEM APLICAÇÕES NO RELATÓRIO IDFOLHA. "
                                    "CONTINUE O VÍNCULO PELO RELATÓRIO DE PENDÊNCIAS.")
                except Exception:
'''
WORKER_COMPLETION = '''        self._send_text(state, f'✅ {len(entries)} PAGAMENTO(S) ADICIONADO(S) À FOLHAPGTO.')
        return self._continue_launch_after_payroll(state, etag)
'''
WORKER_COMPLETION_PATCH = '''        count = sum(bool(entry.get("FOLHAPGTO_ID")) for entry in entries)
        if count:
            self._send_text(state, f'✅ {count} PAGAMENTO(S) ADICIONADO(S) À FOLHAPGTO.')
        return self._continue_launch_after_payroll(state, etag)
'''

def replace_once(source, anchor, replacement):
    if source.count(anchor) != 1:
        raise RuntimeError("Patch anchor must occur once: " + anchor.splitlines()[0].strip())
    return source.replace(anchor, replacement, 1)


def change(relative, before):
    source = before.decode("utf-8")
    crlf = "\r\n" in source
    source = source.replace("\r\n", "\n")
    if "\r" in source or (crlf and b"\n" in before.replace(b"\r\n", b"")):
        raise RuntimeError("Mixed source line endings: " + relative)
    if relative == "channel_bridge.py":
        changed = replace_once(source, BRIDGE_OPERATIONS,
                               BRIDGE_OPERATIONS.replace("        }", f"            *{OPERATIONS},\n        }}", 1))
        authorized = BRIDGE_GALLERY_OWNER.replace(
            "            from launch_gallery import", BRIDGE_AUTHORIZED_CHECK + "            from launch_gallery import", 1)
        changed = replace_once(changed, BRIDGE_GALLERY_OWNER, authorized)
        changed = replace_once(changed, BRIDGE_DISPATCH, BRIDGE_DISPATCH_PATCH)
    elif relative == "worker/launch_gallery.py":
        changed = replace_once(source, GALLERY_ENTRY, GALLERY_ENTRY_PATCH)
        changed = replace_once(changed, UPDATE, UPDATE + '            self._guard_pending_payroll_origin(item_id, operation, values, current)\n')
        changed = replace_once(changed, DELETE, DELETE.replace(
            "            self._delete_launch", "            self._guard_pending_payroll_origin(item_id, operation, {}, current)\n            self._delete_launch", 1))
        changed = replace_once(changed, LEGACY_LOAD, LINK_HELPERS)
    elif relative == "worker/workflow.py":
        changed = replace_once(source, WORKER_HANDLER, WORKER_HANDLER_PATCH)
        changed = replace_once(changed, WORKER_TRY, WORKER_TRY_PATCH)
        changed = replace_once(changed, WORKER_COMPLETION, WORKER_COMPLETION_PATCH)
        changed = replace_once(changed, WORKER_CREATE_OLD,
                               WORKER_GUARD + "".join("    " + line for line in WORKER_CREATE_OLD.replace(
                                   "payroll_item_id = self.sharepoint.ensure_item(",
                                   "payroll_item_id = already_created or self.sharepoint.ensure_item(", 1).splitlines(keepends=True)))
    else:
        raise ValueError("Unexpected backend patch target: " + relative)
    return (changed.replace("\n", "\r\n") if crlf else changed).encode("utf-8")


if __name__ == "__main__":
    target, source_path, output = sys.argv[1:]
    Path(output).write_bytes(change(target, Path(source_path).read_bytes()))
