"""Prepare and register a verified Trancid order as one payment provision."""

from datetime import date
from difflib import get_close_matches
import json
import os
from pathlib import Path
import re
import sys

from trancid_portal_adapter import ORDER_CODE, format_amount, normalize
from trancid_recharges import GatewayError, PAYMENT_METHOD


PARENT = 'DESCRITIVOPROVISAO'
CHILD = 'PROVISÃO PGTOS'
SUPPORTED_STATUSES = {'ENVIADO', 'AGUARDANDO PAGAMENTO', 'PAGO', 'FINALIZADO'}


def load_store():
    worker = str(Path(__file__).resolve().parent / 'worker')
    if worker not in sys.path:
        sys.path.insert(0, worker)
    from clients import SharePointClient
    from local_app import load_env
    from provision_attachment_sync import SharePointStore
    from swile_provisions import Store

    load_env(Path('/etc/energetica-whatsapp.env'))
    client = SharePointClient(
        os.environ['SHAREPOINT_HOST'], os.environ['SHAREPOINT_SITE_PATH'],
        os.environ['ENTRA_TENANT_ID'], os.environ['ENTRA_CLIENT_ID'],
        Path(os.environ['ENTRA_PRIVATE_KEY_FILE']).read_text(),
        Path(os.environ['ENTRA_CERTIFICATE_FILE']).read_text(), CHILD,
    )
    return Store(client, SharePointStore(client))


def confirmed_order(db, owner, identifier):
    if not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9_-]{32}', identifier):
        raise GatewayError('Referência do pedido Trancid inválida.')
    order = db.execute("SELECT * FROM orders WHERE id=? AND owner=? AND state='submitted'",
                       (identifier, owner)).fetchone()
    receipt = json.loads(order['receipt'] or '{}') if order else {}
    code = receipt.get('orderCode')
    if receipt.get('status') != 'SUBMITTED' or not isinstance(code, str) or not re.fullmatch(ORDER_CODE, code):
        raise GatewayError('Pedido confirmado da Trancid não encontrado para este usuário.', 404)
    return order, code


def checked_order(portal, code, credit):
    live = portal.order(code)
    if (live.get('paymentMethod') != PAYMENT_METHOD or live.get('creditCents') != credit
            or normalize(live.get('status', '')) not in SUPPORTED_STATUSES):
        raise GatewayError('A situação ou o valor do pedido mudou na Trancid. Confira a galeria.', 409)
    return live


def source_from_portal(service, order, code):
    with service.portal() as portal:
        live = checked_order(portal, code, order['credit'])
        due, total = portal.order_boleto_terms(code)
        report = portal.order_details(code, include_card_ids=True)
    expected = {card['id']: card['amountCents'] for card in json.loads(order['items'])}
    if ({card['id']: card['amountCents'] for card in report} != expected
            or total < order['credit'] or len(report) != len(expected)):
        raise GatewayError('O boleto e os cartões não conferem com o pedido confirmado na Trancid.', 409)
    return {'boletoDueDate': due, 'totalCents': total, 'requestDate': live['requestDate'],
            'cards': [{**service.public_card(card, service.public_id(card['id'])), 'amountCents': card['amountCents']}
                      for card in report]}


def supplier_choices(source, store):
    def key(value):
        return ' '.join(normalize(value).split())

    suppliers = []
    for entry in store.suppliers():
        name, branch, product = [str(entry.get(field) or '').strip() for field in ('Title', 'FILIAL', 'PROFISSAO')]
        if type(entry.get('Id')) is int and entry['Id'] > 0 and all((name, branch, product)):
            suppliers.append({'id': entry['Id'], 'name': name, 'branch': branch, 'product': product})
    suppliers.sort(key=lambda supplier: (key(supplier['name']), supplier['id']))
    by_name = {}
    for supplier in suppliers:
        by_name.setdefault(key(supplier['name']), []).append(supplier['id'])
    cards = []
    for card in source['cards']:
        name = key(card['name'])
        matches = by_name.get(name, [])
        if len(matches) == 1:
            cards.append({**card, 'supplierId': matches[0]})
        else:
            similar = get_close_matches(name, by_name, n=3, cutoff=0.68)
            cards.append({**card, 'supplierId': None,
                          'suggestedIds': [ident for candidate in similar for ident in by_name[candidate]]})
    return cards, suppliers


def result(row, source, code):
    plan = json.loads(row['plan'])
    return {'orderCode': code, 'dueDate': plan['dueDate'], 'totalCents': source['totalCents'],
            'lineCount': len(plan['children']), 'parentId': row['parent_id'], 'locked': True}


