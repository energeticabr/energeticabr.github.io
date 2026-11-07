"""Add a read-only subtotal to the provision snapshot without changing its total."""
RELATIVE = 'worker/provision_description_settlement.py'
ANCHOR = """        children = group.get('CHILDREN') or []
        rows.append({
            'id': _identity(group['Id']), 'sourceKind': SOURCE_KIND,
"""
REPLACEMENT = """        children = group.get('CHILDREN') or []
        pending_ids = list(group.get('PENDING CHILD IDS') or [])
        amount_due = {}
        if len(children) > 1 and not group.get('settlementBlocked'):
            pending = set(pending_ids)
            dates = [(child, _date(child.get('DATA PREVISTO PGTO')))
                     for child in children if str(child['Id']) in pending]
            due_lines = [child for child, child_due in dates if child_due == due]
            if not due_lines or any(child_due is None for _, child_due in dates):
                amount_due['amountDueDisplay'] = None
            elif len(due_lines) < len(children):
                totals = (provision_line_total({
                    **child, 'FRETE': child.get('FRETE') if _text(child.get('FRETE')) else '0',
                }) for child in due_lines)
                amount_due['amountDueDisplay'] = _currency(_sum(totals))
        rows.append({
            **amount_due,
            'id': _identity(group['Id']), 'sourceKind': SOURCE_KIND,
"""


def patch(relative, data):
    if relative != RELATIVE:
        raise RuntimeError('Unexpected source scope')
    text = data.decode('utf-8')
    newline = '\r\n' if '\r\n' in text else '\n'
    if newline == '\r\n' and text.count('\n') != text.count('\r\n'):
        raise RuntimeError('Mixed source newlines require review')
    text = text.replace('\r\n', '\n')
    for before, after in (
        (ANCHOR, REPLACEMENT),
        ("'pendingChildIds': list(group.get('PENDING CHILD IDS') or []),", "'pendingChildIds': pending_ids,"),
    ):
        if text.count(before) != 1:
            raise RuntimeError('Expected source anchor exactly once')
        text = text.replace(before, after, 1)
    compile(text, relative, 'exec')
    return text.replace('\n', newline).encode('utf-8')
