"""Provision accepted direct Swile orders and attach their issued documents."""

from datetime import datetime
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import sys
import unicodedata

from swile_recharges import DOCUMENT_FIELDS, SP, SwileError, cents, date_field, download_document, load_service, valid_order_code


PARENT = 'DESCRITIVOPROVISAO'
CHILD = 'PROVISÃO PGTOS'
OBS = 'VALE ALIMENTAÇÃO'
REGISTERING = 'EM CADASTRO'
SCHEDULED = 'PAGAMENTO PREVISTO'
REFUSED = {'DRAFT', 'CANCELED', 'CREATION_ERROR', 'PROCESSING_CANCEL'}


def name_key(value):
    return ' '.join(''.join(char for char in unicodedata.normalize('NFD', str(value or ''))
                           if not unicodedata.combining(char)).upper().split())


def money(amount):
    return f'{amount // 100},{amount % 100:02d}'


def build_plan(people, suppliers, code, due, submitted):
    branched = set()
    used = set()
    children, unresolved = [], []
    key = 'swile:' + hashlib.sha256(code.encode()).hexdigest()
    common = {'Title': OBS, 'OBS': OBS, 'FORMAPGTO': '', 'STATUS': REGISTERING,
              'DATAPREVISTOPGTO': f'{date_field(due).isoformat()}T03:00:00Z'}
    for person in people:
        exact = [row for row in suppliers
                 if re.sub(r'\D', '', str(row.get('DOCUMENTOFORNECEDOR') or '')) == person['document']]
        if not exact:
            by_name = [row for row in suppliers if name_key(row.get('Title')) == name_key(person['name'])]
            if len(by_name) == 1 and not str(by_name[0].get('DOCUMENTOFORNECEDOR') or '').strip():
                exact = by_name
        supplier = exact[0] if len(exact) == 1 else {}
        ident = supplier.get('Id')
        branch, product, name = [str(supplier.get(field) or '').strip() for field in ('FILIAL','PROFISSAO','Title')]
        if type(ident) is not int or ident < 1 or ident in used or not all((branch, product, name)):
            unresolved.append(person['name'])
            continue
        used.add(ident)
        branched.add(branch)
        children.append({**common, 'FOLHAOPERACAO': f'{key}:{ident}', 'FORNECEDOR': name, 'FILIAL': branch,
                         'PRODUTO': product, 'IMOVEL': 'TODOS', 'QTD': '1', 'VALORTOTAL': money(person['amountCents']),
                         'DATA': f'{submitted.isoformat()}T03:00:00Z'})
    if unresolved:
        raise SwileError('Confira fornecedor, documento, profissão e filial de: ' + ', '.join(unresolved))
    if not children:
        raise SwileError('A recarga não possui colaboradores confirmados.')
    return {'parent': {**common, 'FOLHAOPERACAO': key, 'FORNECEDOR': 'SWILE',
                       'FILIAL': next(iter(branched)) if len(branched) == 1 else 'DIVERSOS',
                       'VALORTOTAL': money(sum(person['amountCents'] for person in people))},
            'children': children, 'documents': []}


def queue_provision(service, owner, reference):
    if not isinstance(reference, str) or not re.fullmatch(r'[a-f0-9]{32}', reference):
        raise SwileError('Referência do pedido Swile inválida.')
    if service.database.name == 'staging-orders.sqlite':
        raise SwileError('O cadastro de provisões está disponível somente no ambiente da empresa.')
    with service.db() as db:
        db.execute('BEGIN IMMEDIATE')
        order = db.execute('SELECT * FROM orders WHERE id=? AND owner=?', (reference, owner)).fetchone()
        if (not order or order['state'] != 'created' or order['status'] in REFUSED
                or not valid_order_code(order['code']) or not json.loads(order['payload']).get('provisionPeople')):
            raise SwileError('A recarga direta ainda não está confirmada para cadastrar a provisão.', 409)
        db.execute("""INSERT OR IGNORE INTO swile_provisions(reference,state,next_try)
                      VALUES (?, 'queued', ?)""", (reference, service.clock()))
        return dict(db.execute('SELECT reference,state,parent,error FROM swile_provisions WHERE reference=?',
                               (reference,)).fetchone())


