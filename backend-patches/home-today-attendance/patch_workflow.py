"""Small exact-context workflow patch; refuse ambiguous or already changed inputs."""
from pathlib import Path
import sys

METHODS = '''    def _today_pending_attendance_action(self, state: dict) -> dict | None:
        today = datetime.now(ZoneInfo("America/Sao_Paulo")).date().isoformat()
        # Same pending/date rules as the existing checklist; never count RHID
        # punches or days. Read failures return no shortcut, not a guessed count.
        rows = self._pending_attendance_record_options(state, today)
        count = len({row["value"] for row in rows})
        if not count:
            return None
        return {
            "id": "start_today_pending_attendance",
            "reply": "start_today_pending_attendance",
            "title": f"👷 PRESENÇAS ({count})",
            "tone": "danger",
            "date": today,
        }

'''

HANDLER = '''        if command == "start_today_pending_attendance":
            self._mark_processed(state, event["message_id"])
            # A menu left open overnight must use today's server-local date.
            action = self._today_pending_attendance_action(state)
            if not action:
                self._send_text(state, "NÃO HÁ PRESENÇAS PENDENTES DE HOJE DISPONÍVEIS PARA VALIDAR.")
                self._send_start_group_menu(state)
                etag = self._save(state, etag)
                return {"status": "awaiting_action", "batch_id": state["batch_id"], "etag": etag}
            return self._begin_action(
                state, etag,
                {"flow": "attendance_validation", "group": "group_human_resources", "attendance_home_shortcut": True,
                 "title": "VALIDAR PRESENÇAS APONTADAS"},
                start_step_key="registro_presenca_pendente",
                preset_fields={"DATA FILTRO PRESENÇA": action["date"]},
                preset_display_values={"DATA FILTRO PRESENÇA": _display_iso_date(action["date"])},
            )
'''

def patch_workflow(source):
    replacements = [
        ('    def _start_group_menu_options(self, state: dict) -> list[dict]:\n',
         METHODS + '    def _start_group_menu_options(self, state: dict) -> list[dict]:\n'),
        ('        return groups[:1] + self._main_menu_diary_actions(state) + groups[1:]\n',
         '        today_attendance = self._today_pending_attendance_action(state)\n'
         '        shortcuts = ([today_attendance] if today_attendance else []) + self._main_menu_diary_actions(state)\n'
         '        return groups[:1] + shortcuts + groups[1:]\n'),
        ('    def _handle_group_choice(\n        self, event: dict, state: dict, etag: str | None\n    ) -> dict:\n'
         '        raw = event.get("reply_id") or event.get("text") or ""\n        command = normalize_text(raw)\n',
         '    def _handle_group_choice(\n        self, event: dict, state: dict, etag: str | None\n    ) -> dict:\n'
         '        raw = event.get("reply_id") or event.get("text") or ""\n        command = normalize_text(raw)\n' + HANDLER),
        ('        if state.get("flow") == "attendance_validation" and step.get("key") in {\n'
         '            "revisar_dados_presenca", "status_presenca_validacao",\n',
         '        if state.get("attendance_home_shortcut") and state.get("flow") == "attendance_validation" and step.get("key") == "registro_presenca_pendente":\n'
         '            selected_day = self._pending_attendance_date_display(state.get("fields", {}).get("DATA FILTRO PRESENÇA"))\n'
         '            options = [item for item in options\n'
         '                       if normalize_text(str((item.get("source_values") or {}).get("PRESENCA") or "")) == "pendente"\n'
         '                       and self._pending_attendance_date_display((item.get("source_values") or {}).get("DATA")) == selected_day]\n'
         '        if state.get("flow") == "attendance_validation" and step.get("key") in {\n'
         '            "revisar_dados_presenca", "status_presenca_validacao",\n'),
        ('        state["flow"] = selected["flow"]\n',
         '        state["flow"] = selected["flow"]\n'
         '        state["attendance_home_shortcut"] = bool(selected.get("attendance_home_shortcut"))\n'),
    ]
    for old, new in replacements:
        if source.count(old) != 1:
            raise ValueError('Workflow source drift: exact unique anchor required')
        source = source.replace(old, new, 1)
    compile(source, 'workflow.py', 'exec')
    return source

if __name__ == '__main__':
    source, destination = map(Path, sys.argv[1:])
    with destination.open('x', encoding='utf-8', newline='\n') as target:
        target.write(patch_workflow(source.read_text(encoding='utf-8')))
