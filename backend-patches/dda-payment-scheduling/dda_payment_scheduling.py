"""Authenticated boleto scheduling for the company account."""
from contextlib import contextmanager
from datetime import date, datetime
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import time
import uuid
from zoneinfo import ZoneInfo

ROOT = Path('/var/lib/energetica-whatsapp/dda-payment-scheduling')
READER = Path(__file__).with_name('Invoke-DdaPaymentScheduling.ps1')
KEY = re.compile('[a-f0-9]{64}')
QUOTE = re.compile('[a-f0-9]{32}')
BARCODE = re.compile('[0-9]{44}')
FIELDS = ('Id', 'CHAVE_DDA', 'CNPJ_PAGADOR', 'CODIGO_BARRAS', 'VENCIMENTO', 'STATUS_DDA',
          'SITUACAO', 'PGTO_CONFIRMADO', 'DDA_RECUSADO', 'BLOQUEADO', 'DDA_CICLO_AGENDAMENTO')
RETRYABLE = ('rejected', 'cancelled', 'not_sent')


def today_in_brasilia():
    return datetime.now(ZoneInfo('America/Sao_Paulo')).date()


def call_bank(operation, payload):
    try:
        process = subprocess.run(
            ['pwsh', '-NoLogo', '-NoProfile', '-NonInteractive', '-File', str(READER), operation],
            input=json.dumps(payload), capture_output=True, text=True, encoding='utf-8', timeout=35)
        if process.returncode:
            raise RuntimeError()
        response = json.loads(process.stdout)
        if not isinstance(response, dict):
            raise ValueError()
        return response
    except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired):
        if operation in ('dispatch', 'lookup'):
            return {'status': 'pending'}
        raise RuntimeError('Não foi possível consultar o boleto no Sicoob. Tente novamente.') from None


def read_row(repository, item_id, key):
    row = repository.read(item_id)
    if (row.get('Id') != item_id or row.get('CHAVE_DDA') != key
            or row.get('CNPJ_PAGADOR') != repository.company):
        raise PermissionError('DDA indisponível para agendamento.')
    return row


def open_barcode(row):
    barcode = str(row.get('CODIGO_BARRAS') or '').strip()
    truthy = ('sim', 's', '1', 'true')
    situation = str(row.get('SITUACAO') or '').strip().casefold()
    bank_situation = str(row.get('STATUS_DDA') or '').strip().casefold()
    if (not BARCODE.fullmatch(barcode) or row.get('DDA_CICLO_AGENDAMENTO') in ('AGENDADO', 'PAGO_AGENDADO')
            or situation in ('agendado', 'pago', 'pago (liquidado)', 'liquidado', 'baixado', 'recusado')
            or (bank_situation or situation) != 'em aberto'
            or any(str(row.get(field) or '').strip().casefold() in truthy
                   for field in ('PGTO_CONFIRMADO', 'DDA_RECUSADO', 'BLOQUEADO'))):
        raise ValueError('O boleto precisa estar em aberto e disponível para pagamento.')
    return barcode


