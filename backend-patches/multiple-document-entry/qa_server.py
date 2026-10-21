"""Loopback-only synthetic workflow QA. Never connects to SharePoint."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).with_name('tests')))
from test_document_batch import DocumentBatchTests

fixture = DocumentBatchTests()
fixture.setUp()
fixture.begin()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.respond()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if body.get('action') == 'ready':
            fixture.ready()
        elif body.get('action') == 'reset':
            fixture.setUp()
            fixture.begin()
        elif body.get('action') == 'attach':
            fixture.attach('next-synthetic.pdf')
            fixture.reply('finish_attachments')
        else:
            fixture.reply(str(body.get('replyId', '')), str(body.get('text', '')))
        self.respond()

    def respond(self):
        message = fixture.messenger.sent[-1]
        if message['type'] in {'actions', 'poll'}:
            options = message.get('actions', message.get('options', []))
            question = message.get('body') or message.get('step', {}).get('prompt')
            public = {'id': 'synthetic-current', 'role': 'assistant', 'type': 'poll',
                'question': question, 'options': [
                    {'id': str(x['id']), 'reply': str(x['id']), 'label': x['title']}
                    for x in options]}
        else:
            public = {'id': 'synthetic-current', 'role': 'assistant', 'type': 'text', 'text': message['body']}
        payload = json.dumps({'message': public, 'stage': fixture.state['stage'],
            'fields': fixture.state['fields'], 'posted': len(fixture.catalog.creates),
            'attachments': [x['sharepoint_name'] for x in fixture.state['attachments']]}, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == '__main__':
    print('Synthetic document QA at 127.0.0.1:8877', flush=True)
    HTTPServer(('127.0.0.1', 8877), Handler).serve_forever()
