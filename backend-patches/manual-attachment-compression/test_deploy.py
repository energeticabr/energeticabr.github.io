"""Synthetic rollout tests: no service, production path or network access."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('deploy.py')
        self.assertTrue(path.is_file(), 'A deployable hash/CAS/rollback wrapper is required')
        spec = importlib.util.spec_from_file_location('manual_compression_deploy', path)
        self.d = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.d)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.d.ROOTS = (base / 'live', base / 'mirror')
        self.d.BACKUPS = base / 'backups'
        self.candidate = base / 'candidate'
        self.candidate.mkdir()
        self.before, self.after = b'old = True\n', b'new = True\n'
        self.manifest = {'files': {'worker/workflow.py': {
            'before': self.sha(self.before), 'mirrorBefore': self.sha(self.before),
            'after': self.sha(self.after)}}}
        for root in self.d.ROOTS:
            (root / 'worker').mkdir(parents=True)
            (root / 'worker/workflow.py').write_bytes(self.before)
        (self.candidate / 'worker').mkdir()
        (self.candidate / 'worker/workflow.py').write_bytes(self.after)
        outer = self

        class Runner:
            restarts = 0
            fail_health_once = False
            drift_on_restart = False
            writes = 0

            def health(self):
                return {'status': 'ok'}

            def atomic_copy(self, source, target, attributes=None):
                self.writes += 1
                shutil.copy2(source, target)

            def restart(self):
                self.restarts += 1
                if self.drift_on_restart and self.restarts == 1:
                    (outer.d.ROOTS[0] / 'worker/workflow.py').write_bytes(b'concurrent = True\n')

            def wait_health(self):
                if self.fail_health_once and self.restarts == 1:
                    raise RuntimeError('Synthetic health failure')
                return self.health()

        self.runner = Runner()

    @staticmethod
    def sha(data):
        return hashlib.sha256(data).hexdigest()

    def contents(self):
        return [(root / 'worker/workflow.py').read_bytes() for root in self.d.ROOTS]

    def run_rollout(self, **kwargs):
        return self.d.rollout(self.manifest, self.candidate, self.runner, **kwargs)

    def test_check_does_not_write_or_restart(self):
        self.assertEqual(self.run_rollout(check_only=True)['status'], 'checked')
        self.assertEqual(self.contents(), [self.before, self.before])
        self.assertEqual(self.runner.restarts, 0)
        self.assertEqual(self.runner.writes, 0)

    def test_install_both_roots_with_verified_backups(self):
        result = self.run_rollout()
        self.assertEqual(result['status'], 'deployed')
        self.assertEqual(self.contents(), [self.after, self.after])
        self.assertEqual(self.runner.restarts, 1)
        self.assertEqual((Path(result['backup']) / '0-workflow.py').read_bytes(), self.before)
        self.assertEqual((Path(result['backup']) / '1-workflow.py').read_bytes(), self.before)

    def test_health_failure_restores_both_roots(self):
        self.runner.fail_health_once = True
        with self.assertRaisesRegex(RuntimeError, 'health failure'):
            self.run_rollout()
        self.assertEqual(self.contents(), [self.before, self.before])
        self.assertEqual(self.runner.restarts, 2)
        receipt = next(self.d.BACKUPS.glob('*/receipt.json'))
        self.assertEqual(json.loads(receipt.read_text())['status'], 'rolled_back')

    def test_source_drift_refuses_all_writes(self):
        (self.d.ROOTS[1] / 'worker/workflow.py').write_bytes(b'drift\n')
        with self.assertRaisesRegex(RuntimeError, 'drift'):
            self.run_rollout()
        self.assertEqual(self.runner.writes, 0)
        self.assertEqual(self.runner.restarts, 0)

    def test_candidate_drift_refuses_all_writes(self):
        (self.candidate / 'worker/workflow.py').write_bytes(b'bad\n')
        with self.assertRaisesRegex(RuntimeError, 'Candidate'):
            self.run_rollout()
        self.assertEqual(self.runner.writes, 0)

    def test_rollback_preserves_concurrent_writer_and_reports_incomplete(self):
        self.runner.drift_on_restart = True
        with self.assertRaisesRegex(RuntimeError, 'Post-restart'):
            self.run_rollout()
        self.assertEqual(self.contents(), [b'concurrent = True\n', self.before])
        receipt = next(self.d.BACKUPS.glob('*/receipt.json'))
        self.assertEqual(json.loads(receipt.read_text())['status'], 'rollback_incomplete')


if __name__ == '__main__':
    unittest.main()