def valid_day(value):
    if not isinstance(value, str) or not re.fullmatch('[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
        raise ValueError('Data de agendamento inválida.')
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValueError('Data de agendamento inválida.') from None


def sharepoint_repository(bridge_client):
    from dda_manual_payment import SharePointRepository

    class Repository(SharePointRepository):
        def read(self, item_id):
            result = self.client._request('GET', f"web/lists(guid'{self.list_id}')/items({item_id})",
                params={'$select': ','.join(FIELDS)}, headers={'Accept': 'application/json;odata=verbose'})
            return result.get('d', result)

    return Repository.from_bridge(bridge_client)


class Scheduling:
    def __init__(self, path=ROOT / 'orders.sqlite3', *, bank=call_bank, today=today_in_brasilia, clock=time.time):
        self.path = Path(path)
        self.bank, self.today, self.clock = bank, today, clock

    @contextmanager
    def database(self, *, write=False):
        self.path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        database = sqlite3.connect(self.path, timeout=8)
        database.row_factory = sqlite3.Row
        try:
            database.execute('PRAGMA foreign_keys=ON')
            database.execute("""
                CREATE TABLE IF NOT EXISTS quotes (
                    id TEXT PRIMARY KEY, owner TEXT NOT NULL, item INTEGER NOT NULL,
                    item_key TEXT NOT NULL, barcode TEXT NOT NULL, day TEXT NOT NULL,
                    expires REAL NOT NULL, payload TEXT NOT NULL)""")
            database.execute("""
                CREATE TABLE IF NOT EXISTS orders (
                    barcode TEXT PRIMARY KEY, quote TEXT NOT NULL, status TEXT NOT NULL,
                    changed REAL NOT NULL, bank_id INTEGER,
                    FOREIGN KEY (quote) REFERENCES quotes(id))""")
            if write:
                database.execute('BEGIN IMMEDIATE')
            with database:
                yield database
        finally:
            database.close()

    @staticmethod
    def public(quote, status):
        return {'status': status, 'itemId': quote['item'], 'key': quote['item_key'], 'date': quote['day']}

    @staticmethod
    def order(database, barcode):
        return database.execute('SELECT * FROM orders WHERE barcode=?', (barcode,)).fetchone()

    def list(self, owner):
        with self.database() as database:
            rows = database.execute("""
                SELECT q.*,o.status FROM orders o JOIN quotes q ON q.id=o.quote
                WHERE q.owner=? AND (o.status IN ('submitting','pending','approval')
                  OR (o.status='scheduled' AND q.day>=?)) ORDER BY o.changed DESC""",
                (owner, self.today().isoformat())).fetchall()
        return {'status': 'available', 'entries': [
            self.public(row, 'pending' if row['status'] == 'submitting' else row['status']) for row in rows]}

    def quote(self, owner, repository, item, key, day):
        if valid_day(day) <= self.today():
            raise ValueError('Escolha uma data futura para agendar.')
        row = read_row(repository, item, key)
        barcode = open_barcode(row)
        with self.database() as database:
            order = self.order(database, barcode)
        if order and order['status'] not in RETRYABLE:
            if order['status'] != 'scheduled' or self.resume(owner, key, order, refresh_scheduled=True)['status'] not in RETRYABLE:
                raise ValueError('Já existe uma ordem para este boleto. Atualize a galeria para consultar.')
        due = str(row.get('VENCIMENTO') or '')[:10]
        valid_day(due)
        result = self.bank('quote', {'barcode': barcode, 'company': repository.company, 'date': day, 'due': due})
        if result.get('status') != 'quoted':
            messages = {
                'already_scheduled': 'O Sicoob já tem um agendamento para este boleto.',
                'unavailable': 'O Sicoob não disponibilizou este boleto para a data escolhida.',
            }
            raise ValueError(messages.get(result.get('status'), 'O Sicoob não confirmou a consulta do boleto.'))
        if (result.get('date') != day or type(result.get('amountCents')) is not int
                or not 0 < result['amountCents'] < 10 ** 14 or not isinstance(result.get('beneficiary'), str)
                or not result['beneficiary'].strip()):
            raise RuntimeError('O Sicoob retornou uma conferência incompleta.')
        public = {key: result[key] for key in ('status', 'date', 'amountCents', 'beneficiary')}
        public['canConfirm'] = result.get('canConfirm') is True
        if public['canConfirm']:
            if not isinstance(result.get('bankQuote'), dict) or not isinstance(result.get('configuration'), str):
                raise RuntimeError('O Sicoob retornou uma conferência incompleta.')
            quote_id = uuid.uuid4().hex
            payload = {name: result[name] for name in ('bankQuote', 'configuration', 'amountCents')}
            payload.update(barcode=barcode, company=repository.company, date=day, due=due, orderKey=str(uuid.uuid4()))
            with self.database(write=True) as database:
                database.execute('DELETE FROM quotes WHERE expires<? AND id NOT IN (SELECT quote FROM orders)', (self.clock(),))
                database.execute('INSERT INTO quotes VALUES (?,?,?,?,?,?,?,?)',
                    (quote_id, owner, item, key, barcode, day, self.clock() + 300, json.dumps(payload)))
            public['quoteId'] = quote_id
        return public

    def confirm(self, owner, repository, quote_id):
        with self.database() as database:
            quote = database.execute('SELECT * FROM quotes WHERE id=? AND owner=?', (quote_id, owner)).fetchone()
            if quote is None:
                raise PermissionError('Conferência DDA indisponível para esta sessão.')
            order = self.order(database, quote['barcode'])
        if order and (order['status'] not in RETRYABLE or order['quote'] == quote_id):
            return self.resume(owner, quote['item_key'], order)
        if quote['expires'] <= self.clock() or valid_day(quote['day']) <= self.today():
            raise ValueError('A conferência expirou. Consulte o boleto novamente.')
        row = read_row(repository, quote['item'], quote['item_key'])
        payload = json.loads(quote['payload'])
        if open_barcode(row) != quote['barcode'] or str(row.get('VENCIMENTO') or '')[:10] != payload['due']:
            raise ValueError('O boleto mudou. Consulte novamente antes de agendar.')
        with self.database(write=True) as database:
            order = self.order(database, quote['barcode'])
            claimed = not order or (order['status'] in RETRYABLE and order['quote'] != quote_id)
            if claimed:
                current = database.execute('SELECT expires FROM quotes WHERE id=? AND owner=?', (quote_id, owner)).fetchone()
                if current is None or current['expires'] <= self.clock() or valid_day(quote['day']) <= self.today():
                    raise ValueError('A conferência expirou. Consulte o boleto novamente.')
                database.execute('INSERT OR REPLACE INTO orders VALUES (?,?,?,?,NULL)',
                                 (quote['barcode'], quote_id, 'submitting', self.clock()))
        if not claimed:
            return self.resume(owner, quote['item_key'], order)
        result = self.bank('dispatch', payload)
        return self.finish(quote, result, previous='submitting')

    def status(self, owner, item, key):
        with self.database() as database:
            quote = database.execute("""
                SELECT q.* FROM orders o JOIN quotes q ON q.id=o.quote
                WHERE q.owner=? AND q.item=? AND q.item_key=? ORDER BY o.changed DESC LIMIT 1""",
                (owner, item, key)).fetchone()
            if quote is None:
                return {'status': 'none', 'itemId': item, 'key': key}
            order = self.order(database, quote['barcode'])
        return self.resume(owner, quote['item_key'], order, refresh_scheduled=True)

    def resume(self, owner, key, order, *, refresh_scheduled=False):
        with self.database() as database:
            prior = database.execute('SELECT * FROM quotes WHERE id=?', (order['quote'],)).fetchone()
        if prior is None or prior['owner'] != owner or prior['item_key'] != key:
            raise ValueError('Já existe uma ordem para este boleto.')
        state = order['status']
        if state == 'submitting' and self.clock() - order['changed'] < 45:
            return self.public(prior, 'pending')
        if state in ('pending', 'approval', 'submitting') or (refresh_scheduled and state == 'scheduled'):
            payload = json.loads(prior['payload'])
            result = self.bank('lookup', payload)
            if result.get('status') == 'pending':
                with self.database() as database:
                    latest = self.order(database, prior['barcode'])
                known = latest['status'] if latest['quote'] == prior['id'] else 'pending'
                return self.public(prior, 'pending' if known == 'submitting' else known)
            return self.finish(prior, result, previous=state)
        return self.public(prior, state)

    def finish(self, quote, result, *, previous):
        status, bank_id = result.get('status'), result.get('paymentId')
        if status not in ('scheduled', 'approval', *RETRYABLE, 'pending', 'effective'):
            status = 'pending'
        if status in ('scheduled', 'effective', 'rejected', 'cancelled') and (type(bank_id) is not int or bank_id <= 0):
            status = 'pending'
        with self.database(write=True) as database:
            database.execute("""
                UPDATE orders SET status=?,changed=?,bank_id=? WHERE barcode=? AND quote=? AND status=?""",
                (status, self.clock(), bank_id, quote['barcode'], quote['id'], previous))
            current = self.order(database, quote['barcode'])
        if current['quote'] != quote['id']:
            return self.public(quote, status)
        return self.public(quote, 'pending' if current['status'] == 'submitting' else current['status'])


SERVICE = Scheduling()


def handle_portal(identity, body, repository=None, *, bridge_client=None, service=SERVICE, authorize=None):
    if authorize is None:
        from dda_sync import Queue
        authorize = Queue().authorize
    owner = authorize(identity)
    action = body.get('action')
    if action == 'dda_schedule_list' and set(body) == {'action'}:
        result = service.list(owner)
    elif (action == 'dda_schedule_confirm' and set(body) == {'action', 'quoteId'}
          and isinstance(body['quoteId'], str) and QUOTE.fullmatch(body['quoteId'])):
        result = service.confirm(owner, repository or sharepoint_repository(bridge_client), body['quoteId'])
    elif (action in ('dda_schedule_quote', 'dda_schedule_status')
          and set(body) == ({'action', 'itemId', 'key', 'date'} if action == 'dda_schedule_quote'
                            else {'action', 'itemId', 'key'})
          and type(body['itemId']) is int and 1 <= body['itemId'] <= 2147483647
          and isinstance(body['key'], str) and KEY.fullmatch(body['key'])):
        if action == 'dda_schedule_quote':
            result = service.quote(owner, repository or sharepoint_repository(bridge_client),
                                   body['itemId'], body['key'], body['date'])
        else:
            result = service.status(owner, body['itemId'], body['key'])
    else:
        raise ValueError('Pedido de agendamento DDA inválido.')
    return {'status': 'processed', 'messages': [], 'ddaSchedule': result}
