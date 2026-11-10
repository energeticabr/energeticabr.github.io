"""Add a display-only product summary with observations from linked provisions."""
RELATIVE = 'worker/provision_description_settlement.py'

SNAPSHOT = 'def group_snapshot(groups, today):'
PRODUCT_HELPER = """def _snapshot_product_display(children):
    values = []
    has_observation = False
    for child in children:
        product = _text(child.get('PRODUTO'))
        observation = _text(child.get('OBS'))
        if observation:
            values.append(f'{product or "—"} ({observation})')
            has_observation = True
        elif product:
            values.append(product)
    return {'productDisplay': ' / '.join(dict.fromkeys(values))} if has_observation else {}


"""
ROW = """            'product': _joined(children, 'PRODUTO'), 'childCount': len(children),"""


def patch(relative, data):
    if relative != RELATIVE:
        raise RuntimeError('Unexpected source scope')
    text = data.decode('utf-8')
    newline = '\r\n' if '\r\n' in text else '\n'
    if newline == '\r\n' and text.count('\n') != text.count('\r\n'):
        raise RuntimeError('Mixed source newlines require review')
    text = text.replace('\r\n', '\n')
    for before, after in (
        (SNAPSHOT, PRODUCT_HELPER + SNAPSHOT),
        (ROW, ROW + '\n            **_snapshot_product_display(children),'),
    ):
        if text.count(before) != 1:
            raise RuntimeError('Expected source anchor exactly once')
        text = text.replace(before, after, 1)
    compile(text, relative, 'exec')
    return text.replace('\n', newline).encode('utf-8')
