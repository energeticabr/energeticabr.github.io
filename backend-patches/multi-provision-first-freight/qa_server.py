"""Loopback-only real workflow QA with synthetic catalogs; never calls SharePoint."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).with_name('tests')))
from test_first_freight import FirstFreightTests
from payment_provision_group import provision_preview

fixture = FirstFreightTests()
fixture.setUp()
result = fixture.engine._prompt_next_or_summary(fixture.state, fixture.etag())


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.headers_out()
        self.end_headers()

    def do_GET(self):
        self.respond()

    def do_POST(self):
        global result
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if body.get('action') == 'reset':
            fixture.setUp()
            result = fixture.engine._prompt_next_or_summary(fixture.state, fixture.etag())
        else:
            result = fixture.reply(str(body.get('replyId') or body.get('text') or ''))
        self.respond()

    def headers_out(self):
        self.send_header('Access-Control-Allow-Origin', 'http://127.0.0.1:5187')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def respond(self):
        message = fixture.messenger.sent[-1]
        if message['type'] in {'actions', 'poll'}:
            options = message.get('actions', message.get('options', []))
            question = message.get('body') or message.get('step', {}).get('prompt')
            public = {'type': 'poll', 'question': question, 'options': [
                {'id': str(option['id']), 'reply': str(option['id']), 'label': option['title']}
                for option in options]}
        else:
            public = {'type': 'text', 'text': message['body']}
        freight_questions = sum(1 for item in fixture.messenger.sent
            if item.get('step', {}).get('key') == 'tem_frete_pagamento')
        active = {'id': 'payment', 'title': '💳 CRIAR UMA PROVISÃO DE PAGAMENTO',
                  'contextId': 'synthetic-first-freight', 'provisionLines': provision_preview(fixture.state)}
        payload = json.dumps({'status': 'processed', 'activeFlow': active, 'attachments': [],
            'messages': [public], 'results': [result],
            'qa': {'questions': freight_questions, 'posted': len(fixture.catalog.creates)}},
            ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.headers_out()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == '__main__':
    print('Synthetic freight QA at 127.0.0.1:8879', flush=True)
    HTTPServer(('127.0.0.1', 8879), Handler).serve_forever()
