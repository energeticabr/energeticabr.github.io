"""Withdraw a user's manual revision without destroying RHID or its audit trail."""
from datetime import date, datetime
import re
from zoneinfo import ZoneInfo

SLOTS = frozenset(('entry1', 'exit1', 'entry2', 'exit2'))
TIME = re.compile(r'(?:[01]\d|2[0-3]):[0-5]\d')
REMOVAL = re.compile(r'EXCLUSAO-AJUSTE-([1-9]\d*)')


def latest_active_rows(rows):
    """A withdrawal clears the current revision, never revives its predecessor."""
    active = {}
    for row in sorted(rows, key=lambda item: int(item.get('Id') or 0)):
        key = (str(row.get('DATA_REFERENCIA') or '')[:10],
               str(row.get('ID_PESSOA_RHID') or ''), str(row.get('CAMPO') or ''))
        if key[2] not in SLOTS:
            continue
        time = str(row.get('HORARIO_CORRIGIDO') or '')
        marker = REMOVAL.fullmatch(str(row.get('Title') or '')) if not time else None
        if marker:
            if str(active.get(key, {}).get('Id')) == marker[1]:
                active.pop(key, None)
        elif TIME.fullmatch(time):
            active[key] = row
    return sorted(active.values(), key=lambda item: int(item['Id']))


def _is_owner(row, actor):
    parts = str(row.get('RESPONSAVEL') or '').split(' | ')
    oid = str(actor.get('oid') or '').strip()
    return bool(oid) and len(parts) == 3 and parts[2].strip().casefold() == oid.casefold()


def remove_manual_adjustment(store, on_date, person_key, slot, revision_id, actor):
    if (not isinstance(on_date, date) or isinstance(on_date, datetime)
            or not re.fullmatch(r'(?:rhid|id):[^\s:]+', str(person_key or ''))
            or slot not in SLOTS or not re.fullmatch(r'[1-9]\d*', str(revision_id or ''))):
        raise ValueError('Registro de ajuste inválido.')
    if not isinstance(actor, dict) or not str(actor.get('oid') or '').strip():
        raise PermissionError('Responsável pelo ajuste não identificado.')
    revision_id = str(revision_id)
    rows = [row for row in store._items(f"DATA_REFERENCIA eq '{on_date.isoformat()}'")
            if str(row.get('DATA_REFERENCIA') or '')[:10] == on_date.isoformat()
            and row.get('ID_PESSOA_RHID') == person_key and row.get('CAMPO') == slot]
    originals = [row for row in rows if str(row.get('Id')) == revision_id and TIME.fullmatch(str(row.get('HORARIO_CORRIGIDO') or ''))]
    if len(originals) != 1:
        raise ValueError('Atualize o relatório; o ajuste não está mais disponível.')
    original = originals[0]
    if not _is_owner(original, actor):
        raise PermissionError('Você só pode excluir um ajuste criado por você.')
    title = f'EXCLUSAO-AJUSTE-{revision_id}'
    markers = [row for row in rows if row.get('Title') == title and not row.get('HORARIO_CORRIGIDO')]
    if markers:
        if len(markers) != 1 or not _is_owner(markers[0], actor):
            raise PermissionError('A exclusão não pertence ao responsável informado.')
        return {'deleted': True, 'revisionId': revision_id}
    current = latest_active_rows(rows)
    if len(current) != 1 or str(current[0].get('Id')) != revision_id:
        raise ValueError('Atualize o relatório; há uma revisão mais recente desse horário.')
    # A deterministic title makes a response-lost retry recover the same event.
    fields = {name: original.get(name) or '' for name in (
        'DATA_REFERENCIA', 'ID_PESSOA_RHID', 'NOME_COLABORADOR', 'CAMPO',
        'RESPONSAVEL', 'RHID_ORIGINAL', 'RHID_BRUTO_JSON')}
    fields.update(HORARIO_CORRIGIDO='', JUSTIFICATIVA=f'EXCLUSÃO DO AJUSTE {revision_id} PELO PRÓPRIO RESPONSÁVEL')
    marker_id = store.sharepoint.ensure_item(title, fields, store.LIST_TITLE, 'Title', False)
    if not re.fullmatch(r'[1-9]\d*', str(marker_id or '')):
        raise RuntimeError('O SharePoint não confirmou a exclusão do ajuste.')
    return {'deleted': True, 'revisionId': revision_id}


def delete_for_bridge(bridge, identity, selected_date, person_key, slot, revision_id, *, allowed_emails):
    raw_date = str(selected_date or '').strip()
    try:
        on_date = date.fromisoformat(raw_date)
    except (TypeError, ValueError) as error:
        raise ValueError('Data inválida para excluir o ajuste RHID.') from error
    if on_date.isoformat() != raw_date:
        raise ValueError('Data inválida para excluir o ajuste RHID.')
    now = datetime.now(ZoneInfo('America/Sao_Paulo'))
    if on_date > now.date() or (on_date == now.date() and (now.hour, now.minute) < (17, 15)):
        raise ValueError('O dia do relatório ainda não foi encerrado.')
    # Existing report path authorizes the account and its conversation first.
    report = bridge.portal_rhid_attendance_report(identity, raw_date, allowed_emails=allowed_emails)
    rows = report.get('attendanceReport', {}).get('rows', [])
    def key(row):
        rhid_id = str(row.get('ID_PESSOA_RHID') or '').strip()
        return f'rhid:{rhid_id}' if rhid_id else f"id:{row.get('Id', row.get('ID'))}"
    if not any(isinstance(row, dict) and key(row) == person_key for row in rows):
        raise ValueError('O colaborador não pertence ao relatório RHID dessa data.')
    with bridge.lock:
        deletion = remove_manual_adjustment(bridge.rhid_attendance_adjustments, on_date, person_key, slot, revision_id, identity)
    return {'status': 'processed', 'messages': [], 'attendanceAdjustmentDeletion': deletion}
