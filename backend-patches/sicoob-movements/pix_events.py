"""Private durable inbox for Sicoob payment notifications; never trusts receiver data."""
import argparse
from contextlib import closing
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time

ROOT = Path('/var/lib/energetica-sicoob-movements/pix-events')
END_ID = re.compile(r'E[0-9]{20}[A-Za-z0-9]{11}')
MAX_BODY = 32768


def notification_ids(payload):
    if not isinstance(payload, dict):
        raise ValueError('Invalid notification')
    records = payload.get('payload', payload)
    records = records if isinstance(records, list) else [records]
    if not records or len(records) > 100:
        raise ValueError('Invalid batch')
    found = set()
    for record in records:
        if not isinstance(record, dict):
            raise ValueError('Invalid record')
        identifier = record.get('id')
        if not isinstance(identifier, str) or not END_ID.fullmatch(identifier):
            raise ValueError('Invalid bank identifier')
        state = record.get('estado', record.get('status'))
        if 'estado' in record and 'status' in record and record['estado'] != record['status']:
            raise ValueError('Conflicting state')
        if state in ('FINALIZADO_SUCESSO', 'FINALIZADO'):
            found.add(identifier)
        elif state not in ('FINALIZADO_REJEICAO', 'REJEITADO', 'EM_PROCESSAMENTO', 'NAO_REALIZADO', 'NÃO_REALIZADO'):
            raise ValueError('Unknown state')
    return sorted(found)


class Inbox:
    def __init__(self, root=ROOT, create=False):
        self.root = Path(root)
        self.database = self.root / 'events.sqlite3'
        if create:
            self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
            self.root.chmod(0o700)
            token_path = self.root / 'callback-token'
            try:
                fd = os.open(token_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            except FileExistsError:
                pass
            else:
                with os.fdopen(fd, 'w', encoding='ascii') as output:
                    output.write(secrets.token_urlsafe(32))
                    output.flush()
                    os.fsync(output.fileno())
            with closing(self.connect()) as connection, connection:
                connection.execute('''CREATE TABLE IF NOT EXISTS events (
                    id TEXT PRIMARY KEY COLLATE BINARY, received_at REAL NOT NULL,
                    last_attempt REAL NOT NULL DEFAULT 0, completed_at REAL,
                    movement_id INTEGER)''')
                connection.execute('''CREATE TABLE IF NOT EXISTS bank_answers (
                    id TEXT PRIMARY KEY COLLATE BINARY, account TEXT NOT NULL,
                    payer TEXT NOT NULL, answer TEXT NOT NULL, checked_at REAL NOT NULL)''')
            self.database.chmod(0o600)

    def connect(self):
        return sqlite3.connect(self.database, timeout=10)

    def secret(self):
        value = (self.root / 'callback-token').read_text(encoding='ascii').strip()
        if not re.fullmatch(r'[A-Za-z0-9_-]{43}', value):
            raise ValueError('Invalid callback configuration')
        return value

    def accept(self, payload):
        identifiers = notification_ids(payload)
        with closing(self.connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            pending = connection.execute('SELECT COUNT(*) FROM events WHERE completed_at IS NULL').fetchone()[0]
            known = {row[0] for row in connection.execute(
                'SELECT id FROM events WHERE id IN (' + ','.join('?' for _ in identifiers) + ')', identifiers)} if identifiers else set()
            if pending + len(set(identifiers) - known) > 10000:
                raise OverflowError('Inbox full')
            for identifier in identifiers:
                connection.execute('INSERT OR IGNORE INTO events(id,received_at) VALUES (?,?)', (identifier, time.time()))
            return connection.total_changes

    def pending(self, limit=100):
        if not self.database.exists():
            return []
        with closing(self.connect()) as connection:
            return [row[0] for row in connection.execute(
                'SELECT id FROM events WHERE completed_at IS NULL ORDER BY last_attempt,received_at,id LIMIT ?',
                (limit,))]

    def attempted(self, identifiers):
        with closing(self.connect()) as connection, connection:
            connection.executemany('UPDATE events SET last_attempt=? WHERE id=? AND completed_at IS NULL',
                                   ((time.time(), identifier) for identifier in identifiers))

    def bank_answers(self, account):
        """Only the authenticated collector writes this private evidence cache."""
        with closing(self.connect()) as connection:
            rows = connection.execute('''SELECT b.id,b.payer,b.answer FROM bank_answers b
                JOIN events e ON e.id=b.id WHERE e.completed_at IS NULL AND b.account=?''', (account,))
            return {identifier: (payer, json.loads(answer)) for identifier, payer, answer in rows}

    def remember_bank_answers(self, account, payer, answers):
        # A successful, final bank payment is immutable. Never persist negative
        # lookups or errors as proof of absence: they can become available later.
        with closing(self.connect()) as connection, connection:
            for identifier, answer in answers.items():
                result = answer.get('result')
                pix = result.get('resultado', result) if isinstance(result, dict) else None
                if (answer.get('status') != 200 or not isinstance(pix, dict)
                        or pix.get('estado') != 'FINALIZADO'
                        or not isinstance(pix.get('endToEndId'), str)
                        or pix['endToEndId'].casefold() != identifier.casefold()):
                    continue
                connection.execute('''INSERT OR REPLACE INTO bank_answers
                    (id,account,payer,answer,checked_at) VALUES (?,?,?,?,?)''',
                    (identifier, account, payer, json.dumps(answer), time.time()))

    def complete(self, identifier, movement_id):
        with closing(self.connect()) as connection, connection:
            connection.execute('UPDATE events SET completed_at=?,movement_id=? WHERE id=? AND completed_at IS NULL',
                               (time.time(), int(movement_id), identifier))


def make_server(inbox, port=8775):
    route = '/api/sicoob-pix/' + inbox.secret()

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def log_message(self, *args):
            # The path contains the callback secret. Never log request lines.
            pass

        def reply(self, status, body=b'{}'):
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            self.reply(200, b'{"status":"ok"}') if self.path == '/api/sicoob-pix/health' else self.reply(404)

        def do_POST(self):
            path = self.path.rstrip('/')
            if not path.isascii() or not (hmac.compare_digest(path, route) or hmac.compare_digest(path, route + '/lancamento')):
                self.reply(404)
                return
            if self.headers.get('Transfer-Encoding'):
                self.reply(400)
                return
            try:
                length = int(self.headers.get('Content-Length', ''))
            except ValueError:
                self.reply(411)
                return
            if not 0 < length <= MAX_BODY:
                self.reply(413)
                return
            try:
                content = self.rfile.read(length)
                if len(content) != length:
                    raise ValueError('Incomplete request')
                inbox.accept(json.loads(content.decode('utf-8')))
            except (ValueError, UnicodeError):
                self.reply(400)
            except (OSError, sqlite3.Error, OverflowError):
                self.reply(503)
            else:
                self.reply(200, b'{"received":true}')

    return HTTPServer(('127.0.0.1', port), Handler)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('init', 'serve'))
    args = parser.parse_args()
    os.umask(0o077)
    inbox = Inbox(create=args.command == 'init')
    if args.command == 'init':
        inbox.secret()
        print('{"initialized":true}')
    else:
        with make_server(inbox) as server:
            server.serve_forever()