def sync_documents(store, parent, group, payment, uploaded, fetch=download_document):
    orders = group['orderList']
    codes = [item.get('code') for item in orders]
    if not codes or not all(map(valid_order_code, codes)) or len(set(codes)) != len(codes):
        return False
    complete = True
    for order in orders:
        for kind in ('boleto', 'invoice') if payment == 'BANK_SLIP' else ('invoice',):
            field, label = DOCUMENT_FIELDS[kind]
            name = f"{label} Swile {order['code']}.pdf"
            if name in uploaded:
                continue
            if not order.get(field):
                complete = False
                continue
            store.attach(parent, name, fetch(kind, order[field]))
            uploaded.add(name)
    return complete


class Store:
    def __init__(self, client, api):
        self.client, self.api = client, api

    def suppliers(self):
        return self.api.collection(self.client._list_endpoint('FORNECEDORES') + '/items',
                                   {'$select': 'Id,Title,DOCUMENTOFORNECEDOR,FILIAL,PROFISSAO', '$top': '5000'})

    def verify_keys(self):
        for target in (PARENT, CHILD):
            field = self.client._request('GET', self.client._list_endpoint(target)
                                         + "/fields/getbyinternalnameortitle('FOLHAOPERACAO')",
                                         params={'$select': 'InternalName,EnforceUniqueValues,Indexed'})
            if field.get('InternalName') != 'FOLHAOPERACAO' or not field.get('EnforceUniqueValues') or not field.get('Indexed'):
                raise RuntimeError('A chave única de provisões não foi confirmada no SharePoint.')

    def verify_parent(self, parent, marker):
        fields = self.client.get_item_fields(parent, ['FOLHAOPERACAO'], target_list=PARENT)
        if fields['FOLHAOPERACAO'] != marker:
            raise RuntimeError('Origem do descritivo Swile mudou.')

    def ensure(self, target, fields):
        endpoint = self.client._list_endpoint(target) + '/items'
        key = fields['FOLHAOPERACAO']

        def find():
            return self.api.collection(endpoint, {'$filter': f"FOLHAOPERACAO eq '{key}'",
                                                  '$select': ','.join(['Id', *fields]), '$top': '2'})

        rows = find()
        if not rows:
            try:
                self.client._request('POST', endpoint, json=fields,
                                     headers={'Content-Type': 'application/json;odata=nometadata'})
            except OSError:
                rows = find()
                if not rows:
                    raise
            else:
                rows = find()
        if len(rows) != 1 or type(rows[0].get('Id')) is not int:
            raise RuntimeError('Registro SharePoint da recarga não foi confirmado.')
        actual = rows[0]
        for field, expected in fields.items():
            if field == 'STATUS':
                continue
            value = str(actual.get(field) or '')
            if field in ('DATA', 'DATAPREVISTOPGTO'):
                value, expected = value[:10], expected[:10]
            if value != expected:
                raise RuntimeError('Registro SharePoint da recarga diverge do cadastro original.')
        return actual['Id']

    def finish(self, target, ident):
        fields, etag = self.client.get_item_fields_with_etag(ident, ['STATUS'], target_list=target)
        if fields['STATUS'] == REGISTERING:
            self.client.update_item_with_etag(ident, {'STATUS': SCHEDULED}, etag, target_list=target)
        elif fields['STATUS'] != SCHEDULED:
            raise RuntimeError('A situação da provisão mudou durante o cadastro.')

    def attach(self, parent, name, data):
        self.client._ensure_attachment_local(parent, name, data, 'application/pdf', target_list=PARENT)
        if self.api.digest(PARENT, parent, name) != hashlib.sha256(data).hexdigest():
            raise RuntimeError('A cópia do PDF da Swile não foi confirmada.')


