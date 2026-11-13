import tempfile
import unittest
from pathlib import Path

from unittest.mock import patch

from swile_recharges import Service, SwileError, handle_portal


class Gateway:
    def __init__(self):
        self.calls = []
        self.uncertain = False
        self.external_id = None
        self.status = 'WAITING_PAYMENT'
        self.summary_orders = []

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
                    'totalEmployees': 1, 'payerName': 'Matriz', 'payerDocument': '12345678000190',
                    'orders': self.summary_orders}
        if path == 'order/create':
            self.external_id = data['externalId']
            if self.uncertain:
                raise SwileError('Resultado incerto.', 502)
            return {'orderGroupCode': 'SWO123', 'status': 'CREATED'}
        if path == 'order/group':
            return {'last': True, 'orderGroups': [
                {'groupCode': 'OTHER', 'valueCredit': 225.05, 'totalEmployees': 1},
                {'groupCode': 'SWO123', 'valueCredit': 225.05, 'totalEmployees': 1},
            ]}
        if path == 'order/group/status/OTHER':
            return {'orderGroupCode': 'OTHER', 'status': 'WAITING_PAYMENT', 'externalId': 'unrelated'}
        if path == 'order/group/status/SWO123':
            return {'orderGroupCode': 'SWO123', 'status': self.status, 'externalId': self.external_id}
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

    def test_invoice_text_uses_the_summary_payer_without_using_swile_credit(self):
        preview = self.service.preview('user-a', self.data)
        text = 'CNO :90.025.44060/72 RUA ANTÔNIO TORRES DOS SANTOS NÚMERO 134'
        restarted = Service(self.gateway, self.database, clock=lambda: self.now)
        with patch('swile_recharges.configured_service', return_value=restarted):
            status, result = handle_portal({'oid': 'user-a'}, {
                'action': 'swile_confirm', 'id': preview['id'], 'invoiceText': text,
            })
        self.assertEqual(200, status)
        self.assertEqual('SWO123', result['swile']['orderCode'])
        payload = next(data for path, data, _ in self.gateway.calls if path == 'order/create')
        self.assertEqual([{'document': '12345678000190', 'invoiceText': text, 'swileCreditToUse': 0}],
                         payload['benefitPaymentInfo'])
        self.assertNotIn('benefitPayerDocument', payload)
        self.assertNotIn('campaignPaymentInfo', payload)
        restarted.confirm('user-a', preview['id'], 'Outro texto')
        self.assertEqual(1, sum(path == 'order/create' for path, _, _ in self.gateway.calls))

    def test_invoice_text_too_long_does_not_claim_or_create_order(self):
        preview = self.service.preview('user-a', self.data)
        with self.assertRaisesRegex(SwileError, '255'):
            self.service.confirm('user-a', preview['id'], 'á' * 256)
        self.assertFalse(any(path == 'order/create' for path, _, _ in self.gateway.calls))
        self.service.confirm('user-a', preview['id'], '')
        payload = next(data for path, data, _ in self.gateway.calls if path == 'order/create')
        self.assertNotIn('benefitPaymentInfo', payload)

    def test_legacy_unsent_preview_can_be_replaced_without_sending_an_invoice_to_a_guessed_payer(self):
        preview = self.service.preview('user-a', self.data)
        with self.service.db() as db:
            db.execute("UPDATE orders SET payload=json_remove(payload, '$.payerDocument') WHERE id=?", (preview['id'],))
        with self.assertRaisesRegex(SwileError, 'novo resumo'):
            self.service.confirm('user-a', preview['id'], 'CNO da obra')
        self.assertNotEqual(preview['id'], self.service.preview('user-a', self.data)['id'])
        self.assertFalse(any(path == 'order/create' for path, _, _ in self.gateway.calls))

    def test_rejects_duplicate_people_and_ineligible_wallet(self):
        for items in [[*self.data['items']] * 2, [{'employeeId': 30, 'amountCents': 22505}]]:
            with self.assertRaises(SwileError):
                self.service.preview('user-a', {**self.data, 'items': items})
        self.assertFalse(any(path == 'order/summary' for path, _, _ in self.gateway.calls))

    def test_two_operators_cannot_send_identical_orders(self):
        first = self.service.preview('user-a', self.data)
        second = self.service.preview('user-b', self.data)
        self.service.confirm('user-a', first['id'])
        with self.assertRaisesRegex(SwileError, 'idêntico'):
            self.service.confirm('user-b', second['id'])
        self.assertEqual([], self.service.orders('user-b'))
        self.assertEqual(1, sum(path == 'order/create' for path, _, _ in self.gateway.calls))

    def test_exact_external_reference_recovers_a_lost_create_response(self):
        self.gateway.uncertain = True
        preview = self.service.preview('user-a', self.data)
        self.service.confirm('user-a', preview['id'])
        receipts = self.service.orders('user-a', preview['id'])
        self.assertEqual('SWO123', receipts[0]['orderCode'])
        self.assertEqual('WAITING_PAYMENT', receipts[0]['status'])
        self.assertEqual('SWO123', self.service.confirm('user-a', preview['id'])['orderCode'])
        self.assertEqual(1, sum(path == 'order/create' for path, _, _ in self.gateway.calls))

    def test_confirmed_creation_error_allows_new_preview(self):
        preview = self.service.preview('user-a', self.data)
        self.service.confirm('user-a', preview['id'])
        self.gateway.status = 'CREATION_ERROR'
        self.service.orders('user-a')
        next_preview = self.service.preview('user-a', self.data)
        self.assertNotEqual(preview['id'], next_preview['id'])
        self.assertNotIn('receipt', next_preview)

    def test_summary_rejects_a_wrong_wallet_even_when_totals_match(self):
        self.gateway.summary_orders = [{'employees': [
            {'document': '12345678900', 'cardValue': {'v131': 225.05}},
        ]}]
        with self.assertRaisesRegex(SwileError, 'diverge'):
            self.service.preview('user-a', self.data)

    def test_pending_gallery_paginates_corporate_orders_and_omits_closed_groups(self):
        groups = [
            {'orderGroups': [
                {'groupCode': 'CLOSED', 'statusCode': 'APPROVED'},
                {'groupCode': 'CANCELED', 'statusCode': 'CANCELED'},
            ], 'last': False},
            {'orderGroups': [
                {'groupCode': 'PENDING', 'statusCode': 'WAITING_PAYMENT', 'valueCredit': 225.05,
                 'orders': [{'creditDate': '2026-12-02T02:00:00'}]},
                {'groupCode': 'FAILED_CREATE', 'statusCode': 'CREATION_ERROR'},
            ], 'last': True},
        ]
        with patch.object(self.gateway, 'request', side_effect=groups) as request:
            self.assertEqual([{
                'orderCode': 'PENDING', 'status': 'WAITING_PAYMENT', 'creditCents': 22505, 'creditDate': '2026-12-01',
            }], self.service.pending_orders())
        self.assertEqual([0, 1], [call.kwargs['query']['page'] for call in request.call_args_list])

    def test_pending_gallery_projects_details_without_guessing_card_or_credit_date(self):
        details = {'code': 'PARTIAL', 'statusCode': 'APPROVED_PARTIALLY', 'creditDate': '2026-12-01T03:00:00',
                   'orderList': [
                       {'statusCode': 'APPROVED', 'creditDate': '2026-12-01T03:00:00', 'totalValue': 125.05,
                        'employeeList': [{'name': 'Pessoa A', 'document': '12345678900', 'status': 'ACTIVE',
                                          'items': {'v13': 120.05, 'v5': 5}}]},
                       {'statusCode': 'APPROVED_PARTIALLY', 'creditDate': '2026-12-02T03:00:00', 'totalValue': 100,
                        'employeeList': [{'name': 'Pessoa B', 'status': 'INACTIVE', 'items': {'v13': 100}}]},
                   ]}
        with patch.object(self.gateway, 'request', return_value=details) as request, \
                patch('swile_recharges.configured_service', return_value=self.service):
            status, result = handle_portal({'oid': 'user-a'}, {
                'action': 'swile_orders', 'gallery': 'pending', 'orderCode': 'PARTIAL',
            })
        self.assertEqual(200, status)
        request.assert_called_once_with('order/group/PARTIAL')
        self.assertEqual({
            'orderCode': 'PARTIAL', 'status': 'APPROVED_PARTIALLY', 'creditCents': 22505, 'creditDate': '2026-12-01',
            'items': [
                {'name': 'Pessoa A', 'amountCents': 12505, 'status': 'APPROVED', 'creditDate': '2026-12-01'},
                {'name': 'Pessoa B', 'amountCents': 10000, 'status': None, 'orderStatus': 'APPROVED_PARTIALLY',
                 'creditDate': '2026-12-02'},
            ],
        }, result['swile'])

    def test_pending_gallery_cannot_open_a_completed_order_by_code(self):
        with patch.object(self.gateway, 'request', return_value={
            'code': 'CLOSED', 'statusCode': 'APPROVED', 'orderList': [],
        }), patch('swile_recharges.configured_service', return_value=self.service):
            status, result = handle_portal({'oid': 'user-a'}, {
                'action': 'swile_orders', 'gallery': 'pending', 'orderCode': 'CLOSED',
            })
        self.assertEqual(404, status)
        self.assertNotIn('swile', result)

    def test_history_lists_and_opens_corporate_orders_missing_from_the_local_journal(self):
        groups = [
            {'orderGroups': [{'groupCode': 'OLD', 'statusCode': 'APPROVED', 'valueCredit': 50,
                              'requestDate': '2026-03-16T12:53:49', 'orders': []}], 'last': False},
            {'orderGroups': [{'groupCode': 'CANCEL', 'statusCode': 'CANCELED', 'valueCredit': 60,
                              'requestDate': '2026-11-10T01:12:32', 'orders': []}], 'last': True},
        ]
        detail = {'code': 'OLD', 'statusCode': 'APPROVED', 'orderList': [{'statusCode': 'APPROVED',
                  'totalValue': 50, 'employeeList': [{'name': 'Pessoa A', 'document': '12345678900',
                  'email': 'private@example.test', 'items': {'v13': 50}}]}]}
        with patch.object(self.gateway, 'request', side_effect=[*groups, detail]) as gateway, \
                patch('swile_recharges.configured_service', return_value=self.service):
            body = {'action': 'swile_orders', 'gallery': 'history'}
            status, response = handle_portal({'oid': 'user-a'}, body)
            self.assertEqual(200, status)
            self.assertEqual(['CANCEL', 'OLD'], [o['orderCode'] for o in response['swile']])
            self.assertEqual('2026-11-09', response['swile'][0]['requestDate'])
            status, response = handle_portal({'oid': 'user-a'}, {**body, 'orderCode': 'OLD'})
            self.assertEqual(200, status)
            self.assertEqual('APPROVED', response['swile']['status'])
            self.assertEqual({'name': 'Pessoa A', 'amountCents': 5000, 'status': 'APPROVED', 'creditDate': None},
                             response['swile']['items'][0])
            self.assertEqual([0, 1], [call.kwargs['query']['page'] for call in gateway.call_args_list[:2]])
        self.assertFalse(self.database.exists())


if __name__ == '__main__':
    unittest.main()