def prepare(service, owner, identifier, store=None):
    with service.connect() as db:
        order, code = confirmed_order(db, owner, identifier)
        saved = db.execute('SELECT * FROM trancid_provisions WHERE order_code=?', (code,)).fetchone()
    if not saved:
        source = source_from_portal(service, order, code)
        with service.connect() as db:
            db.execute('INSERT OR IGNORE INTO trancid_provisions(order_code, source) VALUES (?, ?)',
                       (code, json.dumps(source)))
            saved = db.execute('SELECT * FROM trancid_provisions WHERE order_code=?', (code,)).fetchone()
    source = json.loads(saved['source'])
    if saved['plan']:
        return result(saved, source, code)
    cards, suppliers = supplier_choices(source, store or load_store())
    return {'orderCode': code, 'dueDate': source['boletoDueDate'], 'totalCents': source['totalCents'],
            'locked': False, 'cards': cards,
            'suppliers': suppliers if any(card['supplierId'] is None for card in cards) else []}


def build_plan(source, code, due, selection, store):
    cards, suppliers = supplier_choices(source, store)
    available = {supplier['id']: supplier for supplier in suppliers}
    unresolved = {card['id'] for card in cards if card['supplierId'] is None}
    if set(selection) != unresolved or any(type(ident) is not int or ident not in available
                                           for ident in selection.values()):
        raise GatewayError('Selecione um fornecedor cadastrado para cada cartão sem vínculo confirmado.')
    grouped = {}
    for card in cards:
        supplier_id = card['supplierId'] or selection[card['id']]
        grouped[supplier_id] = grouped.get(supplier_id, 0) + card['amountCents']
    credits = sum(grouped.values())
    total = source['totalCents']
    rounded = {ident: divmod(total * amount, credits) for ident, amount in grouped.items()}
    unallocated = total - sum(amount for amount, _ in rounded.values())
    # Allocate the boleto fee proportionally, giving residual cents to the largest remainders.
    extra = set(sorted(rounded, key=lambda ident: (-rounded[ident][1], ident))[:unallocated])

    marker = f'trancid:{code}'
    common = {'Title': 'VALE TRANSPORTE', 'OBS': 'VALE TRANSPORTE', 'FORMAPGTO': '',
              'STATUS': 'EM CADASTRO', 'DATAPREVISTOPGTO': due + 'T03:00:00Z'}
    branches = {available[ident]['branch'] for ident in grouped}
    children = []
    for ident in sorted(grouped):
        supplier = available[ident]
        children.append({**common, 'FOLHAOPERACAO': f'{marker}:{ident}', 'FORNECEDOR': supplier['name'],
                         'FILIAL': supplier['branch'], 'PRODUTO': supplier['product'], 'IMOVEL': 'TODOS',
                         'QTD': '1', 'VALORTOTAL': format_amount(rounded[ident][0] + (ident in extra)),
                         'DATA': source['requestDate'] + 'T03:00:00Z'})
    return {'dueDate': due, 'parent': {**common, 'FOLHAOPERACAO': marker, 'FORNECEDOR': 'TRANCID',
            'FILIAL': next(iter(branches)) if len(branches) == 1 else 'DIVERSOS', 'VALORTOTAL': format_amount(total)},
            'children': children}


def register(service, owner, identifier, due, selection, store=None):
    try:
        if not isinstance(due, str) or date.fromisoformat(due).isoformat() != due:
            raise ValueError()
    except ValueError:
        raise GatewayError('Informe uma data de vencimento válida.') from None
    if not isinstance(selection, dict):
        raise GatewayError('Confira os fornecedores da provisão.')
    with service.connect() as db:
        order, code = confirmed_order(db, owner, identifier)
        saved = db.execute('SELECT * FROM trancid_provisions WHERE order_code=?', (code,)).fetchone()
    if not saved:
        raise GatewayError('Abra a conferência do descritivo antes de cadastrar.', 409)
    source = json.loads(saved['source'])
    if saved['parent_id']:
        return result(saved, source, code)
    store = store or load_store()
    store.verify_keys()
    if not saved['plan']:
        candidate = build_plan(source, code, due, selection, store)
        with service.portal() as portal:
            checked_order(portal, code, order['credit'])
        with service.connect() as db:
            db.execute('UPDATE trancid_provisions SET plan=? WHERE order_code=? AND plan IS NULL',
                       (json.dumps(candidate), code))
            saved = db.execute('SELECT * FROM trancid_provisions WHERE order_code=?', (code,)).fetchone()
        if saved['parent_id']:
            return result(saved, source, code)
        if json.loads(saved['plan']) != candidate:
            raise GatewayError('O cadastro já foi iniciado com outros dados. Abra a conferência novamente.', 409)
    plan = json.loads(saved['plan'])
    if plan['dueDate'] != due:
        raise GatewayError('O cadastro já foi iniciado com outro vencimento. Abra a conferência novamente.', 409)
    parent_id = store.ensure(PARENT, plan['parent'])
    children = [store.ensure(CHILD, {**child, 'DESCRITIVOPROVISAO': str(parent_id)}) for child in plan['children']]
    for child_id in children:
        store.finish(CHILD, child_id)
    store.finish(PARENT, parent_id)
    with service.connect() as db:
        db.execute('UPDATE trancid_provisions SET parent_id=? WHERE order_code=?', (parent_id, code))
        saved = db.execute('SELECT * FROM trancid_provisions WHERE order_code=?', (code,)).fetchone()
    return result(saved, source, code)
