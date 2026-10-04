"""Read-only live monthly contract check; prints counts, never identities."""
from datetime import date, timedelta
from pathlib import Path
from channel_bridge import build_engine, load_env
from rhid_attendance_adjustments import SharePointRhidAttendanceAdjustmentStore
from rhid_calendar_snapshot import monthly_effective_rows

load_env(Path('/etc/energetica-whatsapp.env'))
engine = build_engine()
first = date(2026, 10, 1)
next_month = date(2026, 11, 1)
rows = engine.sharepoint.get_report_rows({
    'target_list': 'RHID PRESENÇAS', 'date_field': 'DATA_REFERENCIA',
    'columns': [{'field': f} for f in ('DATA_REFERENCIA', 'BATIDAS_RHID', 'ID_PESSOA_RHID', 'NOME_COLABORADOR', 'STATUS_RHID')],
    'sort_direction': 'asc',
}, {'date_start': first.isoformat(), 'date_end': (next_month - timedelta(days=1)).isoformat()})
snapshot = monthly_effective_rows(rows, SharePointRhidAttendanceAdjustmentStore(engine.sharepoint), first, next_month)
assert all('Id' in row and 'ID_PESSOA_RHID' in row for row in snapshot)
print({'month': '2026-10', 'rows': len(snapshot), 'adjustedRows': sum(bool(row.get('ADMIN_AJUSTES')) for row in snapshot)})
