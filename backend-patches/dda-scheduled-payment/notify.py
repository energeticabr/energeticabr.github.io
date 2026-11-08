"""Read confirmed scheduled DDA payments and enqueue one tracked WhatsApp notice."""
import argparse
from contextlib import closing
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
from uuid import UUID


CONFIG = Path('/var/lib/energetica-whatsapp/dda-notifications/config.json')
DB = Path('/var/lib/energetica-whatsapp/whatsmeow/gateway.db')
SELECT = 'Id,Title,VALOR,CHAVE_DDA,CNPJ_PAGADOR,DDA_CICLO_AGENDAMENTO'
PAID = 'PAGO_AGENDADO'


def fetch_rows(request, list_id):
    if str(UUID(list_id)) != list_id:
        raise ValueError('INVALID_DDA_LIST')
    rows, after = [], 0
    while True:
        payload = request('GET', f"web/lists(guid'{list_id}')/items", params={
            '$select': SELECT, '$orderby': 'Id asc', '$top': 5000,
            '$filter': f"Id gt {after} and DDA_CICLO_AGENDAMENTO eq '{PAID}'",
        })
        page = payload.get('value')
        if not isinstance(page, list) or len(page) > 5000:
            raise ValueError('INCOMPLETE_DDA_INVENTORY')
        if not page:
            return rows
        for row in page:
            item_id = row.get('Id')
            if type(item_id) is not int or item_id <= after:
                raise ValueError('DDA_PAGINATION_DID_NOT_ADVANCE')
            rows.append(row)
            after = item_id
        if len(rows) > 100_000:
            raise ValueError('DDA_INVENTORY_LIMIT')


def event_for(row, payer):
    if row.get('CNPJ_PAGADOR') != payer or row.get('DDA_CICLO_AGENDAMENTO') != PAID:
        return None
    item_id, dda_key = row.get('Id'), row.get('CHAVE_DDA')
    if type(item_id) is not int or item_id <= 0 or not re.fullmatch(r'[a-f0-9]{64}', dda_key or ''):
        raise ValueError('INVALID_DDA_PAYMENT_IDENTITY')
    event = hashlib.sha256(f'dda-scheduled-payment|{dda_key}'.encode()).hexdigest()
    supplier = ' '.join(re.sub(r'[*_~`]', '', str(row.get('Title') or '')).split())[:140]
    text = f"*PAGAMENTO AGENDADO CONFIRMADO*\nDDA #{item_id} · {supplier or 'Fornecedor não informado'}"
    try:
        amount = Decimal(str(row.get('VALOR')))
        if amount.is_finite() and 0 <= amount <= Decimal('99999999999999'):
            formatted = f'{amount:,.2f}'.translate(str.maketrans(',.', '.,'))
            text += f'\nValor: *R$ {formatted}*'
    except InvalidOperation:
        pass
    return event, text


def queued_notice(db, outbox_id, completion, group):
    row = db.execute('SELECT message FROM gateway_outbox WHERE id=?', (outbox_id,)).fetchone()
    if row is None:
        return False
    try:
        message = json.loads(row[0])
    except (TypeError, ValueError, UnicodeError):
        return False
    return (isinstance(message, dict) and message.get('completionId') == completion
            and message.get('conversation_id') == message.get('group_id') == group)


def deliver(database, group, payer, rows):
    if not re.fullmatch(r'\d+(?:-\d+)?@g\.us', group) or not re.fullmatch(r'\d{14}', payer):
        raise ValueError('INVALID_DDA_NOTICE_DESTINATION')
    events = dict(event for row in rows if (event := event_for(row, payer)) is not None)
    result = dict(new=0, queued=0, sent=0, unconfirmed=0)
    if not events:
        return result
    with closing(sqlite3.connect(database, timeout=30)) as db, db:
        db.execute("""CREATE TABLE IF NOT EXISTS dda_scheduled_payment_notices(
            key TEXT PRIMARY KEY, chat_id TEXT NOT NULL, outbox_id INTEGER NOT NULL)""")
        db.execute('BEGIN IMMEDIATE')
        for key, text in events.items():
            completion = f'dda-scheduled-payment-{key}'
            prior = db.execute('SELECT chat_id,outbox_id FROM dda_scheduled_payment_notices WHERE key=?',
                               (key,)).fetchone()
            if prior is None:
                message = {'type': 'text', 'text': text, 'conversation_id': group, 'group_id': group,
                           'completionId': completion, 'trackCompletionSuccess': True}
                outbox_id = db.execute('INSERT INTO gateway_outbox(message,created_at) VALUES(?,?)',
                                       (json.dumps(message, ensure_ascii=False).encode(), int(time.time()))).lastrowid
                db.execute('INSERT INTO dda_scheduled_payment_notices VALUES(?,?,?)', (key, group, outbox_id))
                result['new'] += 1
            else:
                if prior[0] != group:
                    raise ValueError('DDA_NOTICE_DESTINATION_CHANGED')
                outbox_id = prior[1]
            sent = db.execute("""SELECT 1 FROM gateway_completion_messages
                                 WHERE completion_id=? AND chat_id=? AND message_id<>''""",
                              (completion, group)).fetchone()
            queued = not sent and queued_notice(db, outbox_id, completion, group)
            result['sent' if sent else 'queued' if queued else 'unconfirmed'] += 1
    return result


def source():
    sys.path[:0] = ['/opt/energetica-whatsapp', '/opt/energetica-whatsapp/worker']
    from clients import SharePointClient
    from dda_manual_payment import load_scope
    if not os.environ.get('ENTRA_TENANT_ID'):
        from local_app import load_env
        load_env(Path('/etc/energetica-whatsapp.env'))

    scope = load_scope()
    client = SharePointClient(scope['siteHost'], scope['sitePath'], os.environ['ENTRA_TENANT_ID'],
                              os.environ['ENTRA_CLIENT_ID'], Path(os.environ['ENTRA_PRIVATE_KEY_FILE']).read_text(),
                              Path(os.environ['ENTRA_CERTIFICATE_FILE']).read_text(), 'DDAS SICOOB')
    return fetch_rows(client._request, scope['listId']), scope['company']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true', help='Check SharePoint without modifying the outbox.')
    options = parser.parse_args()
    config = json.loads(CONFIG.read_text())
    group = config.get('groupId', '')
    if (config.get('enabled') is not True or config.get('groupName') != 'NOVO DDA'
            or not re.fullmatch(r'\d+(?:-\d+)?@g\.us', group)):
        raise ValueError('DDA_NOTICE_DESTINATION_NOT_CONFIGURED')
    rows, payer = source()
    if config.get('payerId') != payer:
        raise ValueError('DDA_NOTICE_COMPANY_MISMATCH')
    if options.check:
        print(json.dumps({'eligible': sum(event_for(row, payer) is not None for row in rows),
                          'destinationVerified': True}))
        return
    result = deliver(DB, group, payer, rows)
    print(json.dumps(result))
    if result['unconfirmed']:
        print('DDA_NOTICE_DELIVERY_UNCONFIRMED', file=sys.stderr)
        return 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        print(json.dumps({'status': 'failed', 'kind': type(exc).__name__}), file=sys.stderr)
        sys.exit(1)
