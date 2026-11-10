def replace_once(source, old, new):
    if source.count(old) != 1:
        raise RuntimeError(f"Expected one matching code block: {old!r}")
    return source.replace(old, new, 1)


def update_fanout(source):
    source = replace_once(source, 'try:\n    from .provision_attachment_sync', '''from datetime import datetime
import re
from zoneinfo import ZoneInfo

try:
    from .provision_attachment_sync''')
    source = replace_once(source, "def copy_launch_to_payroll", '''def _payment_day(value):
    try:
        parsed = datetime.fromisoformat(_text(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(ZoneInfo('America/Sao_Paulo'))
    return parsed.date()


def paid_status_refreshed(before, before_version, after, after_version):
    """Recognize the automatic status/date refresh of an already-paid row."""
    if (before.get('PGTOAGENDADO') != 'PAGO'
            or before.get('STATUS') != 'PAGAMENTO PREVISTO'
            or after.get('STATUS') != 'PAGAMENTO EFETUADO'):
        return False
    # A larger version jump could include a second writer outside this snapshot.
    version = re.fullmatch(r'"([a-fA-F0-9-]+),([0-9]+)"', before_version)
    if version is None or after_version != f'"{version[1]},{int(version[2]) + 1}"':
        return False
    date_field = 'DATA PGTO EFETUADO'
    day = _payment_day(before.get(date_field))
    if day is None or day != _payment_day(after.get(date_field)):
        return False
    payment_display = {'STATUS', date_field}
    return ({key: value for key, value in before.items() if key not in payment_display}
            == {key: value for key, value in after.items() if key not in payment_display})


def copy_launch_to_payroll''')
    source = replace_once(source, 'def propagate(client, child, expected, record, parent=None):',
                          'def propagate(client, child, expected, record, parent=None, *, paid_source_fields=()):')
    source = replace_once(source, '    links. On journal recovery it contains the already-paid expected links.\n',
                          '''    links. On journal recovery it contains the already-paid expected links.
    A verified group row can supply its complete field snapshot so an automatic
    status refresh can be distinguished from a change to the payment itself.
''')
    source = replace_once(source, "    source_fields = ['FORNECEDOR', 'FILIAL', 'IDPEDIDO', 'IDLANCAMENTOS', 'DESCRITIVOPROVISAO']",
                          '''    source_fields = paid_source_fields or (
        'FORNECEDOR', 'FILIAL', 'IDPEDIDO', 'IDLANCAMENTOS', 'DESCRITIVOPROVISAO')
'''.rstrip())
    source = replace_once(source, '    def guard():\n        if parent_owner is not None:',
                          '    def guard():\n        nonlocal source, version\n        if parent_owner is not None:')
    return replace_once(source, '''        if current != source or current_version != version:
            raise RuntimeError('Provisão alterada durante a cópia de anexos.')''', '''        if current != source or current_version != version:
            if not paid_source_fields or not paid_status_refreshed(source, version, current, current_version):
                raise RuntimeError('Provisão alterada durante a cópia de anexos.')
            source, version = current, current_version''')


def update_settlement(source):
    for prefix in ('.', ''):
        source = replace_once(source, f'    from {prefix}payroll_row_attachments import propagate as propagate_payroll_row_attachments',
                              f'''    from {prefix}payroll_row_attachments import paid_status_refreshed
    from {prefix}payroll_row_attachments import propagate as propagate_payroll_row_attachments''')
    source = replace_once(source, """        selected = {int(row['Id']): row for row in group['children']}
        carrier = min(selected)""", """        selected = {int(row['Id']): row for row in group['children']}
        paid_children = (group.get('journal') or {}).get('children') or {}
        carrier = min(selected)""")
    source = replace_once(source,
                         "                live, _ = self.sharepoint.get_item_fields_with_etag(ident, CHILD_FIELDS, target_list=CHILD_LIST)\n"
                         "                if (_identity",
                         "                live, child_version = self.sharepoint.get_item_fields_with_etag(ident, CHILD_FIELDS, target_list=CHILD_LIST)\n"
                         "                if (_identity")
    source = replace_once(source, '                rows[ident] = live\n',
                         '                rows[ident] = (live, child_version)\n')
    source = replace_once(source, """                for ident, expected in rows.items():
                    live, _ = self.sharepoint.get_item_fields_with_etag(ident, CHILD_FIELDS, target_list=CHILD_LIST)
                    if live != expected:
                        raise RuntimeError('Uma provisão selecionada mudou durante a cópia dos anexos.')""",
                         """                for ident, (expected, expected_version) in rows.items():
                    live, current_version = self.sharepoint.get_item_fields_with_etag(ident, CHILD_FIELDS, target_list=CHILD_LIST)
                    if live != expected:
                        if str(ident) not in paid_children or not paid_status_refreshed(
                                expected, expected_version, live, current_version):
                            raise RuntimeError('Uma provisão selecionada mudou durante a cópia dos anexos.')
                        rows[ident] = (live, current_version)""")
    source = replace_once(source, "        saved = ((group.get('journal') or {}).get('children') or {}).get(str(carrier))",
                         "        saved = paid_children.get(str(carrier))")
    source = replace_once(source, "{**entry['fields'], **saved['expected_fields']}, saved, parent=group['parent_id'])",
                         "{**entry['fields'], **saved['expected_fields']}, saved, parent=group['parent_id'],\n                paid_source_fields=CHILD_FIELDS)")
    return replace_once(source, "{**entries[item_id]['fields'], **saved['expected_fields']}, saved,\n                            parent=group['parent_id'])",
                         "{**entries[item_id]['fields'], **saved['expected_fields']}, saved,\n                            parent=group['parent_id'], paid_source_fields=CHILD_FIELDS)")
