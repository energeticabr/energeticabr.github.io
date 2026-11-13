from contextlib import contextmanager
from pathlib import Path
import tempfile
import unittest

from trancid_recharges import GatewayError, Service
from trancid_portal_adapter import PortalError, PortalUncertain


class FakePortal:
    def __init__(self):
        self.submissions = []
        self.failure = None
        self.history_orders = []

    @contextmanager
    def connect(self):
        yield self

    def directory(self):
        return [{'id': 'portal-1234', 'name': 'Colaborador', 'cardLast4': '1234'},
                {'id': 'portal-5678', 'name': 'Outra Pessoa', 'cardLast4': '5678'}]

    def history(self, page):
        return {'orders': self.history_orders, 'page': page, 'hasMore': page == 1}

    def submit(self, items, payment_method, *, on_draft):
        self.submissions.append((items, payment_method))
        if self.failure:
            raise self.failure
        on_draft('789805')
        return {'orderCode': '789805', 'creditCents': 5500, 'status': 'Enviado', 'paymentMethod': 'BOLETO', 'totalCents': 5555}


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.database = Path(self.folder.name) / 'orders.sqlite'
        self.portal = FakePortal()
        self.now = 1000
        self.service = self.new_service()
        self.public_id = self.service.directory()[0]['id']
        self.body = {'items': [{'id': self.public_id, 'amountCents': 5500}], 'paymentMethod': 'BOLETO'}

    def new_service(self):
        return Service(self.portal.connect, self.database, b'test key', clock=lambda: self.now)

    def test_owner_bound_confirmation_and_durable_receipt(self):
        preview = self.service.preview('owner', self.body)
        self.assertNotEqual(self.public_id, 'portal-1234')
        self.assertEqual(preview['items'], [{'name': 'Colaborador', 'cardLast4': '1234', 'amountCents': 5500}])
        self.assertEqual((preview['creditCents'], preview['feeCents'], preview['totalCents']), (5500, 55, 5555))
        with self.assertRaises(GatewayError):
            self.service.confirm('other', preview['id'])
        self.assertEqual(self.portal.submissions, [])
        receipt = self.service.confirm('owner', preview['id'])
        self.assertEqual(receipt['orderCode'], '789805')
        self.assertEqual(receipt['status'], 'SUBMITTED')
        self.assertEqual(self.new_service().confirm('owner', preview['id']), receipt)
        self.assertEqual(self.portal.submissions, [([{'id': 'portal-1234', 'amountCents': 5500}], 'BOLETO')])

    def test_confirmed_portal_order_does_not_require_a_final_total(self):
        preview = self.service.preview('owner', self.body)
        self.portal.submit = lambda *_, **__: {'orderCode': '789805', 'creditCents': 5500, 'status': 'Enviado', 'paymentMethod': 'BOLETO'}
        receipt = self.service.confirm('owner', preview['id'])
        self.assertEqual(receipt['status'], 'SUBMITTED')
        self.assertIsNone(receipt['totalCents'])

    def test_identical_cross_session_confirmation_does_not_resend(self):
        first = self.service.preview('owner', self.body)
        second = self.service.preview('other', self.body)
        self.service.confirm('owner', first['id'])
        with self.assertRaises(GatewayError):
            self.new_service().confirm('other', second['id'])
        self.assertEqual(len(self.portal.submissions), 1)

    def test_uncertain_receipt_keeps_provider_reference_and_blocks_resend(self):
        preview = self.service.preview('owner', self.body)
        self.portal.failure = PortalUncertain('unverified', order_code='789806')
        receipt = self.service.confirm('owner', preview['id'])
        self.assertEqual((receipt['status'], receipt['orderCode']), ('UNCONFIRMED', '789806'))
        self.now += 3600
        self.assertEqual(self.new_service().confirm('owner', preview['id']), receipt)
        with self.assertRaises(GatewayError):
            self.service.confirm('owner', self.service.preview('owner', self.body)['id'])
        self.assertEqual(len(self.portal.submissions), 1)

    def test_history_reconciles_only_exact_provider_order_and_matching_credits(self):
        preview = self.service.preview('owner', self.body)
        self.portal.failure = PortalUncertain('unverified', order_code='789806')
        self.service.confirm('owner', preview['id'])
        self.now += 3600
        self.portal.history_orders = [{'orderCode': '789806', 'creditCents': 5500, 'paymentMethod': 'BOLETO', 'status': 'Gravado'}]
        self.service.history(1)
        self.assertEqual(self.service.confirm('owner', preview['id'])['status'], 'UNCONFIRMED')
        self.portal.history_orders[0].update(status='Enviado', creditCents=6600)
        self.service.history(1)
        self.assertEqual(self.service.confirm('owner', preview['id'])['status'], 'UNCONFIRMED')
        self.portal.history_orders[0]['creditCents'] = 5500
        self.service.history(1)
        self.assertEqual(self.service.confirm('owner', preview['id'])['status'], 'SUBMITTED')
        self.assertEqual(len(self.portal.submissions), 1)

    def test_gallery_recovers_receipt_when_process_exits_after_provider_send(self):
        preview = self.service.preview('owner', self.body)

        def send_then_exit(items, payment_method, *, on_draft):
            on_draft('789807')
            raise SystemExit()

        self.portal.submit = send_then_exit
        with self.assertRaises(SystemExit):
            self.service.confirm('owner', preview['id'])
        restarted = self.new_service()
        self.assertEqual(restarted.confirm('owner', preview['id'])['orderCode'], '789807')
        self.portal.history_orders = [{'orderCode': '789807', 'creditCents': 5500, 'paymentMethod': 'BOLETO', 'status': 'Enviado'}]
        restarted.history(1)
        self.assertEqual(restarted.confirm('owner', preview['id'])['status'], 'SUBMITTED')

    def test_prewrite_failure_allows_explicit_retry(self):
        preview = self.service.preview('owner', self.body)
        self.portal.failure = PortalError('Portal indisponível.')
        with self.assertRaises(PortalError):
            self.service.confirm('owner', preview['id'])
        self.portal.failure = None
        self.assertEqual(self.service.confirm('owner', preview['id'])['status'], 'SUBMITTED')

    def test_directory_and_amount_validation_before_submission(self):
        second = self.service.directory()[1]['id']
        for items in ([], [self.body['items'][0]] * 2,
                      [{'id': 'fake', 'amountCents': 5500}],
                      [{'id': self.public_id, 'amountCents': True}],
                      [self.body['items'][0], {'id': second, 'amountCents': 2500}]):
            with self.subTest(items=items), self.assertRaises(GatewayError):
                self.service.preview('owner', {**self.body, 'items': items})
        self.assertEqual(self.portal.submissions, [])
        self.assertEqual(self.service.history(2), {'orders': [], 'page': 2, 'hasMore': False})

    def test_expired_preview_never_calls_provider(self):
        preview = self.service.preview('owner', self.body)
        self.now += 1801
        with self.assertRaises(GatewayError):
            self.service.confirm('owner', preview['id'])
        self.assertEqual(self.portal.submissions, [])


if __name__ == '__main__':
    unittest.main()
