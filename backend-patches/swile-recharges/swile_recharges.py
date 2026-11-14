"""Authenticated Energético integration with the Swile Corporate Gateway."""

import base64
from contextlib import closing, contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from threading import Lock
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import uuid4


CONFIG = Path('/etc/energetica-swile.json')
DATABASE = Path('/var/lib/energetica-whatsapp/swile/orders.sqlite')
WALLET = 'v13'
PREVIEW_TTL = 15 * 60
BLOCKING_ORDER = """(state='sending' OR
                     (state='created' AND COALESCE(status, '') NOT IN ('CANCELED', 'CREATION_ERROR')))"""
ORIGINS = {
    'production': 'https://corporate-gateway.swile.com.br',
    'staging': 'https://corporate-gateway-staging.swile.com.br',
}
SP = timezone(timedelta(hours=-3))
CLOSED_ORDER_STATUSES = frozenset({'DRAFT', 'APPROVED', 'CANCELED', 'CREATION_ERROR'})
MIXED_CREDIT_STATUSES = frozenset({'PROCESSING', 'APPROVED_PARTIALLY', 'PROCESSED_ERROR', 'PROCESSING_CANCEL'})
DOCUMENT_FIELDS = {'boleto': ('slipLink', 'Boleto'), 'invoice': ('invoiceLink', 'Nota fiscal')}
MAX_DOCUMENT_BYTES = 8 * 1024 * 1024


class SwileError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Gateway:
    def __init__(self, config):
        self.base = ORIGINS[config['environment']] + '/api/v1/'
        pair = f"{config['username']}:{config['password']}".encode()
        self.basic = 'Basic ' + base64.b64encode(pair).decode()
        self.opener = build_opener(NoRedirect())
        self.lock = Lock()
        self.token = None
        self.expires = 0

    def http(self, path, authorization, data=None, query=None):
        url = self.base + path
        if query:
            url += '?' + urlencode(query)
        headers = {'Authorization': authorization, 'Accept': 'application/json'}
        if data is not None:
            headers['Content-Type'] = 'application/json'
        try:
            with self.opener.open(Request(url, headers=headers,
                                  data=json.dumps(data).encode() if data is not None else None), timeout=12) as response:
                payload = json.loads(response.read(12 * 1024 * 1024), parse_float=Decimal)
                if isinstance(payload, dict):
                    return payload
        except HTTPError as error:
            status = error.code
            error.close()
            if status == 401:
                raise SwileError('A Swile recusou a autenticação da integração.', 401) from None
            if status == 400 or status == 422:
                raise SwileError('A Swile recusou os dados do pedido. Confira os cadastros, valores e datas.', 422) from None
            if status == 429:
                raise SwileError('A Swile está limitando as consultas. Tente novamente mais tarde.', 429) from None
            if status == 403:
                raise SwileError('A Swile não liberou essa operação para a integração.', 403) from None
        except (URLError, OSError, ValueError):
            pass
        raise SwileError('A Swile não respondeu com um resultado válido.', 502)

    def authorization(self):
        with self.lock:
            if time.monotonic() >= self.expires:
                auth = self.http('auth/login', self.basic)
                if not isinstance(auth.get('token'), str) or not auth['token']:
                    raise SwileError('A Swile não devolveu o token da integração.', 502)
                self.token = 'Bearer ' + auth['token']
                self.expires = time.monotonic() + 110 * 60
            return self.token

    def request(self, path, *, data=None, query=None):
        auth = self.authorization()
        try:
            return self.http(path, auth, data, query)
        except SwileError as error:
            if error.status != 401:
                raise
            with self.lock:
                if self.token == auth:
                    self.expires = 0
            return self.http(path, self.authorization(), data, query)


def cents(value):
    try:
        result = Decimal(str(value)) * 100
        if result.is_finite() and 0 <= result <= 10**13 and result == result.to_integral_value():
            return int(result)
    except (InvalidOperation, ValueError):
        pass
    raise SwileError('A Swile devolveu um total inválido.', 502)


