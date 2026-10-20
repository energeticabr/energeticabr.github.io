"""Failure injection against temporary code roots only; no service/HR access."""
import hashlib
import importlib.util
from pathlib import Path
import shutil
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('rhid_removal_deployer_under_test', Path(__file__).with_name('deploy.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

def sha(data):
    return hashlib.sha256(data).hexdigest()

class DeploymentTests(unittest.TestCase):
    def run_case(self, failure=None):
        with tempfile.TemporaryDirectory(prefix='rhid-delete-deploy-test-') as temporary:
            root = Path(temporary)
            roots = (root / 'live', root / 'mirror')
            candidate = root / 'candidate'
            candidate.mkdir()
            for site in roots:
                site.mkdir()
            manifest = {'files': {}}
            original = {}
            for relative in deploy.FILES:
                after = ('candidate-' + relative).encode()
                (candidate / relative).write_bytes(after)
                info = {'after': sha(after)}
                for n, site in enumerate(roots):
                    target = site / relative
                    absent = relative == 'rhid_manual_punch_removal.py' or (n and relative == 'rhid_calendar_snapshot.py')
                    before = None if absent else (str(n) + '-original-' + relative).encode()
                    original[target] = before
                    if before is not None:
                        target.write_bytes(before)
                    info['before' if not n else 'mirrorBefore'] = sha(before) if before is not None else None
                manifest['files'][relative] = info
            calls = {'copy': 0, 'restart': 0, 'wait': 0}
            def copy(source, target, attributes=None):
                calls['copy'] += 1
                if failure == 'copy' and calls['copy'] == 3:
                    raise OSError('injected copy failure')
                shutil.copyfile(source, target)
            def restart():
                calls['restart'] += 1
                if failure == 'restart' and calls['restart'] == 1:
                    raise RuntimeError('injected restart failure')
            def wait():
                calls['wait'] += 1
                if failure == 'health' and calls['wait'] == 1:
                    raise RuntimeError('injected health failure')
                return {'status': 'ok'}
            runner = SimpleNamespace(health=lambda: {'status': 'ok'}, atomic_copy=copy, restart=restart, wait_health=wait)
            with patch.object(deploy, 'ROOTS', roots), patch.object(deploy, 'BACKUPS', root / 'backups'):
                if failure:
                    with self.assertRaises((OSError, RuntimeError)):
                        deploy.rollout(manifest, candidate, runner)
                    for target, before in original.items():
                        self.assertEqual(target.read_bytes() if target.exists() else None, before, str(target))
                    self.assertGreaterEqual(calls['restart'], 1)
                else:
                    self.assertEqual(deploy.rollout(manifest, candidate, runner)['status'], 'deployed')
                    for target in original:
                        self.assertEqual(target.read_bytes(), (candidate / target.name).read_bytes())
    def test_copy_failure_restores_distinct_live_and_mirror_baselines(self):
        self.run_case('copy')
    def test_restart_failure_removes_new_helpers_and_missing_mirror_calendar(self):
        self.run_case('restart')
    def test_health_failure_restores_every_original_file(self):
        self.run_case('health')
    def test_success_installs_only_reviewed_candidates_in_both_roots(self):
        self.run_case()

if __name__ == '__main__':
    unittest.main()
