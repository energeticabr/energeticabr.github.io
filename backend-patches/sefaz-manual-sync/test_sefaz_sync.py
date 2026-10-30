import importlib.util
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

MODULE = Path(__file__).with_name('sefaz_sync.py')
OWNER = {'oid': 'owner', 'email': 'owner@example.test'}
OTHER = {'oid': 'other', 'email': 'other@example.test'}


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(MODULE.exists(), 'Durable fiscal queue has not been implemented')
        spec = importlib.util.spec_from_file_location('sefaz_sync', MODULE)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.now = 1900000000.0
        self.q = self.module.Queue(self.root, clock=lambda: self.now)

    def start(self, request_id='a'*32, owner=OWNER):
        return self.q.start(owner, request_id)

    def claim(self):
        return self.q.worker('claim')['job']

    def progress(self, job, source, result):
        return self.q.worker('progress', {'requestId': job['requestId'], 'leaseToken': job['leaseToken'], 'source': source, 'result': result})

    def finish(self, job):
        return self.q.worker('complete', {k: job[k] for k in ('requestId', 'leaseToken')})

    def succeed(self, job):
        for source in ('NFE', 'CTE', 'NFSE'):
            self.progress(job, source, {'status': 'succeeded', 'documents': 0})
        return self.finish(job)

    def test_created_item_ids_are_optional_canonical_deduplicated_safe_integers(self):
        self.assertEqual(self.q.result({'status': 'succeeded', 'documents': 8}),
                         {'status': 'succeeded', 'documents': 8})
        value = {'status': 'succeeded', 'createdItemIds': [42, 7, 42, 9007199254740991]}
        result = self.q.result(value)
        self.assertEqual(result['createdItemIds'], [42, 7, 9007199254740991])
        self.assertEqual(value['createdItemIds'], [42, 7, 42, 9007199254740991])
        self.assertEqual(self.q.result({'status': 'succeeded', 'createdItemIds': []})['createdItemIds'], [])
        for ids in (None, '42', {}, [0], [-1], [True], [1.0], ['42'], [9007199254740992], [[42]]):
            with self.subTest(ids=ids), self.assertRaises(ValueError):
                self.q.result({'status': 'succeeded', 'createdItemIds': ids})

    def test_confirmed_created_ids_survive_progress_restart_owner_polling_and_reply_replay(self):
        self.start()
        job = self.claim()
        self.progress(job, 'NFE', {'status': 'waiting', 'documents': 12, 'createdItemIds': [42, 7, 42]})
        # An older worker or a status-only progress event cannot erase durable creation evidence.
        self.progress(job, 'NFE', {'status': 'running', 'documents': 12})
        self.progress(job, 'NFE', {'status': 'succeeded', 'documents': 15, 'createdItemIds': [7, 99]})
        self.progress(job, 'CTE', {'status': 'succeeded', 'documents': 9})
        self.progress(job, 'NFSE', {'status': 'failed', 'createdItemIds': [101]})
        self.finish(job)
        restarted = self.module.Queue(self.root, clock=lambda: self.now)
        receipt = restarted.pending(OWNER)['requests'][0]
        self.assertEqual(receipt['sources']['NFE']['createdItemIds'], [42, 7, 99])
        self.assertEqual(receipt['sources']['NFSE']['createdItemIds'], [101])
        self.assertNotIn('createdItemIds', receipt['sources']['CTE'])
        self.assertEqual(restarted.status(OWNER, job['requestId']), receipt)
        self.assertEqual(restarted.pending(OTHER)['requests'], [])
        with self.assertRaises(PermissionError):
            restarted.status(OTHER, job['requestId'])
        self.progress(job, 'NFE', {'status': 'succeeded', 'documents': 15, 'createdItemIds': [7, 99, 7]})
        with self.assertRaises(ValueError):
            self.progress(job, 'NFE', {'status': 'succeeded', 'documents': 15, 'createdItemIds': [100]})

    def test_invalid_created_ids_never_commit_or_leak_extra_receipt_fields(self):
        self.start()
        job = self.claim()
        before = (self.root / 'state.json').read_bytes()
        for value in ({'status': 'succeeded', 'createdItemIds': ['123']},
                      {'status': 'succeeded', 'createdItemIds': [123], 'private': 'not-public'}):
            with self.assertRaises(ValueError):
                self.progress(job, 'NFE', value)
            self.assertEqual((self.root / 'state.json').read_bytes(), before)

    def test_unknown_progress_revokes_empty_creation_evidence_but_keeps_positive_ids(self):
        self.start()
        job = self.claim()
        self.progress(job, 'NFE', {'status': 'running', 'createdItemIds': []})
        self.progress(job, 'NFE', {'status': 'waiting', 'code': 'DELIVERY_PENDING'})
        source = self.q.status(OWNER, job['requestId'])['sources']['NFE']
        self.assertNotIn('createdItemIds', source)
        self.progress(job, 'CTE', {'status': 'running', 'createdItemIds': [51]})
        self.progress(job, 'CTE', {'status': 'waiting', 'code': 'DELIVERY_PENDING'})
        self.assertEqual(self.q.status(OWNER, job['requestId'])['sources']['CTE']['createdItemIds'], [51])

    def test_interrupted_source_cannot_expire_with_a_false_zero_creation_claim(self):
        self.start()
        job = self.claim()
        self.progress(job, 'NFE', {'status': 'running', 'createdItemIds': []})
        self.now += self.module.MAX_REQUEST_SECONDS + 1
        source = self.q.status(OWNER, job['requestId'])['sources']['NFE']
        self.assertEqual(source['status'], 'failed')
        self.assertNotIn('createdItemIds', source)

    def test_created_ids_survive_expired_lease_and_incomplete_request(self):
        self.start()
        old = self.claim()
        self.progress(old, 'CTE', {'status': 'running', 'createdItemIds': [301]})
        self.now += self.module.LEASE_SECONDS + 1
        replacement = self.claim()
        self.assertEqual(replacement['sources']['CTE']['createdItemIds'], [301])
        with self.assertRaises(ValueError):
            self.progress(old, 'CTE', {'status': 'succeeded', 'createdItemIds': [302]})
        self.progress(replacement, 'CTE', {'status': 'waiting', 'createdItemIds': [302]})
        self.now += self.module.MAX_REQUEST_SECONDS + 1
        source = self.q.status(OWNER, old['requestId'])['sources']['CTE']
        self.assertEqual(source['status'], 'failed')
        self.assertEqual(source['createdItemIds'], [301, 302])

    def test_retry_after_lost_create_reply_and_concurrent_clicks_coalesce(self):
        first = self.start()
        self.assertEqual(self.start(), first)
        self.assertEqual(self.start('b'*32)['requestId'], first['requestId'])
        self.assertEqual(len(self.q.pending(OWNER)['requests']), 1)
        with ThreadPoolExecutor(2) as pool:
            claims = list(pool.map(lambda _: self.claim(), range(2)))
        self.assertEqual(sum(job is not None for job in claims), 1)

    def test_other_owner_cannot_read_ack_alias_or_coalesce_into_request(self):
        self.start()
        for operation in (lambda: self.q.status(OTHER, 'a'*32), lambda: self.q.acknowledge(OTHER, 'a'*32), lambda: self.start(owner=OTHER)):
            with self.assertRaises(PermissionError): operation()
        other = self.start('c'*32, OTHER)
        self.assertNotEqual(other['requestId'], 'a'*32)
        self.assertEqual(len(self.q.pending(OTHER)['requests']), 1)

    def test_unavailable_worker_keeps_request_then_recovers(self):
        started = self.start()
        self.assertEqual(started['status'], 'waiting')
        self.assertTrue(all(x['code'] == 'WORKER_UNAVAILABLE' for x in started['sources'].values()))
        job = self.claim()
        self.assertIsNotNone(job)
        self.assertEqual(job['status'], 'running')
        self.assertNotIn('leaseToken', self.q.status(OWNER, 'a'*32))

    def test_success_requires_all_sources_and_survives_restart_until_explicit_ack(self):
        self.start(); job = self.claim()
        self.progress(job, 'NFE', {'status': 'succeeded', 'documents': 0})
        self.assertNotEqual(self.q.status(OWNER, job['requestId'])['status'], 'succeeded')
        with self.assertRaises(ValueError): self.q.acknowledge(OWNER, job['requestId'])
        self.progress(job, 'CTE', {'status': 'succeeded', 'documents': 2})
        self.progress(job, 'NFSE', {'status': 'succeeded', 'documents': 1})
        receipt = self.finish(job)['job']
        self.assertEqual(receipt['status'], 'succeeded')
        self.assertIn('completedUtc', receipt)
        restarted = self.module.Queue(self.root, clock=lambda: self.now)
        self.assertEqual(restarted.pending(OWNER)['requests'], [receipt])
        restarted.acknowledge(OWNER, job['requestId'])
        self.assertEqual(restarted.pending(OWNER)['requests'], [])
        self.assertEqual(self.start(), receipt)

    def test_partial_failure_never_becomes_success(self):
        self.start(); job = self.claim()
        self.progress(job, 'NFE', {'status': 'succeeded', 'documents': 1})
        self.progress(job, 'CTE', {'status': 'failed', 'code': 'SYNC_FAILED'})
        self.progress(job, 'NFSE', {'status': 'failed', 'code': 'SYNC_FAILED'})
        self.assertEqual(self.finish(job)['job']['status'], 'partial')

    def test_waiting_preserves_cooldown_and_completed_sources(self):
        self.start(); job = self.claim()
        self.progress(job, 'NFE', {'status': 'succeeded', 'documents': 2})
        due = '2030-03-17T18:46:40+00:00'
        self.progress(job, 'CTE', {'status': 'waiting', 'code': 'COOLDOWN', 'nextAllowedAt': due})
        self.progress(job, 'NFSE', {'status': 'waiting', 'code': 'COOLDOWN', 'nextAllowedAt': due})
        self.assertEqual(self.finish(job)['job']['status'], 'waiting')
        self.assertIsNone(self.claim())
        self.now += 4000
        resumed = self.claim()
        self.assertEqual(resumed['sources']['NFE'], {'status': 'succeeded', 'documents': 2})

    def test_expired_lease_rejects_old_worker_and_resumes_without_losing_success(self):
        self.start(); first = self.claim()
        self.progress(first, 'NFE', {'status': 'succeeded', 'documents': 2})
        self.progress(first, 'CTE', {'status': 'running'})
        self.now += 1300
        second = self.claim()
        self.assertNotEqual(second['leaseToken'], first['leaseToken'])
        with self.assertRaises(ValueError): self.progress(first, 'CTE', {'status': 'succeeded', 'documents': 1})
        self.assertEqual(second['sources']['NFE']['status'], 'succeeded')

    def test_renew_preserves_active_lease_beyond_original_deadline(self):
        self.start(); job = self.claim(); self.now += 1100
        self.q.worker('renew', {k: job[k] for k in ('requestId', 'leaseToken')})
        self.now += 200
        self.assertIsNone(self.claim())
        self.progress(job, 'NFE', {'status': 'succeeded', 'documents': 0})

    def test_lost_progress_and_completion_replies_are_idempotent(self):
        self.start(); job = self.claim()
        receipt = self.succeed(job)
        self.progress(job, 'NFSE', {'status': 'succeeded', 'documents': 0})
        self.assertEqual(self.finish(job), receipt)
        with self.assertRaises(ValueError): self.progress(job, 'NFE', {'status': 'running'})

    def test_invalid_results_do_not_commit_and_terminal_source_cannot_regress(self):
        self.start(); job = self.claim()
        for result in ({'status': 'succeeded', 'documents': True}, {'status': 'succeeded', 'documents': -1}, {'status': 'succeeded', 'documents': 1000001}, {'status': 'failed', 'code': 'ARBITRARY'}, {'status': 'waiting', 'nextAllowedAt': 'bad'}, {'status': 'succeeded', 'secret': 'private'}):
            with self.assertRaises(ValueError): self.progress(job, 'NFE', result)
        self.assertEqual(self.q.status(OWNER, job['requestId'])['sources']['NFE']['status'], 'queued')
        self.progress(job, 'NFE', {'status': 'succeeded', 'documents': 0})
        with self.assertRaises(ValueError): self.progress(job, 'NFE', {'status': 'failed', 'code': 'SYNC_FAILED'})
        self.assertNotIn('private', (self.root / 'state.json').read_text())

    def test_request_expires_after_day_without_discarding_success(self):
        self.start(); job = self.claim()
        self.progress(job, 'NFE', {'status': 'succeeded', 'documents': 2})
        self.now += 86401
        self.assertEqual(self.q.status(OWNER, job['requestId'])['status'], 'partial')
        self.assertEqual(len(self.q.pending(OWNER)['requests']), 1)

    def test_old_unacknowledged_results_and_idempotency_are_never_pruned(self):
        for index in range(65):
            self.start(format(index, '032x')); self.succeed(self.claim())
        self.assertEqual(len(self.q.pending(OWNER)['requests']), 65)
        self.assertEqual(self.start('0'*32)['status'], 'succeeded')

    def test_portal_rejects_extra_parameters_and_unknown_identity(self):
        for body in ({'action': 'sefaz_refresh'}, {'action': 'sefaz_refresh', 'requestId': 'bad'}, {'action': 'sefaz_refresh', 'requestId': 'a'*32, 'company': 'other'}, {'action': 'sefaz_refresh_status', 'requestId': 'a'*32, 'acknowledge': 1}):
            with self.assertRaises(ValueError): self.module.handle_portal(OWNER, body, self.q)
        for identity in ({}, {'oid': '', 'email': 'owner@example.test'}, {'oid': 'owner', 'email': ''}, {'oid': 'owner', 'email': 'invalid'}, {'oid': 'owner', 'email': 'bad\n@example.test'}, {'oid': [], 'email': 'owner@example.test'}):
            with self.assertRaises(PermissionError): self.q.start(identity, 'a'*32)
        result = self.module.handle_portal(OWNER, {'action': 'sefaz_refresh', 'requestId': 'a'*32}, self.q)
        self.assertEqual(set(result), {'status', 'messages', 'sefazRefresh'})

    def test_two_members_authorized_by_portal_require_no_private_dda_allowlist(self):
        first = self.start(owner=OWNER)
        second = self.start('b'*32, OTHER)
        self.assertEqual(len(self.q.pending(OWNER)['requests']), 1)
        self.assertEqual(len(self.q.pending(OTHER)['requests']), 1)
        self.assertNotEqual(first['requestId'], second['requestId'])
        self.assertFalse((self.root / 'access.json').exists())

    def test_alias_remains_owner_scoped_and_acknowledges_canonical_receipt(self):
        self.start(); self.start('b'*32)
        self.succeed(self.claim())
        with self.assertRaises(PermissionError): self.q.status(OTHER, 'b'*32)
        self.assertEqual(self.q.acknowledge(OWNER, 'b'*32)['requestId'], 'a'*32)
        self.assertEqual(self.q.pending(OWNER)['requests'], [])
        self.assertEqual(self.start('b'*32)['requestId'], 'a'*32)

    def test_waiting_source_never_erases_previously_confirmed_document_count_on_expiry(self):
        self.start(); job = self.claim()
        self.progress(job, 'NFE', {'status': 'waiting', 'documents': 3, 'code': 'DELIVERY_PENDING'})
        self.now += 86401
        result = self.q.status(OWNER, 'a'*32)['sources']['NFE']
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['documents'], 3)

    def test_corrupt_state_fails_closed_without_replacing_evidence(self):
        path = self.root / 'state.json'
        path.write_text('{broken')
        with self.assertRaises(ValueError): self.start()
        self.assertEqual(path.read_text(), '{broken')

    def test_timestamp_accepts_dotnet_precision_but_rejects_non_iso_separators(self):
        value = self.module.timestamp('2030-03-17T18:46:40.1234567Z')
        self.assertEqual(value, self.module.timestamp('2030-03-17T18:46:40.123456+00:00'))
        for malformed in ('2030-03-17X18:46:40+00:00', '2030-03-17T18:46:40', '2030-03-17T18:46:40.12345678Z'):
            with self.assertRaises(ValueError): self.module.timestamp(malformed)


if __name__ == '__main__':
    unittest.main()
