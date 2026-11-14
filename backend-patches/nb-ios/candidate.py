"""Build an additive NB portal candidate against the installed engine."""
import sys
from pathlib import Path


def replace(source, old, new):
    if source.count(old) != 1:
        raise ValueError(f"Âncora do backend mudou: {old[:100]!r}")
    return source.replace(old, new, 1)


def scoped_block(source, name, replacements):
    start = source.index(f"    def {name}(")
    end = source.index("\n    def ", start + 1)
    block = source[start:end]
    for old, new in replacements:
        block = replace(block, old, new)
    return source[:start] + block + source[end:]


def patch_bridge(source):
    source = replace(source, "def portal_channel_payload(body: dict, identity: dict) -> dict:",
        '''def portal_sender(identity: dict) -> str:
    oid = str(identity.get("oid") or "").strip()
    if not oid:
        raise ValueError("Identidade Microsoft sem identificador")
    suffix = "@nb-participacoes" if identity.get("portalApp") == "nb-participacoes" else ""
    return f"portal:{oid}{suffix}"


def portal_channel_payload(body: dict, identity: dict) -> dict:''')
    source = replace(source, '    sender = f"portal:{oid}"', "    sender = portal_sender(identity)")
    source = replace(source, '        sender = _normalize_identifier(f"portal:{oid}")',
                     "        sender = _normalize_identifier(portal_sender(identity))")
    source = replace(source, '            return self.portal_authenticator.authenticate(self.headers.get("Authorization", ""))',
        '''            identity = self.portal_authenticator.authenticate(self.headers.get("Authorization", ""))
            app = self.headers.get("X-Portal-App")
            if app is None:
                return identity
            if app != "nb-participacoes":
                raise PermissionError("Aplicativo do portal inválido")
            return {**identity, "portalApp": app}''')
    source = replace(source, '"Authorization, Content-Type, X-Portal-File-Name, X-Portal-Message-Id",',
        '"Authorization, Content-Type, X-Portal-File-Name, X-Portal-Message-Id, X-Portal-App",')
    source = replace(source, '''                if "gallery_id" in query or "gallery_operation" in query:
                    return self._process_gallery_upload(identity, length, origin, query)''',
        '''                if "gallery_id" in query or "gallery_operation" in query:
                    if identity.get("portalApp") == "nb-participacoes":
                        raise PermissionError("Galeria indisponível no NB")
                    return self._process_gallery_upload(identity, length, origin, query)''')
    source = replace(source, '                if action == "dda_payment_confirm":',
        '''                if identity.get("portalApp") == "nb-participacoes" and action not in {
                    "", "operation_progress", "attachment_snapshot", "attachment_delete",
                    "attachment_delete_all", "attachment_compress", "attachment_compression_choice",
                    "home_attachment_transfer", "completion_menu",
                }:
                    raise PermissionError("Ação indisponível no NB")
                if action == "dda_payment_confirm":''')
    return source


def patch_workflow(source):
    source = replace(source, "    def _start_group_menu_options(self, state: dict) -> list[dict]:\n",
        '''    def _nb_portal_session(self, state: dict) -> bool:
        return (
            state.get("phone_number_id") == "portal-admin"
            and str(state.get("sender") or "").startswith("portal:")
            and str(state.get("sender") or "").endswith("@nb-participacoes")
        )

    def _start_group_menu_options(self, state: dict) -> list[dict]:
        if self._nb_portal_session(state):
            return [item for item in self._start_groups()
                    if item.get("id") in {"group_nb_participacoes", "group_personal_expenses"}]
''')
    source = scoped_block(source, "_send_start_group_menu", [
        ("        diary_photo_append = self._today_diary_photo_append_action()",
         "        diary_photo_append = None if self._nb_portal_session(state) else self._today_diary_photo_append_action()"),
    ])
    source = scoped_block(source, "_handle_group_choice", [
        ('        if command == "start_today_pending_attendance":',
         '        nb = self._nb_portal_session(state)\n        if not nb and command == "start_today_pending_attendance":'),
        ("        diary_photo_append = self._today_diary_photo_append_action()",
         "        diary_photo_append = None if nb else self._today_diary_photo_append_action()"),
        ("        diary_actions = self._main_menu_diary_actions(state)",
         "        diary_actions = [] if nb else self._main_menu_diary_actions(state)"),
        ('''                    if self._matches_menu_item(command, action, include_flow=True)''',
         '''                    if (not nb or action.get("group") in {"group_nb_participacoes", "group_personal_expenses"})
                    and self._matches_menu_item(command, action, include_flow=True)'''),
    ])
    source = scoped_block(source, "_open_submenu", [
        ('        if state.get("stage") == "choosing_subaction" and state.get(',
         '''        if self._nb_portal_session(state) and selected.get("submenu") != "nb_property_registrations":
            raise ValueError("Menu indisponível no NB")
        if state.get("stage") == "choosing_subaction" and state.get('''),
    ])
    source = scoped_block(source, "_begin_action", [
        ("        if cash_checkpoint_pending(state):",
         '''        if self._nb_portal_session(state) and selected.get("flow") not in {
            "rent_payment", "personal_expense_launch", "nb_property_registration", "nb_property_group_registration",
        }:
            raise ValueError("Fluxo indisponível no NB")
        if cash_checkpoint_pending(state):'''),
    ])
    return source


def prepare(root):
    files = {}
    for relative, patch in [("channel_bridge.py", patch_bridge), ("worker/workflow.py", patch_workflow)]:
        source = (root / relative).read_text(encoding="utf-8")
        updated = patch(source)
        compile(updated, relative, "exec")
        files[relative] = updated
    return files


if __name__ == "__main__":
    source, output = map(Path, sys.argv[1:])
    for relative, text in prepare(source).items():
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
