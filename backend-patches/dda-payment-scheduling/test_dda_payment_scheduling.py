from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event
import unittest

from dda_payment_scheduling import Scheduling, handle_portal

KEY = 'a' * 64
BARCODE = '1' * 44
COMPANY = '2' * 14
IDENTITY = {'oid': 'finance-operator'}
DATE = '2026-12-04'


class Repository:
    company = COMPANY

    def read(self, item_id):
        return {'Id': item_id, 'CHAVE_DDA': KEY, 'CNPJ_PAGADOR': COMPANY,
                'CODIGO_BARRAS': BARCODE, 'VENCIMENTO': '2026-12-05', 'STATUS_DDA': 'Em aberto'}


class Bank:
    def __init__(self):
        self.calls = []
        self.release = None
        self.started = Event()
        self.outcome = {'status': 'scheduled', 'paymentId': 27}
        self.lookup_result = {'status': 'pending'}
        self.can_confirm = True

    def __call__(self, operation, payload):
        self.calls.append((operation, payload.copy()))
        if operation == 'quote':
            return {'status': 'quoted', 'date': DATE, 'amountCents': 53042,
                    'beneficiary': 'Beneficiário de teste', 'canConfirm': self.can_confirm,
                    'bankQuote': {'identifier': 'verified'}, 'configuration': 'same'}
        if operation == 'dispatch':
            self.started.set()
            if self.release:
                self.release.wait(4)
            return self.outcome
        if operation == 'lookup':
            return self.lookup_result
        raise AssertionError(operation)


class SchedulingTests(unittest.TestCase):
    def setUp(self):
        storage = TemporaryDirectory()
        self.addCleanup(storage.cleanup)
        self.bank = Bank()
        self.service = Scheduling(Path(storage.name) / 'state.db', bank=self.bank,
                                  today=lambda: date(2026, 11, 27))
        self.repository = Repository()

    def call(self, operation, *, identity=IDENTITY, authorize=lambda identity: identity['oid'], **body):
        return handle_portal(identity, {'action': 'dda_schedule_' + operation, **body},
                             self.repository, service=self.service, authorize=authorize)['ddaSchedule']

    def quote(self, day=DATE):
        return self.call('quote', itemId=12, key=KEY, date=day)

    def test_quote_uses_the_authoritative_barcode_and_omits_private_banking_data(self):
        quote = self.quote()
        self.assertEqual(self.bank.calls, [('quote', {
            'barcode': BARCODE, 'company': COMPANY, 'date': DATE, 'due': '2026-12-05'})])
        self.assertEqual(quote['amountCents'], 53042)
        self.assertTrue(quote['canConfirm'])
        self.assertNotIn('bankQuote', quote)
        self.assertNotIn('configuration', quote)

    def test_today_is_not_an_agendamento_and_never_calls_the_bank(self):
        with self.assertRaises(ValueError):
            self.quote('2026-11-27')
        self.assertEqual(self.bank.calls, [])

    def test_read_only_quote_cannot_be_used_to_send_order(self):
        self.bank.can_confirm = False
        quote = self.quote()
        self.assertFalse(quote['canConfirm'])
        self.assertNotIn('quoteId', quote)
        self.assertEqual([operation for operation, _ in self.bank.calls], ['quote'])

    def test_uncertain_dispatch_reconciles_by_the_same_key_without_sending_again(self):
        self.bank.outcome = {'status': 'pending'}
        quote_id = self.quote()['quoteId']
        self.assertEqual(self.call('confirm', quoteId=quote_id)['status'], 'pending')
        self.bank.lookup_result = {'status': 'scheduled', 'paymentId': 27}
        self.assertEqual(self.call('confirm', quoteId=quote_id)['status'], 'scheduled')
        dispatch, lookup = self.bank.calls[1:]
        self.assertEqual((dispatch[0], lookup[0]), ('dispatch', 'lookup'))
        self.assertEqual(dispatch[1]['orderKey'], lookup[1]['orderKey'])
        self.assertEqual(self.call('list')['entries'][0]['date'], DATE)
        self.assertEqual([op for op, _ in self.bank.calls].count('dispatch'), 1)

    def test_concurrent_confirmation_claims_the_boleto_once(self):
        self.bank.release = Event()
        quote_a = self.quote()['quoteId']
        quote_b = self.quote()['quoteId']
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(self.call, 'confirm', quoteId=quote_a)
            try:
                self.assertTrue(self.bank.started.wait(4))
                self.assertEqual(self.call('confirm', quoteId=quote_b)['status'], 'pending')
            finally:
                self.bank.release.set()
            self.assertEqual(first.result()['status'], 'scheduled')
        self.assertEqual([op for op, _ in self.bank.calls].count('dispatch'), 1)

    def test_another_identity_cannot_reuse_the_quote(self):
        quote_id = self.quote()['quoteId']
        with self.assertRaises(PermissionError):
            self.call('confirm', identity={'oid': 'other-operator'}, quoteId=quote_id)
        self.assertEqual([op for op, _ in self.bank.calls], ['quote'])


if __name__ == '__main__':
    unittest.main()
