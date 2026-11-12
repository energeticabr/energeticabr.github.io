import tempfile
import unittest
from pathlib import Path

from swile_recharges import Service, SwileError


class Gateway:
    def __init__(self):
        self.calls = []
        self.uncertain = False

    def request(self, path, *, data=None, query=None):
        self.calls.append((path, data, query))
        if path == 'workgroup':
            return {'last': True, 'workgroups': [
                {'idWorkGroup': 1, 'cardTypes': ['v13'], 'branchName': 'Matriz'},
                {'idWorkGroup': 2, 'cardTypes': ['v131']},
            ]}
        if path == 'employee':
            page = query['page']
            return {'last': page == 1, 'employees': [
                {'idEmployee': 10 + page, 'name': f'Pessoa {page}',
                 'status': 'KEEP_ACTIVE', 'hasActiveCard': page == 0,
                 'idWorkGroup': 1, 'document': f'1234567890{page}', 'kycStatus': 'APPROVED'},
                {'idEmployee': 30, 'name': 'Outro produto', 'idWorkGroup': 2,
                 'status': 'ACTIVE', 'document': '33333333333'},
                {'idEmployee': 40, 'name': 'Cadastro inativo', 'idWorkGroup': 1,
                 'status': 'INACTIVE', 'document': '44444444444'},
            ]}
        if path == 'order/summary':
            return {'summaryId': 'SUM1', 'valueCredit': 225.05, 'valuePayment': 226.05,
                    'totalEmployees': 1, 'payerName': 'Matriz', 'payerDocument': '12345678000190'}
        if path == 'order/create':
            if self.uncertain:
                raise SwileError('Resultado incerto.', 502)
            return {'orderGroupCode': 'SWO123', 'status': 'CREATED'}
        if path == 'order/group/status/SWO123':
            return {'orderGroupCode': 'SWO123', 'status': 'WAITING_PAYMENT'}
        raise AssertionError(path)


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.gateway = Gateway()
        self.database = Path(self.temp.name) / 'journal.sqlite'
        self.now = 1794500000
        self.service = Service(self.gateway, self.database, clock=lambda: self.now)
        self.data = {'items': [{'employeeId': 10, 'amountCents': 22505}],
                     'creditDate': '2026-12-01', 'paymentMethod': 'PIX'}

    def test_directory_paginates_and_returns_only_eligible_public_fields(self):
        records = self.service.directory(public=True)
        self.assertEqual([10, 11], [row['id'] for row in records])
        self.assertEqual([True, False], [row['hasActiveCard'] for row in records])
        self.assertNotIn('document', records[0])
        self.assertTrue(self.gateway.calls[1][2]['withActiveCard'])

    def test_summary_fixes_wallet_and_confirmation_is_durable_and_owner_bound(self):
        preview = self.service.preview('user-a', self.data)
        request = next(data for path, data, _ in self.gateway.calls if path == 'order/summary')
        self.assertEqual({'document': '12345678900', 'cardValues': [{'card': 'v13', 'value': 225.05}]},
                         request['data'][0])
        self.assertEqual(22605, preview['paymentCents'])
        with self.assertRaises(SwileError):
            self.service.confirm('user-b', preview['id'])
        receipt = self.service.confirm('user-a', preview['id'])
        again = Service(self.gateway, self.database, clock=lambda: self.now)
        self.assertEqual(receipt, again.confirm('user-a', preview['id']))
        self.assertEqual('WAITING_PAYMENT', again.orders('user-a')[0]['status'])
        self.assertEqual(1, sum(path == 'order/create' for path, _, _ in self.gateway.calls))

    def test_unknown_create_is_not_retried_even_after_new_preview(self):
        self.gateway.uncertain = True
        preview = self.service.preview('user-a', self.data)
        self.assertEqual('UNCONFIRMED', self.service.confirm('user-a', preview['id'])['status'])
        self.assertEqual('UNCONFIRMED', self.service.preview('user-a', self.data)['receipt']['status'])
        self.assertEqual('UNCONFIRMED', self.service.confirm('user-a', preview['id'])['status'])
        self.assertEqual(1, sum(path == 'order/create' for path, _, _ in self.gateway.calls))

    def test_rejects_duplicate_people_and_ineligible_wallet(self):
        for items in [[*self.data['items']] * 2, [{'employeeId': 30, 'amountCents': 22505}]]:
            with self.assertRaises(SwileError):
                self.service.preview('user-a', {**self.data, 'items': items})
        self.assertFalse(any(path == 'order/summary' for path, _, _ in self.gateway.calls))


if __name__ == '__main__':
    unittest.main()
