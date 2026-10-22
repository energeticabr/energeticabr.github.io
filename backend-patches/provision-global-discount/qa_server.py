"""Loopback-only QA; real engine and summary image, synthetic data, no posting."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).with_name('tests')))
from test_global_discount import GlobalDiscountTests
from payment_provision_group import provision_preview
from summary_cards import SummaryCardBuilder

fixture = GlobalDiscountTests()
fixture.setUp()
result = fixture.reply('2')
builder = SummaryCardBuilder(Path(__file__).parent / 'qa-output')
summary = None


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.headers_out()
        self.end_headers()

    def do_GET(self):
        if self.path == '/summary' and summary:
            data = Path(summary['path']).read_bytes()
            self.send_response(200)
            self.headers_out()
            self.send_header('Content-Type', 'image/png')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            self.respond()

    def do_POST(self):
        global result, summary
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        if body.get('action') == 'reset':
            fixture.setUp()
            result, summary = fixture.reply('2'), None
        else:
            raw = str(body.get('replyId') or body.get('text') or '')
            # This QA route cannot submit even a synthetic financial record.
            if raw in {'confirm_yes', 'sim'} and fixture.state['stage'] == 'awaiting_confirmation':
                self.send_error(409, 'Somente pre-visualizacao; postagem desabilitada')
                return
            result = fixture.reply(raw)
        if fixture.state['stage'] == 'awaiting_confirmation':
            summary = builder.build(rows=fixture.fixture.summary.rows[-1], attachments=[], batch_id='qa-desconto-global')
        self.respond()

    def headers_out(self):
        self.send_header('Access-Control-Allow-Origin', 'http://127.0.0.1:5189')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def respond(self):
        message = fixture.messenger.sent[-1]
        options = message.get('actions', message.get('options', []))
        messages = [{'type': 'poll', 'question': message.get('body') or message.get('step', {}).get('prompt'),
                     'options': [{'id': str(option['id']), 'reply': str(option.get('reply', option['id'])),
                                  'label': option['title']} for option in options]}]
        if summary and fixture.state['stage'] == 'awaiting_confirmation':
            messages.append({'type': 'image', 'mediaUrl': 'http://127.0.0.1:8887/summary',
                             'fileName': summary['filename'], 'caption': 'PRÉVIA COM DADOS FICTÍCIOS'})
        active = {'id': 'payment', 'title': '💳 CRIAR UMA PROVISÃO DE PAGAMENTO',
                  'contextId': 'qa-global-discount-' + fixture.state['stage'],
                  'provisionLines': provision_preview(fixture.state)}
        payload = json.dumps({'status': 'processed', 'activeFlow': active, 'messages': messages,
                              'attachments': [], 'results': [result], 'qa': {'posted': len(fixture.catalog.creates)}},
                             ensure_ascii=False).encode()
        self.send_response(200)
        self.headers_out()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == '__main__':
    print('Synthetic global discount QA at 127.0.0.1:8887', flush=True)
    HTTPServer(('127.0.0.1', 8887), Handler).serve_forever()
