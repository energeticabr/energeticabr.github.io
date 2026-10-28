import copy
import unittest
from datetime import datetime, timezone

try:
    import dda_manual_payment as payment
except ModuleNotFoundError:
    payment = None

KEY = 'a' * 64
IDENTITY = {'oid': 'owner-id', 'email': 'owner@example.com'}
BODY = {'action': 'dda_payment_confirm', 'itemId': 7, 'key': KEY}
SCOPE = {'company': '12345678000190', 'listId': '11111111-2222-3333-4444-555555555555',
         'siteHost': 'example.sharepoint.com', 'sitePath': 'sites/example'}


class Conflict(Exception):
    pass


class FakeRepository:
    def __init__(self):
        self.company = SCOPE['company']
        self.row = {'Id': 7, 'CHAVE_DDA': KEY, 'CNPJ_PAGADOR': '12345678000190',
                    'SITUACAO': 'Em aberto', 'STATUS_DDA': 'OPEN', 'PGTO_CONFIRMADO': False,
                    'PGTO_CONFIRMADO_EM': None, 'PGTO_CONFIRMADO_POR': None, '_etag': '"1"'}
        self.writes = []
        self.reads = 0
        self.race = None
        self.discard_write = False

    def read(self, item_id):
        self.reads += 1
        return copy.deepcopy(self.row)

    def confirm(self, item_id, fields, etag):
        self.writes.append((item_id, copy.deepcopy(fields), etag))
        if self.race:
            race, self.race = self.race, None
            race(self.row)
            raise payment.ConcurrentUpdate()
        if etag != self.row['_etag']:
            raise payment.ConcurrentUpdate()
        if not self.discard_write:
            self.row.update(fields)
            self.row['_etag'] = '"2"'


class ManualPaymentTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(payment, 'manual confirmation backend is not implemented')
        self.repo = FakeRepository()
        self.allowed = {'owner@example.com'}

    def call(self, body=None, identity=None):
        return payment.handle_portal(identity or IDENTITY, body or BODY, self.repo,
                                     allowed_emails=self.allowed,
                                     now=lambda: datetime(2026, 10, 28, 13, 45, tzinfo=timezone.utc))

    def test_confirms_only_override_fields_with_server_actor_and_readback(self):
        result = self.call()['ddaPaymentConfirmation']
        self.assertEqual(result, {'status': 'confirmed', 'itemId': 7, 'key': KEY,
                                 'confirmedAt': '2026-10-28T13:45:00Z', 'confirmedBy': 'owner@example.com'})
        self.assertEqual(self.repo.writes, [(7, {'PGTO_CONFIRMADO': True,
                           'PGTO_CONFIRMADO_EM': '2026-10-28T13:45:00Z',
                           'PGTO_CONFIRMADO_POR': 'owner@example.com'}, '"1"')])
        self.assertEqual(self.repo.reads, 2)
        self.assertEqual(self.repo.row['SITUACAO'], 'Em aberto')
        self.assertEqual(self.repo.row['STATUS_DDA'], 'OPEN')

    def test_repeat_preserves_first_audit(self):
        first = self.call()
        self.allowed.add('second@example.com')
        self.assertEqual(self.call(identity={'oid': 'second', 'email': 'second@example.com'}), first)
        self.assertEqual(len(self.repo.writes), 1)

    def test_denies_missing_identity_and_non_owner_before_reading(self):
        for identity in ({'email': 'owner@example.com'}, {'oid': 'other', 'email': 'other@example.com'}):
            with self.assertRaises(PermissionError):
                self.call(identity=identity)
        self.assertEqual(self.repo.reads, 0)

    def test_rejects_malformed_and_forged_actor_payloads(self):
        for delta in ({'itemId': True}, {'itemId': 0}, {'itemId': '7'}, {'itemId': 2147483648},
                      {'key': 'bad'}, {'confirmedBy': 'attacker@example.com'}, {'action': 'other'}):
            with self.subTest(delta=delta), self.assertRaises(ValueError):
                self.call(body={**BODY, **delta})
        self.assertEqual(self.repo.reads, 0)

    def test_rejects_wrong_key_company_or_item_before_write(self):
        for field, value in [('CHAVE_DDA', 'b' * 64), ('CNPJ_PAGADOR', '00000000000000'), ('Id', 8)]:
            self.repo = FakeRepository()
            self.repo.row[field] = value
            with self.assertRaises(PermissionError):
                self.call()
            self.assertEqual(self.repo.writes, [])

    def test_missing_etag_fails_closed(self):
        self.repo.row.pop('_etag')
        with self.assertRaises(RuntimeError):
            self.call()
        self.assertEqual(self.repo.writes, [])

    def test_failed_readback_never_reports_success(self):
        self.repo.discard_write = True
        with self.assertRaises(RuntimeError):
            self.call()

    def test_concurrent_first_confirmation_wins(self):
        self.repo.race = lambda row: row.update(PGTO_CONFIRMADO=True,
                    PGTO_CONFIRMADO_EM='2026-10-28T13:44:00Z', PGTO_CONFIRMADO_POR='first@example.com')
        result = self.call()['ddaPaymentConfirmation']
        self.assertEqual(result['confirmedBy'], 'first@example.com')
        self.assertEqual(result['confirmedAt'], '2026-10-28T13:44:00Z')
        self.assertEqual(len(self.repo.writes), 1)

    def test_collector_concurrency_retries_with_fresh_etag(self):
        self.repo.race = lambda row: row.update(_etag='"9"', SITUACAO='Vencido')
        self.call()
        self.assertEqual([write[2] for write in self.repo.writes], ['"1"', '"9"'])
        self.assertEqual(self.repo.row['SITUACAO'], 'Vencido')

    def test_corrupt_existing_audit_does_not_get_overwritten(self):
        self.repo.row['PGTO_CONFIRMADO'] = True
        with self.assertRaises(RuntimeError):
            self.call()
        self.assertEqual(self.repo.writes, [])

    def test_readback_must_match_written_actor_and_time(self):
        original = self.repo.confirm
        def corrupt(*args):
            original(*args)
            self.repo.row['PGTO_CONFIRMADO_POR'] = 'different@example.com'
        self.repo.confirm = corrupt
        with self.assertRaises(RuntimeError):
            self.call()


