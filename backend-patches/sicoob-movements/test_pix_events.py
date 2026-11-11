import concurrent.futures
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest

import pix_events

ID = 'E12345678202611111234ABCDEFGHIJK'


class InboxTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name) / 'events'
        self.inbox = pix_events.Inbox(self.root, create=True)

    def tearDown(self):
        self.directory.cleanup()

    def test_acknowledged_event_survives_restart_and_duplicates(self):
        event = {'id': ID, 'estado': 'FINALIZADO_SUCESSO', 'nome': 'UNTRUSTED'}
        self.assertEqual(self.inbox.accept(event), 1)
        self.assertEqual(pix_events.Inbox(self.root).pending(), [ID])
        self.assertEqual(self.inbox.accept({'payload': [event, event]}), 0)
        self.inbox.complete(ID, 29)
        self.assertEqual(self.inbox.accept(event), 0)
        self.assertEqual(self.inbox.pending(), [])

    def test_atomic_validation_and_retry_fairness(self):
        other = ID[:-1] + 'Z'
        with self.assertRaises(ValueError):
            self.inbox.accept({'payload': [{'id': ID, 'status': 'FINALIZADO_SUCESSO'},
                                           {'id': '../bad', 'status': 'FINALIZADO_SUCESSO'}]})
        self.assertFalse(self.inbox.pending())
        self.inbox.accept({'payload': [{'id': x, 'status': 'FINALIZADO_SUCESSO'} for x in [ID, other]]})
        first = self.inbox.pending(limit=1)
        self.inbox.attempted(first)
        self.assertNotEqual(self.inbox.pending(limit=1), first)
        self.assertEqual(set(self.inbox.pending()), {ID, other})

    def test_rejected_payment_does_not_erase_success_and_concurrency_is_idempotent(self):
        event = {'id': ID, 'status': 'FINALIZADO_SUCESSO'}
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as workers:
            self.assertEqual(sum(workers.map(self.inbox.accept, [event] * 20)), 1)
        self.inbox.accept({'id': ID, 'status': 'FINALIZADO_REJEICAO'})
        self.assertEqual(self.inbox.pending(), [ID])

    def test_http_requires_secret_and_commits_before_ack(self):
        server = pix_events.make_server(self.inbox, port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            def post(path, body):
                connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                connection.request('POST', path, body=body, headers={'Content-Type': 'application/json'})
                response = connection.getresponse()
                result = (response.status, response.read())
                connection.close()
                return result
            data = json.dumps({'id': ID, 'status': 'FINALIZADO_SUCESSO'})
            self.assertEqual(post('/api/sicoob-pix/wrong/lancamento', data)[0], 404)
            self.assertEqual(self.inbox.pending(), [])
            path = '/api/sicoob-pix/' + self.inbox.secret() + '/lancamento'
            self.assertEqual(post(path, 'x' * 32769)[0], 413)
            self.assertEqual(post(path, '{}')[0], 400)
            self.assertEqual(post(path, data), (200, b'{"received":true}'))
            self.assertEqual(pix_events.Inbox(self.root).pending(), [ID])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_absent_inbox_is_optional_for_existing_collector(self):
        missing = pix_events.Inbox(self.root / 'not-configured')
        self.assertEqual(missing.pending(), [])
        self.assertFalse(missing.root.exists())
