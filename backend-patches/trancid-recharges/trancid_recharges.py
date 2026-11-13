"""Authenticated corporate Trancid recharges and durable submission receipts."""

from contextlib import closing, contextmanager
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
        if any(type(amount) is not int or not 0 < amount <= 999999999 for amount in amounts) or len(set(amounts)) != 1:
            raise GatewayError('Informe um valor válido e igual para os cartões selecionados.')
        identifiers = [item.get('id') for item in items]
        if any(not isinstance(identifier, str) or not re.fullmatch(r'[a-f0-9]{64}', identifier)
               for identifier in identifiers) or len(set(identifiers)) != len(identifiers):
            raise GatewayError('Confira os cartões selecionados.')
        with self.portal() as portal:
            cards = {self.public_id(card['id']): card for card in portal.directory()}
        if not all(identifier in cards for identifier in identifiers):
            raise GatewayError('A lista de cartões mudou. Abra a recarga novamente.')
        amount = amounts[0]
        selected = [cards[identifier] for identifier in identifiers]
        order_items = sorted(({'id': card['id'], 'amountCents': amount} for card in selected), key=lambda item: item['id'])
        serial = json.dumps(order_items, separators=(',', ':'))
        fingerprint = hashlib.sha256(serial.encode()).hexdigest()
        credit = amount * len(selected)
        # The provider contract quotes a 1% service fee. The final total comes from the portal.
        fee = (credit + 50) // 100
        identifier = secrets.token_urlsafe(24)
        with self.connect() as db:
            db.execute("DELETE FROM orders WHERE state='preview' AND created<?", (self.clock() - 86400,))
            db.execute("""INSERT INTO orders (id, owner, fingerprint, created, state, items, credit, total)
                          VALUES (?, ?, ?, ?, 'preview', ?, ?, ?)""",
                       (identifier, owner, fingerprint, self.clock(), serial, credit, credit + fee))
        return {'id': identifier, 'items': [{'name': card['name'], 'cardLast4': card['cardLast4'], 'amountCents': amount}
                                           for card in selected], 'creditCents': credit, 'feeCents': fee,
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
            updated = db.execute("UPDATE orders SET state=?, receipt=? WHERE id=? AND state='sending'",
                                 (state, json.dumps(receipt), identifier))
            if not updated.rowcount:
                current = db.execute('SELECT receipt FROM orders WHERE id=?', (identifier,)).fetchone()
                return json.loads(current['receipt'])
        return receipt

    def history(self, page):
        if type(page) is not int or page < 1:
            raise GatewayError('Página inválida do histórico Trancid.')
        with self.portal() as portal:
            result = portal.history(page)
        confirmed = {order['orderCode']: order for order in result['orders']
                     if order.get('orderCode') and order.get('paymentMethod') == PAYMENT_METHOD
                     and str(order.get('status', '')).strip().casefold() in SENT_STATUSES}
        if confirmed:
            with self.connect() as db:
                for row in db.execute("SELECT * FROM orders WHERE state IN ('sending', 'uncertain') AND receipt IS NOT NULL").fetchall():
                    code = json.loads(row['receipt']).get('orderCode')
                    order = confirmed.get(code)
                    if order and order.get('creditCents') == row['credit']:
                        receipt = self.receipt(row, 'SUBMITTED', order)
                        db.execute("UPDATE orders SET state='submitted', receipt=? WHERE id=? AND state IN ('sending', 'uncertain')",
                                   (json.dumps(receipt), row['id']))
        return result


def configured_service(identity):
    email = str(identity.get('email') or identity.get('preferred_username') or '').strip().casefold()
    try:
        config = json.loads(CONFIG.read_text(encoding='utf-8'))
        allowed = config['allowedEmails']
        key = bytes.fromhex(config['cardIdKey'])
        if len(key) != 32 or not isinstance(allowed, list) or not all(isinstance(entry, str) for entry in allowed):
            raise ValueError()
    except (OSError, ValueError, KeyError, TypeError):
        raise GatewayError('A integração Trancid está temporariamente indisponível.', 503) from None
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
            value = service.history(body.get('page', 1))
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
