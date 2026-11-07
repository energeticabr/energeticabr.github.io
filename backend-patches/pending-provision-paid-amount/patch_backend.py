"""Add the confirmed paid amount to partial, multi-date provision snapshots."""
RELATIVE = 'worker/provision_description_settlement.py'

SNAPSHOT = 'def group_snapshot(groups, today):'
AMOUNT_HELPER = """def _snapshot_amount(children):
    totals = (provision_line_total({
        **child, 'FRETE': child.get('FRETE') if _text(child.get('FRETE')) else '0',
    }) for child in children)
    return _currency(_sum(totals))


"""
SUBTOTAL = """                totals = (provision_line_total({
                    **child, 'FRETE': child.get('FRETE') if _text(child.get('FRETE')) else '0',
                }) for child in due_lines)
                amount_due['amountDueDisplay'] = _currency(_sum(totals))"""
AMOUNTS = """                amounts['amountDueDisplay'] = _snapshot_amount(due_lines)
                scheduled_dates = {_date(child.get('DATA PREVISTO PGTO')) for child in children}
                if scheduled_dates - {None, due}:
                    paid_lines = [child for child in children if _paid(child)]
                    if paid_lines:
                        amounts['amountPaidDisplay'] = _snapshot_amount(paid_lines)"""


def patch(relative, data):
    if relative != RELATIVE:
        raise RuntimeError('Unexpected source scope')
    text = data.decode('utf-8')
    newline = '\r\n' if '\r\n' in text else '\n'
    if newline == '\r\n' and text.count('\n') != text.count('\r\n'):
        raise RuntimeError('Mixed source newlines require review')
    text = text.replace('\r\n', '\n')
    for before, after in (
        (SNAPSHOT, AMOUNT_HELPER + SNAPSHOT),
        (SUBTOTAL, AMOUNTS),
        ('        amount_due = {}', '        amounts = {}'),
        ("                amount_due['amountDueDisplay'] = None", "                amounts['amountDueDisplay'] = None"),
        ('            **amount_due,', '            **amounts,'),
    ):
        if text.count(before) != 1:
            raise RuntimeError('Expected source anchor exactly once')
        text = text.replace(before, after, 1)
    compile(text, relative, 'exec')
    return text.replace('\n', newline).encode('utf-8')
