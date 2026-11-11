import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((HERE / 'sicoob_sync.py').exists(), 'Sicoob request queue is missing')
        self.module = importlib.import_module('sicoob_sync')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now = 1000
        root = Path(self.temp.name)
        (root / 'access.json').write_text(json.dumps({'emails': ['operator@example.invalid', 'other@example.invalid']}))
        self.queue = self.module.Queue(root, lambda: self.now)
        self.identity = {'oid': 'operator-id', 'email': 'operator@example.invalid'}
        self.other = {'oid': 'other-id', 'email': 'other@example.invalid'}
        self.queue.worker('heartbeat')
        self.request = '1' * 32

    def start(self, request=None):
        return self.module.handle_portal(self.identity, {'action': 'sicoob_refresh', 'requestId': request or self.request}, self.queue)['sicoobRefresh']

    def finish(self):
        self.queue.worker('claim')
        self.queue.worker('complete', {'requestId': self.request, 'status': 'succeeded', 'created': 2, 'updated': 1, 'verified': 8, 'failed': 0})

    def test_retries_and_aliases_survive_reopening_and_acknowledgement(self):
        self.assertEqual(self.start()['status'], 'queued')
        self.assertEqual(self.start('2' * 32)['requestId'], self.request)
        self.finish()
        self.queue.acknowledge(self.identity, '2' * 32)
        reopened = self.module.Queue(self.queue.root, lambda: self.now)
        self.assertEqual(reopened.start(self.identity, '2' * 32)['status'], 'succeeded')
        self.assertEqual(reopened.pending(self.identity)['requests'], [])
        self.assertEqual(len(json.loads((reopened.root / 'state.json').read_text())['jobs']), 1)

    def test_status_and_ack_require_same_authenticated_owner(self):
        self.start()
        for operation in (lambda: self.queue.status(self.other, self.request), lambda: self.queue.acknowledge(self.other, self.request), lambda: self.queue.start(self.other, self.request)):
            with self.assertRaises(PermissionError):
                operation()
        with self.assertRaises(PermissionError):
            self.queue.start({'email': 'operator@example.invalid'}, '3' * 32)
        with self.assertRaises(PermissionError):
            self.queue.start({'oid': 'id', 'email': 'unknown@example.invalid'}, '3' * 32)

    def test_rejects_extra_banking_parameters_and_invalid_request_ids(self):
        for body in ({'action': 'sicoob_refresh', 'requestId': None}, {'action': 'sicoob_refresh', 'requestId': 'x' * 32}, {'action': 'sicoob_refresh', 'account': '999'}, {'action': 'sicoob_refresh_status', 'mode': 'all'}):
            with self.assertRaises(ValueError):
                self.module.handle_portal(self.identity, body, self.queue)

    def test_worker_unavailable_receipt_is_permanent(self):
        self.now += 181
        self.assertEqual(self.start()['code'], 'WORKER_UNAVAILABLE')
        self.queue.worker('heartbeat')
        self.assertEqual(self.start()['status'], 'failed')
        self.assertEqual(self.queue.worker('claim')['job'], None)

    def test_active_request_cannot_be_acknowledged(self):
        self.start()
        with self.assertRaises(ValueError):
            self.queue.acknowledge(self.identity, self.request)

    def test_failed_worker_result_cannot_be_reported_as_success(self):
        self.start()
        self.queue.worker('claim')
        self.queue.worker('complete', {'requestId': self.request, 'status': 'succeeded', 'failed': 1})
        self.assertEqual(self.queue.status(self.identity, self.request)['status'], 'failed')

    def test_success_requires_complete_explicit_counts(self):
        self.start()
        self.queue.worker('claim')
        with self.assertRaises(ValueError):
            self.queue.worker('complete', {'requestId': self.request, 'status': 'succeeded', 'failed': 0})
        self.assertEqual(self.queue.status(self.identity, self.request)['status'], 'running')

    def test_unresolved_details_are_persisted_without_exposing_bank_data(self):
        self.start()
        self.queue.worker('claim')
        self.queue.worker('complete', {'requestId': self.request, 'status': 'succeeded', 'failed': 0,
                                      'created': 0, 'updated': 0, 'verified': 2, 'pendingDetails': 19})
        self.assertEqual(self.queue.status(self.identity, self.request)['pendingDetails'], 19)

    def test_public_receipts_never_expose_owner_or_internal_state(self):
        self.start()
        self.finish()
        body = self.module.handle_portal(self.identity, {'action': 'sicoob_refresh_status', 'mode': 'pending'}, self.queue)
        receipt = body['sicoobRefresh']['requests'][0]
        self.assertEqual(set(receipt), {'requestId', 'status', 'created', 'updated', 'verified', 'completedUtc'})
        self.assertEqual(receipt['verified'], 8)

    def test_live_heartbeat_keeps_long_lock_wait_running(self):
        self.start()
        self.queue.worker('claim')
        for _ in range(55):
            self.now += 100
            self.queue.worker('heartbeat')
        self.assertEqual(self.queue.status(self.identity, self.request)['status'], 'running')


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((HERE / 'sicoob_worker.py').exists(), 'Sicoob pipeline runner is missing')
        self.module = importlib.import_module('sicoob_worker')

    def receipt(self, stage, payload, code=0):
        return self.module.parse_stage(stage, json.dumps(payload), code)

    def test_statement_requires_real_bank_read_and_consistent_verified_counts(self):
        self.assertEqual(self.receipt('movements', {'status': 'ok', 'from': '2026-11-10', 'through': '2026-11-11', 'debits': 4, 'inserted': 1, 'existing': 3, 'excludedDebits': 2, 'unidentified': 1}), {'created': 1, 'updated': 0, 'verified': 4, 'pendingDetails': 0})
        for value in ({'status': 'not_due'}, {'status': 'ok', 'debits': 4, 'inserted': 1, 'existing': 2}, {'status': 'ok', 'debits': True, 'inserted': 1, 'existing': 0}):
            with self.assertRaises(ValueError):
                self.receipt('movements', value)

    def test_no_match_is_not_fabricated_as_a_write(self):
        self.assertEqual(self.receipt('boleto', {'already_attached': 2, 'unverified_404': 3, 'unverified_200': 1, 'unverified_400': 4}), {'created': 0, 'updated': 0, 'verified': 0, 'pendingDetails': 8})
        self.assertEqual(self.receipt('pix', {'pendentes': 7, 'http_200': 2, 'http_404': 3, 'verificados': 2, 'nomes_gravados': 1}), {'created': 0, 'updated': 1, 'verified': 0, 'pendingDetails': 6})

    def test_auxiliary_write_failures_and_incomplete_bank_responses_fail(self):
        cases = [('boleto', {'write_failed_ValueError': 1}), ('boleto', {'unverified_429': 1}), ('boleto', {'unverified_deferred': 1}), ('boleto', {'unverified_500': 1}), ('pix', {'pendentes': 1, 'falha_gravacao_RuntimeError': 1}), ('pix', {'pendentes': 1, 'http_503': 1}), ('pix', {})]
        for stage, payload in cases:
            with self.subTest(stage=stage, payload=payload), self.assertRaises(ValueError):
                self.receipt(stage, payload)

    def test_unknown_truncated_duplicate_and_nonzero_output_fail(self):
        for text, code in [('{}', 2), ('{"pendentes":0}\n{"pendentes":0}', 0), ('{"pendentes":', 0), ('{"pendentes":0,"secret_field":2}', 0)]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                self.module.parse_stage('pix', text, code)

    def test_runner_heartbeats_while_child_runs(self):
        calls = []
        with tempfile.TemporaryDirectory() as root:
            text, code = self.module.execute_stage([sys.executable, '-c', 'import time; time.sleep(.2); print("{\\"pendentes\\":0}")'], Path(root), lambda: calls.append(True), timeout=2, interval=.03)
        self.assertEqual(code, 0)
        self.assertGreater(len(calls), 1)
        self.assertEqual(json.loads(text), {'pendentes': 0})

    @unittest.skipIf(os.name == 'nt', 'Production runner uses flock')
    def test_incomplete_auxiliary_result_does_not_skip_remaining_collector(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as root:
            marker = Path(root) / 'pix-ran'
            statement = {'status': 'ok', 'from': '2026-11-11', 'through': '2026-11-11', 'debits': 0, 'inserted': 0, 'existing': 0, 'unidentified': 0, 'excludedDebits': 0}
            stages = (
                ('movements', [sys.executable, '-c', 'print(' + repr(json.dumps(statement)) + ')']),
                ('boleto', [sys.executable, '-c', 'print("{\\"unverified_429\\":1}")']),
                ('pix', [sys.executable, '-c', 'from pathlib import Path; Path(' + repr(str(marker)) + ').touch(); print("{\\"pendentes\\":0}")']),
            )
            with patch.object(self.module, 'ROOT', Path(root)), patch.object(self.module, 'STAGES', stages):
                result = self.module.collect('Manual')
            self.assertEqual(result['status'], 'failed')
            self.assertTrue(marker.exists(), 'Pix must still run after a partial boleto result')

    @unittest.skipIf(os.name == 'nt', 'POSIX process groups and flock are production Linux primitives')
    def test_timeout_kills_descendants_before_releasing_pipeline_lock(self):
        with tempfile.TemporaryDirectory() as root:
            marker = Path(root) / 'late-write'
            child = 'import time; from pathlib import Path; time.sleep(.8); Path(' + repr(str(marker)) + ').touch()'
            parent = 'import subprocess, sys, time; subprocess.Popen([sys.executable,"-c",' + repr(child) + ']); time.sleep(5)'
            with self.assertRaises(TimeoutError):
                self.module.execute_stage([sys.executable, '-c', parent], Path(root), lambda: None, timeout=.15, interval=.02)
            time.sleep(1)
            self.assertFalse(marker.exists())

    @unittest.skipIf(os.name == 'nt', 'Production lock is flock')
    def test_parallel_pipeline_waits_without_overlapping_and_heartbeats(self):
        import fcntl
        with tempfile.TemporaryDirectory() as root:
            calls = []
            path = Path(root) / 'pipeline.lock'
            with path.open('a+b') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                with self.assertRaises(TimeoutError):
                    with self.module.pipeline_lock(Path(root), lambda: calls.append(True), timeout=.08, interval=.01):
                        self.fail('A second collector entered the active pipeline')
            self.assertGreater(len(calls), 1)
            with self.module.pipeline_lock(Path(root), lambda: None, timeout=.1):
                pass


class DeploymentTests(unittest.TestCase):
    def test_live_diagnostic_never_guesses_a_multiuser_identity_mapping(self):
        verifier = importlib.import_module('verify_live')
        self.assertTrue(hasattr(verifier, 'trusted_identity'), 'Unambiguous identity check is missing')
        single = {'jobs': {'first': {'owner': 'oid-one'}, 'second': {'owner': 'oid-one'}}}
        self.assertEqual(verifier.trusted_identity(single, ['one@example.invalid']), {'oid': 'oid-one', 'email': 'one@example.invalid'})
        for owners, emails in (
                ({'jobs': {}}, ['one@example.invalid']),
                (single, ['one@example.invalid', 'two@example.invalid']),
                ({'jobs': {'first': {'owner': 'oid-one'}, 'second': {'owner': 'oid-two'}}}, ['one@example.invalid'])):
            with self.assertRaises(RuntimeError):
                verifier.trusted_identity(owners, emails)

    @unittest.skipIf(os.name == 'nt', 'Deployment uses Linux flock')
    def test_scheduled_race_blocks_install_and_restores_timer(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        deployment = importlib.import_module('deploy')
        self.assertTrue(hasattr(deployment, 'paused_schedule'), 'Schedule pause recovery is missing')
        state = {'timer': True, 'collector': 'inactive'}

        def systemctl(*args):
            if args[:2] == ('systemctl', 'stop'):
                state.update(timer=False, collector='active')
            elif args[:2] == ('systemctl', 'start'):
                state['timer'] = True
            elif args[:2] == ('systemctl', 'show'):
                return state['collector']
            else:
                self.fail('Unexpected command')
            return ''

        with patch.object(deployment.subprocess, 'run', return_value=SimpleNamespace(returncode=0)), patch.object(deployment, 'run', systemctl):
            with self.assertRaises(RuntimeError):
                with deployment.paused_schedule():
                    self.fail('Installation proceeded while old collector was active')
        self.assertTrue(state['timer'])
        self.assertEqual(state['collector'], 'active')

    @unittest.skipIf(os.name == 'nt', 'Deployment uses Linux flock')
    def test_failed_install_and_failed_recovery_still_restore_timer(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        deployment = importlib.import_module('deploy')
        self.assertTrue(hasattr(deployment, 'paused_schedule'), 'Schedule pause recovery is missing')
        state = {'timer': True}

        def systemctl(*args):
            if args[:2] == ('systemctl', 'stop'):
                state['timer'] = False
            elif args[:2] == ('systemctl', 'start'):
                state['timer'] = True
            elif args[:2] == ('systemctl', 'show'):
                return 'inactive'
            return ''

        with patch.object(deployment.subprocess, 'run', return_value=SimpleNamespace(returncode=0)), patch.object(deployment, 'run', systemctl):
            with self.assertRaisesRegex(RuntimeError, 'rollback health'):
                with deployment.paused_schedule():
                    self.assertFalse(state['timer'])
                    try:
                        raise RuntimeError('installation health')
                    except RuntimeError:
                        raise RuntimeError('rollback health')
        self.assertTrue(state['timer'])

    @unittest.skipIf(os.name == 'nt', 'Deployment uses Linux flock')
    def test_health_requires_both_worker_and_correct_channel_bridge(self):
        import http.server
        import threading
        deployment = importlib.import_module('deploy')
        self.assertTrue(hasattr(deployment, 'healthy'), 'Combined worker and bridge health check is missing')
        responses = {'/worker': (200, b'ok'), '/bridge': (503, b'{"status":"failed"}')}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                status, content = responses[self.path]
                self.send_response(status)
                self.end_headers()
                self.wfile.write(content)

            def log_message(self, *args):
                pass

        with http.server.HTTPServer(('127.0.0.1', 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            try:
                address = 'http://127.0.0.1:' + str(server.server_port)
                self.assertFalse(deployment.healthy(address + '/worker', address + '/bridge'))
                responses['/bridge'] = (200, b'{"status":"ok","channel":"generic"}')
                self.assertTrue(deployment.healthy(address + '/worker', address + '/bridge'))
                responses['/bridge'] = (200, b'ok')
                self.assertFalse(deployment.healthy(address + '/worker', address + '/bridge'))
            finally:
                server.shutdown()
                thread.join()


if __name__ == '__main__':
    unittest.main()