class FakeClient:
    def __init__(self):
        self.requests = []
        self.error = None

    def _request(self, method, endpoint, **kwargs):
        self.requests.append((method, endpoint, kwargs))
        if self.error:
            raise self.error
        return {'d': {'Id': 7, '__metadata': {'etag': '"4"'}}}


class AdapterTests(unittest.TestCase):
    def test_reads_exact_fixed_list_and_preserves_etag(self):
        client = FakeClient()
        row = payment.SharePointRepository(client, SCOPE).read(7)
        self.assertEqual(row['_etag'], '"4"')
        method, endpoint, args = client.requests[0]
        self.assertEqual(method, 'GET')
        self.assertEqual(endpoint, "web/lists(guid'11111111-2222-3333-4444-555555555555')/items(7)")
        self.assertEqual(args['headers']['Accept'], 'application/json;odata=verbose')

    def test_merge_uses_supplied_etag_and_never_wildcard(self):
        client = FakeClient()
        repository = payment.SharePointRepository(client, SCOPE)
        fields = {'PGTO_CONFIRMADO': True, 'PGTO_CONFIRMADO_EM': '2026-10-28T00:00:00Z',
                  'PGTO_CONFIRMADO_POR': 'owner@example.com'}
        repository.confirm(7, fields, '"4"')
        self.assertEqual(client.requests[0][2]['headers']['IF-MATCH'], '"4"')
        self.assertEqual(client.requests[0][2]['json'], fields)
        with self.assertRaises(ValueError):
            repository.confirm(7, fields, '*')
        with self.assertRaises(ValueError):
            repository.confirm(7, {**fields, 'SITUACAO': 'Pago'}, '"4"')

    def test_http_precondition_failure_becomes_concurrent_update(self):
        client = FakeClient()
        client.error = Exception('response body must never be exposed')
        client.error.response = type('Response', (), {'status_code': 412})()
        with self.assertRaises(payment.ConcurrentUpdate):
            payment.SharePointRepository(client, SCOPE).confirm(7, dict.fromkeys(payment.AUDIT_FIELDS), '"4"')


if __name__ == '__main__':
    unittest.main()
