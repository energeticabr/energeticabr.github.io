"""Extend the existing compatible home shortcut to all pending dates."""
from pathlib import Path
import sys

OLD_QUERY = '''        today = datetime.now(ZoneInfo("America/Sao_Paulo")).date().isoformat()
        # Same pending/date rules as the existing checklist; never count RHID
        # punches or days. Read failures return no shortcut, not a guessed count.
        rows = self._pending_attendance_record_options(state, today)
        count = len({row["value"] for row in rows})
'''

NEW_QUERY = '''        # Keep the existing reply ID for installed clients, but count every
        # pending record, including earlier dates and records without a date.
        steps = self._attendance_validation_config().get("steps", [])
        if len(steps) < 2:
            return None
        step = copy.deepcopy(steps[1])
        step["source"]["filters"] = [
            item for item in step["source"].get("filters", [])
            if item.get("field") != "DATA"
        ]
        try:
            rows = self.sharepoint.get_options(step, {})
        except Exception:
            return None
        identifiers = set()
        for row in rows:
            source = row.get("source_values") or {}
            if normalize_text(str(source.get("PRESENCA") or "")) != "pendente":
                continue
            identifier = source.get("Id", row.get("value", row.get("id")))
            if identifier not in (None, ""):
                identifiers.add(str(identifier))
        count = len(identifiers)
'''


def patch_workflow(source):
    changes = [
        (OLD_QUERY, NEW_QUERY),
        ('            "tone": "danger",\n            "date": today,\n', '            "tone": "danger",\n'),
        ("            # A menu left open overnight must use today's server-local date.\n",
         '            # Recheck all pending dates when a previously rendered menu is clicked.\n'),
        ('NÃO HÁ PRESENÇAS PENDENTES DE HOJE DISPONÍVEIS PARA VALIDAR.',
         'NÃO HÁ PRESENÇAS PENDENTES DISPONÍVEIS PARA VALIDAR.'),
        ('''                start_step_key="registro_presenca_pendente",
                preset_fields={"DATA FILTRO PRESENÇA": action["date"]},
                preset_display_values={"DATA FILTRO PRESENÇA": _display_iso_date(action["date"])},
''', '''                start_step_key="data_presenca_pendente",
'''),
    ]
    for old, new in changes:
        if source.count(old) != 1:
            raise ValueError('Workflow drift: expected one anchor: ' + old[:90])
        source = source.replace(old, new, 1)
    compile(source, 'workflow.py', 'exec')
    return source


if __name__ == '__main__':
    original, candidate = map(Path, sys.argv[1:])
    with candidate.open('x', encoding='utf-8', newline='\n') as handle:
        handle.write(patch_workflow(original.read_text(encoding='utf-8')))