def process_provisions(service, store):
    now = service.clock()
    with service.db() as db:
        jobs = db.execute("""SELECT p.*, o.code, o.payload, o.created
                             FROM swile_provisions p JOIN orders o ON o.id=p.reference
                             WHERE p.state NOT IN ('done','stopped') AND next_try<=?
                             ORDER BY next_try LIMIT 8""", (now,)).fetchall()
    for job in jobs:
        ref, parent = job['reference'], job['parent']
        plan = json.loads(job['plan']) if job['plan'] else None
        try:
            order = service.corporate_group(job['code'])
            if order.get('statusCode') in {'CANCELED', 'CREATION_ERROR'}:
                state, error = 'stopped', 'O pedido Swile foi cancelado ou recusado.'
            elif not order.get('statusCode') or order['statusCode'] in REFUSED:
                state, error = 'retry', 'Aguardando confirmação da situação do pedido na Swile.'
            else:
                saved = json.loads(job['payload'])
                if not plan:
                    submitted = datetime.fromtimestamp(job['created'], SP).date()
                    plan = build_plan(saved['provisionPeople'], store.suppliers(), job['code'], saved['dueDate'], submitted)
                    with service.db() as db:
                        db.execute('UPDATE swile_provisions SET plan=? WHERE reference=?', (json.dumps(plan), ref))
                if not parent:
                    store.verify_keys()
                    new_parent = store.ensure(PARENT, plan['parent'])
                    children = [store.ensure(CHILD, {**fields, 'DESCRITIVOPROVISAO': str(new_parent)})
                                for fields in plan['children']]
                    for child in children:
                        store.finish(CHILD, child)
                    store.finish(PARENT, new_parent)
                    parent = new_parent
                    with service.db() as db:
                        db.execute('UPDATE swile_provisions SET parent=? WHERE reference=?', (parent, ref))
                store.verify_parent(parent, plan['parent']['FOLHAOPERACAO'])
                uploaded = set(plan['documents'])
                expected = sum(person['amountCents'] for person in saved['provisionPeople'])
                complete = sum(cents(item.get('totalValue')) for item in order['orderList']) == expected
                complete = complete and sync_documents(store, parent, order, saved['paymentMethod'], uploaded)
                plan['documents'] = sorted(uploaded)
                state, error = ('done' if complete else 'documents'), None
        except SwileError as cause:
            state, error = 'retry', str(cause)
        except (OSError, ValueError, RuntimeError, KeyError, TypeError):
            state, error = 'retry', 'Falha ao confirmar o registro ou os PDFs. Nova tentativa agendada.'
            logging.exception('Falha na provisão Swile %s', ref)
        with service.db() as db:
            db.execute('UPDATE swile_provisions SET state=?,plan=?,parent=?,next_try=?,error=? WHERE reference=?',
                       (state, json.dumps(plan) if plan else None, parent, service.clock() + 600, error, ref))
        logging.info('Provisão Swile %s: %s', ref, state)


def main():
    logging.basicConfig(level=logging.INFO)
    service, _ = load_service()
    if service.database.name == 'staging-orders.sqlite':
        return
    with service.db() as db:
        if not db.execute("""SELECT 1 FROM swile_provisions WHERE state NOT IN ('done','stopped')
                             AND next_try<=? LIMIT 1""", (service.clock(),)).fetchone():
            return
    sys.path.insert(0, str(Path(__file__).resolve().parent / 'worker'))
    from local_app import load_env
    from clients import SharePointClient
    from provision_attachment_sync import SharePointStore

    load_env(Path('/etc/energetica-whatsapp.env'))
    client = SharePointClient(os.environ['SHAREPOINT_HOST'], os.environ['SHAREPOINT_SITE_PATH'],
                              os.environ['ENTRA_TENANT_ID'], os.environ['ENTRA_CLIENT_ID'],
                              Path(os.environ['ENTRA_PRIVATE_KEY_FILE']).read_text(),
                              Path(os.environ['ENTRA_CERTIFICATE_FILE']).read_text(), CHILD)
    process_provisions(service, Store(client, SharePointStore(client)))


if __name__ == '__main__':
    main()
