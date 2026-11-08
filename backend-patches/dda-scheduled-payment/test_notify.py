import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from notify import deliver, fetch_rows


GROUP = '1234567890@g.us'
PAYER = '12345678901234'
LIST = '11111111-2222-3333-4444-555555555555'


def row(item=9, **changes):
    return {'Id': item, 'Title': 'Fornecedor Exemplo', 'VALOR': '1200.50',
            'CHAVE_DDA': 'a' * 64, 'CNPJ_PAGADOR': PAYER,
            'DDA_CICLO_AGENDAMENTO': 'PAGO_AGENDADO', **changes}


class ScheduledPaymentNotificationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.db = Path(temporary.name) / 'test.db'
        with closing(sqlite3.connect(self.db)) as db, db:
            db.executescript("""
                CREATE TABLE gateway_outbox(id INTEGER PRIMARY KEY, message BLOB, created_at INTEGER);
                CREATE TABLE gateway_completion_messages(completion_id TEXT, chat_id TEXT, message_id TEXT);
            """)

    def test_only_confirmed_schedule_queues_once_and_counts_actual_delivery(self):
        result = deliver(self.db, GROUP, PAYER, [
            row(), row(10, CHAVE_DDA='b' * 64, DDA_CICLO_AGENDAMENTO='AGENDADO'),
            row(11, CHAVE_DDA='c' * 64, CNPJ_PAGADOR='43210987654321'),
        ])
        self.assertEqual(result, {'new': 1, 'queued': 1, 'sent': 0, 'unconfirmed': 0})
        with closing(sqlite3.connect(self.db)) as db, db:
            item, payload = db.execute('SELECT id, message FROM gateway_outbox').fetchone()
            message = json.loads(payload)
            self.assertEqual(message['group_id'], GROUP)
            self.assertIn('*PAGAMENTO AGENDADO CONFIRMADO*', message['text'])
            self.assertIn('R$ 1.200,50', message['text'])
            self.assertIn('DDA #9', message['text'])
            self.assertTrue(message['trackCompletionSuccess'])
            db.execute('DELETE FROM gateway_outbox WHERE id=?', (item,))
        self.assertEqual(deliver(self.db, GROUP, PAYER, [row()])['unconfirmed'], 1)
        with closing(sqlite3.connect(self.db)) as db, db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM gateway_outbox').fetchone()[0], 0)
            db.execute('INSERT INTO gateway_completion_messages VALUES(?,?,?)',
                       (message['completionId'], GROUP, 'real-receipt'))
        self.assertEqual(deliver(self.db, GROUP, PAYER, [row()])['sent'], 1)

    def test_group_change_cannot_redirect_a_previously_queued_payment(self):
        deliver(self.db, GROUP, PAYER, [row()])
        with self.assertRaisesRegex(ValueError, 'DESTINATION_CHANGED'):
            deliver(self.db, '9999999999@g.us', PAYER, [row()])
        with closing(sqlite3.connect(self.db)) as db, db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM gateway_outbox').fetchone()[0], 1)

    def test_reused_outbox_row_id_does_not_count_as_pending_delivery(self):
        deliver(self.db, GROUP, PAYER, [row()])
        with closing(sqlite3.connect(self.db)) as db, db:
            item = db.execute('SELECT id FROM gateway_outbox').fetchone()[0]
            db.execute('DELETE FROM gateway_outbox WHERE id=?', (item,))
            db.execute('INSERT INTO gateway_outbox VALUES(?,?,?)',
                       (item, json.dumps({'completionId': 'different-event'}), 1))
        self.assertEqual(deliver(self.db, GROUP, PAYER, [row()])['unconfirmed'], 1)

    def test_reads_after_short_page_until_empty(self):
        pages = iter([{'value': [row(9)]}, {'value': [row(14, CHAVE_DDA='b' * 64)]}, {'value': []}])
        queries = []

        def request(method, path, *, params):
            self.assertEqual(method, 'GET')
            self.assertIn(LIST, path)
            queries.append(params['$filter'])
            return next(pages)

        self.assertEqual([item['Id'] for item in fetch_rows(request, LIST)], [9, 14])
        self.assertEqual([query.split(' and ')[0] for query in queries],
                         ['Id gt 0', 'Id gt 9', 'Id gt 14'])

    def test_outbox_and_ledger_rollback_together(self):
        with closing(sqlite3.connect(self.db)) as db, db:
            db.execute("""CREATE TRIGGER test_failure BEFORE INSERT ON gateway_outbox
                          WHEN (SELECT COUNT(*) FROM gateway_outbox)>0
                          BEGIN SELECT RAISE(ABORT, 'fake write failure'); END""")
        with self.assertRaises(sqlite3.IntegrityError):
            deliver(self.db, GROUP, PAYER, [row(), row(10, CHAVE_DDA='b' * 64)])
        with closing(sqlite3.connect(self.db)) as db, db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM gateway_outbox').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM dda_scheduled_payment_notices').fetchone()[0], 0)
