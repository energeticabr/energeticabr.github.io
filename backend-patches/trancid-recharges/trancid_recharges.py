"""Authenticated corporate Trancid recharges and durable submission receipts."""

from contextlib import closing, contextmanager
from datetime import datetime, timezone
import hashlib
import hmac
import json
import logging
from pathlib import Path
import re
import secrets
import sqlite3
import time

from trancid_portal_adapter import Portal, PortalError, PortalUncertain

CONFIG = Path('/etc/energetica-trancid-recharges.json')
DATABASE = Path('/var/lib/energetica-whatsapp/trancid-recharges/orders.sqlite')
PREVIEW_SECONDS = 30 * 60
PAYMENT_METHOD = 'BOLETO'
HISTORY_PAGE_SIZE = 7
HISTORY_TTL = 86400
PAYMENT_STATUSES = {
    'enviado': 'Pendente pgto', 'aguardando pagamento': 'Pendente pgto',
    'pago': 'Pago', 'finalizado': 'Pago', 'em andamento': 'Rascunho', 'cancelado': 'Cancelado',
}
SENT_STATUSES = {'enviado', 'finalizado'}
LOGGER = logging.getLogger(__name__)


class GatewayError(Exception):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.status = status


class Service:
    def __init__(self, portal, database, key, clock=time.time):
        self.portal, self.database, self.key, self.clock = portal, database, key, clock

    @contextmanager
    def connect(self):
        with closing(sqlite3.connect(self.database, timeout=8)) as db, db:
            db.row_factory = sqlite3.Row
            db.execute("""CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY, owner TEXT NOT NULL, fingerprint TEXT NOT NULL,
                created REAL NOT NULL, attempted REAL, state TEXT NOT NULL,
                items TEXT NOT NULL, credit INTEGER NOT NULL, total INTEGER NOT NULL,
                receipt TEXT
            )""")
            db.execute('CREATE INDEX IF NOT EXISTS orders_fingerprint ON orders(fingerprint, state)')
            db.execute('''CREATE TABLE IF NOT EXISTS history_snapshot (
                id INTEGER PRIMARY KEY CHECK (id=1), collected REAL NOT NULL,
                stale INTEGER NOT NULL DEFAULT 0, orders_json TEXT NOT NULL
            )''')
            yield db

    def public_id(self, provider_id):
        return hmac.new(self.key, provider_id.encode(), hashlib.sha256).hexdigest()

    @staticmethod
    def public_card(card, identifier):
        return {'id': identifier, 'name': card['name'], 'cardLast4': card['cardLast4']}

    def directory(self):
        with self.portal() as portal:
            return [self.public_card(card, self.public_id(card['id'])) for card in portal.directory()]

    def preview(self, owner, body):
        items = body.get('items')
        if body.get('paymentMethod') != PAYMENT_METHOD:
            raise GatewayError('Escolha boleto para a recarga Trancid.')
        if not isinstance(items, list) or not items or any(not isinstance(item, dict) for item in items):
            raise GatewayError('Selecione os cartões que devem receber a recarga.')
        amounts = [item.get('amountCents') for item in items]
        if any(type(amount) is not int or not 0 < amount <= 999999999 for amount in amounts):
            raise GatewayError('Informe um valor válido para cada cartão selecionado.')
        identifiers = [item.get('id') for item in items]
        if any(not isinstance(identifier, str) or not re.fullmatch(r'[a-f0-9]{64}', identifier)
               for identifier in identifiers) or len(set(identifiers)) != len(identifiers):
            raise GatewayError('Confira os cartões selecionados.')
        with self.portal() as portal:
            cards = {self.public_id(card['id']): card for card in portal.directory()}
        if not all(identifier in cards for identifier in identifiers):
            raise GatewayError('A lista de cartões mudou. Abra a recarga novamente.')
        selected = [(identifier, cards[identifier], amount) for identifier, amount in zip(identifiers, amounts)]
        order_items = sorted(({'id': card['id'], 'amountCents': amount} for _, card, amount in selected), key=lambda item: item['id'])
        serial = json.dumps(order_items, separators=(',', ':'))
        fingerprint = hashlib.sha256(serial.encode()).hexdigest()
        credit = sum(amounts)
        # The provider contract quotes a 1% service fee. The final total comes from the portal.
        fee = (credit + 50) // 100
        identifier = secrets.token_urlsafe(24)
        with self.connect() as db:
            db.execute("DELETE FROM orders WHERE state='preview' AND created<?", (self.clock() - 86400,))
            db.execute("""INSERT INTO orders (id, owner, fingerprint, created, state, items, credit, total)
                          VALUES (?, ?, ?, ?, 'preview', ?, ?, ?)""",
                       (identifier, owner, fingerprint, self.clock(), serial, credit, credit + fee))
        return {'id': identifier, 'items': [{**self.public_card(card, public_id), 'amountCents': amount}
                                           for public_id, card, amount in selected], 'creditCents': credit, 'feeCents': fee,
                'totalCents': credit + fee, 'paymentMethod': PAYMENT_METHOD}

    @staticmethod
    def receipt(row, status, result=None):
        receipt = {'id': row['id'], 'status': status, 'paymentMethod': PAYMENT_METHOD,
                   'creditCents': row['credit'], 'totalCents': None}
        if result:
            if code := result.get('orderCode'):
                receipt['orderCode'] = code
            if status == 'SUBMITTED':
                if type(result.get('totalCents')) is int and result['totalCents'] >= row['credit']:
                    receipt['totalCents'] = result['totalCents']
        return receipt

    def claim(self, owner, identifier):
        if not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9_-]{32}', identifier):
            raise GatewayError('Abra uma nova conferência da recarga.')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM orders WHERE id=? AND owner=?', (identifier, owner)).fetchone()
            if row is None:
                raise GatewayError('Conferência da recarga não encontrada.', 404)
            if row['state'] != 'preview':
                return row, False
            now = self.clock()
            if row['created'] + PREVIEW_SECONDS < now:
                raise GatewayError('A conferência expirou. Revise os valores e tente novamente.', 409)
            previous = db.execute("""SELECT 1 FROM orders WHERE fingerprint=? AND
                                      (state IN ('sending', 'uncertain') OR (state='submitted' AND attempted>=?))
                                      LIMIT 1""", (row['fingerprint'], now - PREVIEW_SECONDS)).fetchone()
            if previous:
                raise GatewayError('Já existe uma recarga igual enviada ou em conferência. Consulte a Galeria Trancid.', 409)
            db.execute("UPDATE orders SET state='sending', attempted=? WHERE id=?", (now, identifier))
        return row, True

    def confirm(self, owner, identifier):
        row, claimed = self.claim(owner, identifier)
        if not claimed:
            return json.loads(row['receipt']) if row['receipt'] else self.receipt(row, 'UNCONFIRMED')
        submitted = None
        order_code = None

        def record_draft(code):
            nonlocal order_code
            if not isinstance(code, str) or not re.fullmatch(r'[0-9]+', code):
                raise GatewayError('A Trancid retornou um número de pedido inválido.')
            order_code = code
            pending = self.receipt(row, 'UNCONFIRMED', {'orderCode': code})
            with self.connect() as db:
                db.execute("UPDATE orders SET receipt=? WHERE id=? AND state='sending'",
                           (json.dumps(pending), identifier))
        try:
            with self.portal() as portal:
                submitted = portal.submit(json.loads(row['items']), PAYMENT_METHOD, on_draft=record_draft)
        except PortalUncertain as error:
            order_code = error.order_code or order_code
        except PortalError:
            if submitted is None and order_code is None:
                with self.connect() as db:
                    db.execute("UPDATE orders SET state='preview', attempted=NULL, receipt=NULL WHERE id=?", (identifier,))
                raise
        except Exception:
            LOGGER.error('Unexpected failure while verifying a Trancid submission.')
        if submitted:
            order_code = submitted.get('orderCode') or order_code
        verified = (submitted and isinstance(order_code, str) and order_code.isdecimal()
                    and submitted.get('creditCents') == row['credit']
                    and submitted.get('paymentMethod') == PAYMENT_METHOD
                    and str(submitted.get('status', '')).strip().casefold() in SENT_STATUSES)
        if verified:
            state, receipt = 'submitted', self.receipt(row, 'SUBMITTED', submitted)
        else:
            state, receipt = 'uncertain', self.receipt(row, 'UNCONFIRMED', {'orderCode': order_code})
        with self.connect() as db:
            updated = db.execute("UPDATE orders SET state=?, attempted=?, receipt=? WHERE id=? AND state='sending'",
                                 (state, self.clock(), json.dumps(receipt), identifier))
            if not updated.rowcount:
                current = db.execute('SELECT receipt FROM orders WHERE id=?', (identifier,)).fetchone()
                return json.loads(current['receipt'])
        return receipt

    def refresh_history(self):
        started = self.clock()
        try:
            with self.portal() as portal:
                return self.collect_history(portal)
        except PortalError:
            with self.connect() as db:
                db.execute('UPDATE history_snapshot SET stale=1 WHERE collected<?', (started,))
            raise

    def collect_history(self, portal):
        collected = self.clock()
        orders = portal.all_history()
        orders.sort(key=lambda order: (order['requestDate'], int(order['orderCode'])), reverse=True)
        snapshot = [
            {**order, 'paymentStatus': PAYMENT_STATUSES.get(order['status'].strip().casefold(),
                                                            'Pagamento não confirmado')}
            for order in orders
        ]
        with self.connect() as db:
            self.reconcile_history(db, orders)
            db.execute('''INSERT INTO history_snapshot (id, collected, orders_json) VALUES (1, ?, ?)
                          ON CONFLICT(id) DO UPDATE SET collected=excluded.collected,
                                                       orders_json=excluded.orders_json, stale=0''',
                       (collected, json.dumps(snapshot)))
        return collected, snapshot

    def history(self, page, *, refresh=False):
        if type(page) is not int or page < 1:
            raise GatewayError('Página inválida do histórico Trancid.')
        with self.connect() as db:
            snapshot = db.execute('SELECT collected, stale, orders_json FROM history_snapshot WHERE id=1').fetchone()
            attempted = db.execute("SELECT max(attempted) FROM orders WHERE state IN ('submitted', 'uncertain', 'sending')").fetchone()[0]
        collected, orders = (snapshot['collected'], json.loads(snapshot['orders_json'])) if snapshot else (None, [])
        stale = bool(snapshot and snapshot['stale'])
        if (refresh or not snapshot or snapshot['collected'] + HISTORY_TTL <= self.clock()
                or (attempted is not None and attempted > snapshot['collected'])):
            try:
                collected, orders = self.refresh_history()
                stale = False
            except PortalError:
                if not snapshot:
                    raise
                stale = True
        page = min(page, max(1, (len(orders) + HISTORY_PAGE_SIZE - 1) // HISTORY_PAGE_SIZE))
        start = (page - 1) * HISTORY_PAGE_SIZE
        return {'orders': orders[start:start + HISTORY_PAGE_SIZE], 'hasMore': start + HISTORY_PAGE_SIZE < len(orders),
                'page': page, 'stale': stale, 'checkedAt': datetime.fromtimestamp(collected, timezone.utc).isoformat()}

    def reconcile_history(self, db, orders):
        confirmed = {order['orderCode']: order for order in orders
                     if order.get('orderCode') and order.get('paymentMethod') == PAYMENT_METHOD
                     and str(order.get('status', '')).strip().casefold() in SENT_STATUSES}
        if not confirmed:
            return
        for row in db.execute("SELECT * FROM orders WHERE state IN ('sending', 'uncertain') AND receipt IS NOT NULL"):
            code = json.loads(row['receipt']).get('orderCode')
            order = confirmed.get(code)
            if order and order.get('creditCents') == row['credit']:
                receipt = self.receipt(row, 'SUBMITTED', order)
                db.execute("UPDATE orders SET state='submitted', receipt=? WHERE id=? AND state IN ('sending', 'uncertain')",
                           (json.dumps(receipt), row['id']))


def read_config():
    try:
        config = json.loads(CONFIG.read_text(encoding='utf-8'))
        allowed = config['allowedEmails']
        key = bytes.fromhex(config['cardIdKey'])
        if len(key) != 32 or not isinstance(allowed, list) or not all(isinstance(entry, str) for entry in allowed):
            raise ValueError()
    except (OSError, ValueError, KeyError, TypeError):
        raise GatewayError('A integração Trancid está temporariamente indisponível.', 503) from None
    return allowed, key


def configured_service(identity):
    email = str(identity.get('email') or identity.get('preferred_username') or '').strip().casefold()
    allowed, key = read_config()
    if not identity.get('oid') or email not in allowed:
        raise GatewayError('Seu usuário não tem acesso à integração Trancid.', 403)
    return Service(Portal, DATABASE, key)


def handle_portal(identity, body):
    try:
        service = configured_service(identity)
        owner = str(identity['oid'])
        action = body.get('action')
        if action == 'trancid_recharge_directory':
            value = service.directory()
        elif action == 'trancid_recharge_preview':
            value = service.preview(owner, body)
        elif action == 'trancid_recharge_confirm':
            value = service.confirm(owner, body.get('id'))
        elif action == 'trancid_recharge_history':
            value = service.history(body.get('page', 1), refresh=body.get('refresh') is True)
        else:
            raise GatewayError('Operação Trancid inválida.')
        return 200, {'status': 'processed', 'messages': [], 'trancid': value}
    except GatewayError as error:
        return error.status, {'error': str(error)}
    except PortalError as error:
        if body.get('action') == 'trancid_recharge_confirm':
            return 409, {'code': 'TRANCID_NOT_SUBMITTED', 'error': str(error)}
        return 502, {'error': str(error)}
    except (OSError, sqlite3.Error):
        return 503, {'error': 'O registro de recargas Trancid está temporariamente indisponível.'}


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    try:
        _, key = read_config()
        _, orders = Service(Portal, DATABASE, key).refresh_history()
        LOGGER.info('Histórico Trancid atualizado: %d pedidos.', len(orders))
    except (GatewayError, PortalError, sqlite3.Error, OSError):
        LOGGER.error('Não foi possível atualizar o histórico Trancid.')
        raise SystemExit(1)
