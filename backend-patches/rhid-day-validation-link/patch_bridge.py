"""Exact-anchor RHID day validation patch for channel_bridge.py."""
from pathlib import Path
import sys

DAY_METHOD = '''    def portal_rhid_day_validation_start(
        self, identity: dict, selected_date, *, allowed_emails: set[str],
    ) -> dict:
        """Open the complete pending-presence checklist for the selected report day."""
        raw_date = str(selected_date or "").strip()
        try:
            on_date = date.fromisoformat(raw_date)
        except (TypeError, ValueError) as exc:
            raise ValueError("Data inválida para validar presenças.") from exc
        if on_date.isoformat() != raw_date:
            raise ValueError("Data inválida para validar presenças.")
        with self.lock:
            key, state = self._portal_state(identity)
            self.portal_owners.authorize(
                key, identity, state_exists=bool(state), bind=bool(state),
                allowed_emails=allowed_emails,
            )
            if not state:
                raise ValueError("Abra a conversa antes de validar presenças.")
            if state.get("attachments"):
                raise ValueError("Conclua ou retire os anexos pendentes antes de abrir a validação.")
            state, etag = self.engine.state_store.load(key)
            if not state:
                raise ValueError("A conversa não está mais disponível. Retome e tente novamente.")
            options = self.engine._pending_attendance_record_options(state, raw_date)
            if not options:
                raise ValueError("Não há presenças pendentes nesta data. Atualize o relatório.")
            self.messenger.reset()
            self.engine._push_navigation_state(state)
            started = self.engine._begin_action(
                state, etag,
                {"flow": "attendance_validation", "group": "group_human_resources",
                 "attendance_home_shortcut": True, "title": "VALIDAR PRESENÇAS APONTADAS"},
                start_step_key="registro_presenca_pendente",
                preset_fields={"DATA FILTRO PRESENÇA": raw_date},
                preset_display_values={"DATA FILTRO PRESENÇA": on_date.strftime("%d/%m/%Y")},
            )
            return {"status": "processed", "messages": self.messenger.drain(), "results": [started]}

'''

COUNT = '''        pending_ids = {
            str(row.get("Id") or "").strip() for row in pending_rows
            if isinstance(row, dict)
            and re.fullmatch(r"[1-9][0-9]*", str(row.get("Id") or "").strip())
            and str(row.get("DATA") or "")[:10] == on_date.isoformat()
            and normalize_text(str(row.get("PRESENCA") or "")) == "pendente"
        }
'''

ROUTE = '''                elif action == "rhid_day_validation_start":
                    if set(body) - {"action", "date"}:
                        raise ValueError("Parâmetros não permitidos na validação de presenças")
                    result = self.bridge.portal_rhid_day_validation_start(
                        identity, body.get("date"),
                        allowed_emails=self.portal_authenticator.allowed_emails,
                    )
'''


def exactly_once(source, old, new):
    if source.count(old) != 1:
        raise ValueError("RHID bridge source drift: unique anchor required")
    return source.replace(old, new, 1)


def patch_bridge(source):
    before = '    def portal_rhid_attendance_report(\n'
    after = '    def portal_rhid_pending_validation_start(\n'
    if source.count(before) != 1 or source.count(after) != 1:
        raise ValueError("RHID bridge source drift: report method boundary")
    head, report_and_tail = source.split(before, 1)
    report, tail = report_and_tail.split(after, 1)
    report = exactly_once(
        report, '        pending_rows = self.engine.sharepoint.get_pending_attendance(on_date)\n',
        '        pending_rows = self.engine.sharepoint.get_pending_attendance(on_date)\n' + COUNT,
    )
    report = exactly_once(
        report, '"attendanceReport": {"date": on_date.isoformat(), "rows": rows,',
        '"attendanceReport": {"date": on_date.isoformat(), "rows": rows,\n                "pendingValidationCount": len(pending_ids),',
    )
    source = head + before + report + DAY_METHOD + after + tail
    source = exactly_once(source, '                elif action == "rhid_pending_validation_start":\n',
                          ROUTE + '                elif action == "rhid_pending_validation_start":\n')
    compile(source, 'channel_bridge.py', 'exec')
    return source


if __name__ == '__main__':
    source, destination = map(Path, sys.argv[1:])
    with destination.open('x', encoding='utf-8', newline='\n') as output:
        output.write(patch_bridge(source.read_text(encoding='utf-8')))