def date_field(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
        raise SwileError('Informe uma data válida para o pedido.')
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise SwileError('Informe uma data válida para o pedido.') from None


def valid_order_code(code):
    return isinstance(code, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,100}', code) is not None


def document_url(kind, value):
    if not isinstance(value, str) or not 0 < len(value) <= 2048 or re.search(r'[\s\\\x00-\x1f\x7f]', value):
        return None
    try:
        link = urlsplit(value)
    except ValueError:
        return None
    if link.scheme != 'https' or link.fragment:
        return None
    if kind == 'boleto':
        if (link.netloc == 'dash-rh.swile.com.br' and not link.query
                and re.fullmatch(r'/boleto/[A-Za-z0-9_-]+', link.path)):
            return value
    elif (kind == 'invoice' and link.netloc == 'nfe.prefeitura.sp.gov.br'
          and link.path.lower() in ('/contribuinte/notaprint.aspx', '/contribuinte/notaprintpdf.aspx')):
        query = parse_qs(link.query, keep_blank_values=True)
        if set(query) == {'inscricao', 'nf', 'verificacao'} and all(len(values) == 1 and values[0] for values in query.values()):
            # The official invoice page embeds this PDF with the same verification parameters.
            return urlunsplit(link._replace(path='/contribuinte/notaprintpdf.aspx'))
    return None


def download_document(kind, link):
    url = document_url(kind, link)
    if not url:
        raise SwileError('Documento indisponível para este pedido.', 404)
    try:
        with build_opener(NoRedirect()).open(Request(url, headers={'Accept': 'application/pdf'}), timeout=12) as response:
            if response.headers.get_content_type() == 'application/pdf':
                data = response.read(MAX_DOCUMENT_BYTES + 1)
                if len(data) <= MAX_DOCUMENT_BYTES and data.startswith(b'%PDF-'):
                    return data
    except HTTPError as error:
        error.close()
    except (URLError, OSError, ValueError):
        pass
    raise SwileError('Não foi possível baixar o PDF na origem. Tente novamente.', 502)


def scheduled_date(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        if len(value) == 10:
            return date.fromisoformat(value).isoformat()
        timestamp = datetime.fromisoformat(value)
    except ValueError:
        return None
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    return timestamp.astimezone(SP).date().isoformat()


def request_dates(body, now):
    credit = date_field(body.get('creditDate'))
    payment = body.get('paymentMethod')
    if payment not in ('PIX', 'BANK_SLIP'):
        raise SwileError('Selecione Pix ou boleto.')
    today = datetime.fromtimestamp(now, SP).date()
    earliest = datetime.fromtimestamp(now, timezone.utc).date()
    for _ in range(1 if payment == 'PIX' else 2):
        earliest += timedelta(days=1)
        while earliest.weekday() >= 5:
            earliest += timedelta(days=1)
    if credit < earliest:
        raise SwileError(f'A data de crédito deve ser a partir de {earliest:%d/%m/%Y} para essa forma de pagamento.')
    result = {'creditDate': credit.isoformat(), 'paymentMethod': payment}
    if payment == 'BANK_SLIP':
        due = date_field(body.get('dueDate'))
        if not today <= due < credit:
            raise SwileError('O boleto deve vencer antes da data de crédito.')
        result['dueDate'] = due.isoformat()
    return result


def breakdown_matches(summary, expected):
    orders = summary.get('orders') or []
    lists = [order.get('employees') for order in orders if isinstance(order, dict)]
    if not any(lists):
        return True  # The API may omit individual allocations.
    actual = {}
    for employees in lists:
        if not isinstance(employees, list):
            return False
        for employee in employees:
            document, values = employee.get('document'), employee.get('cardValue')
            if document not in expected or document in actual or not isinstance(values, dict) or values.keys() != {WALLET}:
                return False
            actual[document] = cents(values[WALLET])
    return actual == expected


class Service:
    def __init__(self, gateway, database=DATABASE, clock=time.time):
        self.gateway, self.database, self.clock = gateway, database, clock

    def pages(self, endpoint, field, *, size_param='pageSize', **params):
        for page in range(1000):
            result = self.gateway.request(endpoint, query={**params, 'page': page, size_param: 100})
            rows = result.get(field) or []
            if not isinstance(rows, list) or type(result.get('last')) is not bool:
                raise SwileError('A Swile devolveu uma lista inválida.', 502)
            yield from rows
            if result['last']:
                return
        raise SwileError('A consulta à Swile excedeu o limite de páginas.', 502)

    def directory(self, *, public=False):
        groups = {group['idWorkGroup']: group for group in self.pages('workgroup', 'workgroups')
                  if WALLET in (group.get('cardTypes') or [])}
        if not groups:
            return []
        records = {}
        for row in self.pages('employee', 'employees', withActiveCard=True):
            group = groups.get(row.get('idWorkGroup'))
            identifier, document, name = row.get('idEmployee'), row.get('document'), row.get('name')
            if not group or row.get('status') not in ('ACTIVE', 'KEEP_ACTIVE'):
                continue
            if row.get('kycStatus') in ('DENIED', 'DENIED_FINAL', 'ERROR'):
                continue
            if type(identifier) is not int or identifier <= 0 or not re.fullmatch(r'[0-9]{11}', str(document or '')):
                continue
            if not isinstance(name, str) or not name.strip():
                continue
            item = {'id': identifier, 'name': name, 'group': row.get('workgroupName') or group.get('name'),
                    'branch': group.get('branchName'), 'hasActiveCard': row.get('hasActiveCard'),
                    'registrationPending': row.get('kycStatus') != 'APPROVED'}
            records[identifier] = item if public else {**item, 'document': document}
        return sorted(records.values(), key=lambda row: (row['name'].casefold(), row['id']))

    @contextmanager
    def db(self):
        self.database.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.database, timeout=8)) as db, db:
            db.row_factory = sqlite3.Row
            db.execute("""CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY, owner TEXT NOT NULL, fingerprint TEXT NOT NULL,
                created REAL NOT NULL, summary TEXT NOT NULL, payload TEXT NOT NULL,
                display TEXT NOT NULL, state TEXT NOT NULL, code TEXT, status TEXT)""")
            db.execute('CREATE INDEX IF NOT EXISTS orders_fingerprint ON orders (fingerprint)')
            yield db

    def receipt(self, row):
        display = json.loads(row['display'])
        return {'reference': row['id'], 'orderCode': row['code'], 'status': row['status'] or 'UNCONFIRMED',
                **{key: display[key] for key in ('creditDate', 'creditCents', 'paymentCents', 'totalEmployees')}}

    def preview_result(self, row):
        result = {'id': row['id'], **json.loads(row['display'])}
        if row['state'] != 'ready':
            result['receipt'] = self.receipt(row)
        return result

    def preview(self, owner, body):
        payment = request_dates(body, self.clock())
        items = body.get('items')
        if not isinstance(items, list) or not 1 <= len(items) <= 1000:
            raise SwileError('Informe os valores de pelo menos um colaborador.')
        amounts = {}
        for row in items:
            identifier, amount = (row.get('employeeId'), row.get('amountCents')) if isinstance(row, dict) else (None, None)
            if type(identifier) is not int or identifier <= 0 or identifier in amounts:
                raise SwileError('Há um colaborador inválido ou duplicado no pedido.')
            if type(amount) is not int or not 1 <= amount <= 999999999:
                raise SwileError('Informe valores positivos em reais, com até duas casas decimais.')
            amounts[identifier] = amount
        fingerprint = hashlib.sha256(json.dumps([sorted(amounts.items()), payment], sort_keys=True).encode()).hexdigest()
        query = f"""SELECT * FROM orders WHERE owner=? AND fingerprint=?
                    AND ({BLOCKING_ORDER} OR (state='ready' AND created>?
                         AND json_extract(payload, '$.payerDocument') IS NOT NULL))
                    ORDER BY created DESC LIMIT 1"""
        cutoff = self.clock() - PREVIEW_TTL
        with self.db() as db:
            if (existing := db.execute(query, (owner, fingerprint, cutoff)).fetchone()):
                return self.preview_result(existing)
        directory = {record['id']: record for record in self.directory()}
        if not amounts.keys() <= directory.keys():
            raise SwileError('A lista da Swile mudou. Atualize os colaboradores elegíveis antes de continuar.')
        documents = [directory[identifier]['document'] for identifier in amounts]
        if len(set(documents)) != len(documents):
            raise SwileError('A Swile retornou cadastros duplicados para a mesma pessoa.')
        data = [{'document': directory[identifier]['document'],
                 'cardValues': [{'card': WALLET, 'value': amount / 100}]}
                for identifier, amount in amounts.items()]
        summary = self.gateway.request('order/summary', data={'data': data})
        summary_id = summary.get('summaryId')
        payer_document = summary.get('payerDocument')
        if (not isinstance(summary_id, str) or not summary_id
                or not isinstance(payer_document, str) or not re.fullmatch(r'[0-9]{14}', payer_document)
                or summary.get('totalEmployees') != len(amounts)
                or cents(summary.get('valueCredit')) != sum(amounts.values())
                or not breakdown_matches(summary, dict(zip(documents, amounts.values())))):
            raise SwileError('O resumo da Swile diverge dos valores informados. Nenhum pedido foi enviado.', 502)
        identifier = uuid4().hex
        display = {**payment, 'creditCents': sum(amounts.values()), 'paymentCents': cents(summary.get('valuePayment')),
                   'totalEmployees': len(amounts), 'payer': summary.get('payerName') or summary.get('payerDocument'),
                   'items': [{'name': directory[key]['name'], 'amountCents': amount} for key, amount in amounts.items()]}
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if (existing := db.execute(query, (owner, fingerprint, cutoff)).fetchone()):
                return self.preview_result(existing)
            db.execute("DELETE FROM orders WHERE state IN ('ready','rejected') AND created<=?", (cutoff,))
            db.execute("INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', NULL, NULL)",
                       (identifier, owner, fingerprint, self.clock(), summary_id,
                        json.dumps({**payment, 'payerDocument': payer_document}), json.dumps(display)))
        return {'id': identifier, **display}

    def confirm(self, owner, identifier, invoice_text=''):
        if not isinstance(identifier, str) or not re.fullmatch(r'[a-f0-9]{32}', identifier):
            raise SwileError('Resumo do pedido inválido.')
        if not isinstance(invoice_text, str) or len(invoice_text) > 255:
            raise SwileError('A descrição na nota fiscal deve ter até 255 caracteres.')
        invoice_text = invoice_text.strip()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM orders WHERE id=? AND owner=?', (identifier, owner)).fetchone()
            if row is None:
                raise SwileError('Resumo do pedido indisponível.', 404)
            if row['state'] in ('sending', 'created'):
                return self.receipt(row)
            if row['state'] != 'ready' or self.clock() - row['created'] >= PREVIEW_TTL:
                raise SwileError('Gere um novo resumo antes de enviar o pedido.')
            duplicate = db.execute(f'SELECT 1 FROM orders WHERE fingerprint=? AND id<>? AND {BLOCKING_ORDER} LIMIT 1',
                                   (row['fingerprint'], identifier)).fetchone()
            if duplicate:
                raise SwileError('Já existe um envio idêntico na empresa. Confira os pedidos na Dash RH.', 409)
            saved = json.loads(row['payload'])
            payment = request_dates(saved, self.clock())
            if invoice_text and not saved.get('payerDocument'):
                raise SwileError('Gere um novo resumo para incluir a descrição na nota fiscal.')
            db.execute("UPDATE orders SET state='sending' WHERE id=?", (identifier,))
        # Preserve the claim before contacting Swile. The same externalId is
        # also recorded at Swile for reconciliation after an interrupted response.
        payload = {'summaryId': row['summary'], 'externalId': identifier, **payment}
        if invoice_text:
            payload['benefitPaymentInfo'] = [{'document': saved['payerDocument'], 'invoiceText': invoice_text,
                                              'swileCreditToUse': 0}]
        for key in ('creditDate', 'dueDate'):
            if key in payload:
                payload[key] += 'T03:00:00'
        try:
            result = self.gateway.request('order/create', data=payload)
        except SwileError as error:
            if error.status in (401, 403, 422, 429):
                with self.db() as db:
                    db.execute("UPDATE orders SET state=? WHERE id=? AND state='sending'",
                               ('rejected' if error.status == 422 else 'ready', identifier))
                raise
            return self.receipt(row)
        code, status = result.get('orderGroupCode'), result.get('status')
        if not isinstance(code, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', code) or not isinstance(status, str):
            return self.receipt(row)
        with self.db() as db:
            db.execute("UPDATE orders SET state='created', code=?, status=? WHERE id=?", (code, status, identifier))
        return {**self.receipt(row), 'orderCode': code, 'status': status}

    def order_status(self, code):
        data = self.gateway.request('order/group/status/' + quote(code, safe=''))
        if data.get('orderGroupCode') != code or not isinstance(data.get('status'), str):
            raise SwileError('A Swile não confirmou o status atualizado.', 502)
        return data

    def reconcile(self, row, receipt):
        # The listing returns group codes but only the status route echoes
        # externalId. Query the period when this saved preview could be sent.
        start = datetime.fromtimestamp(row['created'] - 60, timezone.utc)
        end = start + timedelta(seconds=PREVIEW_TTL + 360)
        tried = 0
        for page in range(2):
            groups = self.gateway.request('order/group', query={
                'initialDate': start.strftime('%Y-%m-%dT%H:%M:%S'),
                'finalDate': end.strftime('%Y-%m-%dT%H:%M:%S'),
                'page': page, 'size': 50,
            })
            for group in groups.get('orderGroups') or []:
                code = group.get('groupCode')
                if (not isinstance(code, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', code)
                        or group.get('totalEmployees') not in (None, receipt['totalEmployees'])
                        or cents(group.get('valueCredit')) != receipt['creditCents']):
                    continue
                tried += 1
                match = self.order_status(code)
                if match.get('externalId') == row['id']:
                    return match
                if tried >= 12:
                    return None
            if groups.get('last') is True:
                break
        return None

    def orders(self, owner, reference=None):
        with self.db() as db:
            rows = db.execute("""SELECT * FROM orders WHERE owner=? AND state IN ('sending','created')
                                ORDER BY created DESC LIMIT 30""", (owner,)).fetchall()
        result = []
        for row in rows:
            receipt = self.receipt(row)
            if reference == row['id'] or reference is None and not result:
                try:
                    data = self.order_status(row['code']) if row['code'] else self.reconcile(row, receipt)
                except SwileError:
                    receipt['statusStale'] = True
                else:
                    if data:
                        receipt.update(orderCode=data['orderGroupCode'], status=data['status'])
                        with self.db() as db:
                            db.execute("UPDATE orders SET state='created', code=?, status=? WHERE id=? AND state IN ('created','sending')",
                                       (data['orderGroupCode'], data['status'], row['id']))
            result.append(receipt)
        return result

    def pending_orders(self):
        return self.corporate_orders(history=False)

    def corporate_orders(self, *, history):
        result = []
        for group in self.pages('order/group', 'orderGroups', size_param='size'):
            status = group['statusCode']
            if not history and status in CLOSED_ORDER_STATUSES:
                continue
            dates = {scheduled_date(order.get('creditDate')) for order in group.get('orders') or []}
            row = {
                'orderCode': group['groupCode'], 'status': status, 'creditCents': cents(group['valueCredit']),
                'creditDate': dates.pop() if len(dates) == 1 else None,
            }
            requested = group.get('requestDate')
            if history:
                row['requestDate'] = scheduled_date(requested)
            result.append((requested or '', row))
        if history:
            result.sort(key=lambda entry: entry[0], reverse=True)
        return [row for _, row in result]

    def corporate_group(self, code):
        if not valid_order_code(code):
            raise SwileError('Código de pedido Swile inválido.')
        group = self.gateway.request('order/group/' + quote(code, safe=''))
        if group.get('code') != code or not isinstance(group.get('orderList'), list):
            raise SwileError('A Swile não confirmou os detalhes do pedido.', 502)
        return group

    def corporate_document(self, group_code, order_code, kind):
        if not valid_order_code(order_code) or not isinstance(kind, str) or kind not in DOCUMENT_FIELDS:
            raise SwileError('Documento do pedido Swile inválido.')
        group = self.corporate_group(group_code)
        field, label = DOCUMENT_FIELDS[kind]
        orders = [order for order in group['orderList'] if order.get('code') == order_code]
        if len(orders) != 1:
            raise SwileError('Documento indisponível para este pedido.', 404)
        data = download_document(kind, orders[0].get(field))
        return {'fileName': f'{label} Swile {order_code}.pdf', 'base64': base64.b64encode(data).decode('ascii')}

    def corporate_order_details(self, code, *, pending_only):
        group = self.corporate_group(code)
        if pending_only and group['statusCode'] in CLOSED_ORDER_STATUSES:
            raise SwileError('Este pedido saiu dos pedidos em suspenso. Atualize a galeria.', 404)
        group_date = scheduled_date(group.get('creditDate'))
        result = {'orderCode': code, 'status': group['statusCode'], 'creditDate': group_date,
                  'creditCents': 0, 'items': [], 'documents': []}
        seen_documents = set()
        for order in group['orderList']:
            order_code = order.get('code')
            if valid_order_code(order_code):
                for kind, (field, _) in DOCUMENT_FIELDS.items():
                    reference = order_code, kind
                    if reference not in seen_documents and document_url(kind, order.get(field)):
                        seen_documents.add(reference)
                        result['documents'].append({'orderCode': order_code, 'kind': kind})
            result['creditCents'] += cents(order['totalValue'])
            employees = order.get('employeeList') or []
            status = order['statusCode']
            if len(employees) < (order.get('totalEmployees') or 0):
                result['itemsIncomplete'] = True
            for employee in employees:
                line = {
                    'name': employee['name'],
                    'amountCents': sum(cents(value) for value in employee['items'].values()),
                    'status': status,
                    'creditDate': scheduled_date(order.get('creditDate')) or group_date,
                }
                if status in MIXED_CREDIT_STATUSES:
                    line.update(status=None, orderStatus=status)
                result['items'].append(line)
        return result


_lock = Lock()
_signature = None
_service = None
_allowed = frozenset()


def configured_service(identity):
    global _signature, _service, _allowed
    with _lock:
        try:
            info = CONFIG.stat()
            signature = (info.st_ino, info.st_mtime_ns, info.st_size)
            if signature != _signature:
                config = json.loads(CONFIG.read_text(encoding='utf-8'))
                allowed = config['allowedEmails']
                if (not isinstance(allowed, list) or not allowed or any(not isinstance(email, str) or not email.strip() for email in allowed)
                        or not all(isinstance(config[key], str) and config[key] for key in ('username', 'password'))):
                    raise ValueError()
                gateway = Gateway(config)
                database = DATABASE if config['environment'] == 'production' else DATABASE.with_name('staging-orders.sqlite')
                _service = Service(gateway, database)
                _allowed = frozenset(email.strip().casefold() for email in allowed)
                _signature = signature
        except (OSError, ValueError, KeyError, TypeError):
            raise SwileError('Integração Swile aguardando configuração das credenciais da empresa.', 503) from None
        email = str(identity.get('email') or identity.get('preferred_username') or '').strip().casefold()
        if not identity.get('oid') or email not in _allowed:
            raise SwileError('Seu usuário não tem acesso à integração Swile.', 403)
        return _service


def handle_portal(identity, body):
    try:
        service = configured_service(identity)
        owner = str(identity['oid'])
        action = body['action']
        if action == 'swile_directory':
            value = service.directory(public=True)
        elif action == 'swile_preview':
            value = service.preview(owner, body)
        elif action == 'swile_confirm':
            value = service.confirm(owner, body.get('id'), body.get('invoiceText', ''))
        elif action == 'swile_orders':
            gallery = body.get('gallery')
            if 'document' in body:
                document = body['document']
                if not isinstance(document, dict):
                    raise SwileError('Documento do pedido Swile inválido.')
                value = service.corporate_document(body.get('orderCode'), document.get('orderCode'), document.get('kind'))
            elif gallery in ('pending', 'history'):
                if 'orderCode' in body:
                    value = service.corporate_order_details(body['orderCode'], pending_only=gallery == 'pending')
                else:
                    value = service.corporate_orders(history=gallery == 'history')
            else:
                value = service.orders(owner, body.get('reference'))
        else:
            raise SwileError('Operação Swile inválida.')
        return 200, {'status': 'processed', 'messages': [], 'swile': value}
    except SwileError as error:
        # Upstream authentication failures must not invalidate the Microsoft session.
        return (502 if error.status == 401 else error.status), {'error': str(error)}
    except (OSError, sqlite3.Error):
        return 503, {'error': 'O registro de pedidos Swile está temporariamente indisponível.'}
