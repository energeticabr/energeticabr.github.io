import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from sicoob_sync import Queue


class SicoobBalanceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        (root / 'access.json').write_text(json.dumps({'emails': ['finance@example.com']}))
        self.queue = Queue(root)
        self.identity = {'oid': 'test-user', 'email': 'finance@example.com'}
        self.body = {'action': 'sicoob_balance'}

    def test_normalizes_bank_money_and_checks_authorization_even_when_cached(self):
        from sicoob_balance import SicoobBalance, handle_portal

        with patch('sicoob_balance.subprocess.run', return_value=subprocess.CompletedProcess([], 0, '-1234,56\n')) as bank:
            service = SicoobBalance()
            read = lambda identity, body: handle_portal(identity, body, queue=self.queue, service=service)
            result = read(self.identity, self.body)['sicoobBalance']
            self.assertEqual(result['balanceCents'], -123456)
            self.assertRegex(result['asOf'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')
            self.assertEqual(read(self.identity, self.body)['sicoobBalance'], result)
            with self.assertRaises(PermissionError):
                read({'oid': 'other', 'email': 'other@example.com'}, self.body)
            with self.assertRaises(ValueError):
                read(self.identity, {**self.body, 'account': '999'})
            self.assertEqual(bank.call_count, 1)

    def test_invalid_bank_response_is_unavailable_and_zero_can_be_read_afterward(self):
        from sicoob_balance import SicoobBalance, handle_portal

        now = 0
        with patch('sicoob_balance.subprocess.run', side_effect=[subprocess.CompletedProcess([], 0, '\n'),
                                                               subprocess.CompletedProcess([], 0, '0.00\n')]):
            service = SicoobBalance(clock=lambda: now)
            self.assertIsNone(handle_portal(self.identity, self.body, queue=self.queue, service=service)['sicoobBalance'])
            self.assertIsNone(handle_portal(self.identity, self.body, queue=self.queue, service=service)['sicoobBalance'])
            now += 30
            self.assertEqual(handle_portal(self.identity, self.body, queue=self.queue, service=service)['sicoobBalance']['balanceCents'], 0)
