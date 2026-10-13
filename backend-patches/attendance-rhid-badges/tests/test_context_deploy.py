import hashlib
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import patch_bridge

def digest(data): return hashlib.sha256(data).hexdigest()

class Runner:
    def __init__(self, health=True, change=None): self.healthy, self.change, self.restarts = health, change, 0
    def restart(self):
        self.restarts += 1
        if self.change: self.change()
    def wait_health(self): return self.healthy

class ContextDeployTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.live, self.mirror = self.root / 'live', self.root / 'mirror'
        self.stage = self.root / 'stage'
        source = patch_bridge.patch_bridge((ROOT / 'tests/fixtures/bridge_rhid_report.py.txt').read_text())
        # The existing deployed bridge lacks only the optional choice context.
        source = source.replace('get_rhid_badge_report, attendance_rhid_option_context', 'get_rhid_badge_report')
        source = source.replace('                    **attendance_rhid_option_context(step, item, state.get("options")),\n', '')
        self.original = source.encode()
        self.original_module = b'original = True\n'
        self.new_module = b'updated = True\n'
        self.module_path = self.root / 'new_source.py'
        self.module_path.write_bytes(self.new_module)
        for root in [self.live, self.mirror]:
            (root / 'worker').mkdir(parents=True)
            (root / 'channel_bridge.py').write_bytes(self.original)
            (root / 'rhid_badge_source.py').write_bytes(self.original_module)
            (root / 'worker/workflow_config.json').write_bytes(b'{"unchanged":true}')
        target = ROOT / 'deploy_context.py'
        if not target.exists(): self.fail('The guarded context installer is missing')
        spec = importlib.util.spec_from_file_location('context_deployment', target)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def deploy(self, **overrides):
        arguments = dict(expected_bridge_hash=digest(self.original), expected_module_hash=digest(self.original_module),
            source_module=self.module_path, stage=self.stage, live=self.live, mirror=self.mirror, apply=True, runner=Runner())
        return self.module.deploy_context(**{**arguments, **overrides})

    def test_dry_run_leaves_sources_and_backup_directory_untouched(self):
        result = self.deploy(apply=False)
        self.assertTrue(result['dryRun'])
        self.assertFalse(self.stage.exists())
        self.assertEqual((self.live / 'channel_bridge.py').read_bytes(), self.original)
        self.assertEqual((self.mirror / 'rhid_badge_source.py').read_bytes(), self.original_module)

    def test_install_preserves_modes_configs_and_original_bytes_in_backups(self):
        target = self.live / 'rhid_badge_source.py'
        target.chmod(0o640)
        before_mode = target.stat().st_mode
        result = self.deploy()
        self.assertEqual(result['status'], 'deployed')
        self.assertTrue(result['serviceHealth'])
        self.assertEqual(target.read_bytes(), self.new_module)
        self.assertEqual(target.stat().st_mode, before_mode)
        self.assertEqual((self.mirror / 'rhid_badge_source.py').read_bytes(), self.new_module)
        self.assertEqual((self.live / 'worker/workflow_config.json').read_bytes(), b'{"unchanged":true}')
        self.assertEqual((Path(result['backup']) / 'live-channel_bridge.py').read_bytes(), self.original)
        self.assertEqual((Path(result['backup']) / 'mirror-rhid_badge_source.py').read_bytes(), self.original_module)

    def test_source_drift_refuses_before_any_replacement(self):
        (self.mirror / 'rhid_badge_source.py').write_bytes(b'foreign = True\n')
        with self.assertRaisesRegex(RuntimeError, 'changed'):
            self.deploy()
        self.assertEqual((self.live / 'channel_bridge.py').read_bytes(), self.original)
        self.assertEqual((self.mirror / 'rhid_badge_source.py').read_bytes(), b'foreign = True\n')

    def test_health_failure_restores_both_bridges_and_modules(self):
        with self.assertRaisesRegex(RuntimeError, 'health'):
            self.deploy(runner=Runner(health=False))
        for root in [self.live, self.mirror]:
            self.assertEqual((root / 'channel_bridge.py').read_bytes(), self.original)
            self.assertEqual((root / 'rhid_badge_source.py').read_bytes(), self.original_module)

    def test_rollback_never_overwrites_a_foreign_source_change(self):
        target = self.live / 'rhid_badge_source.py'
        runner = Runner(health=False, change=lambda: target.write_bytes(b'foreign = True\n'))
        with self.assertRaisesRegex(RuntimeError, 'Concurrent'):
            self.deploy(runner=runner)
        self.assertEqual(target.read_bytes(), b'foreign = True\n')

    def test_change_after_the_final_hash_check_is_preserved_during_install_and_rollback(self):
        target = self.live / 'rhid_badge_source.py'
        foreign = b'concurrent = True\n'
        for before, after in [(self.original_module, self.new_module), (self.new_module, self.original_module)]:
            with self.subTest(rollback=before == self.new_module):
                target.write_bytes(before)
                real_checked = self.module.checked
                calls = 0
                def racing_check(path, expected):
                    nonlocal calls
                    content = real_checked(path, expected)
                    if path == target:
                        calls += 1
                        if calls == 2: target.write_bytes(foreign)
                    return content
                with mock.patch.object(self.module, 'checked', side_effect=racing_check):
                    with self.assertRaisesRegex(RuntimeError, 'Concurrent'):
                        self.module.install(after, target, target.stat(), digest(before))
                self.assertEqual(target.read_bytes(), foreign)

    def test_create_only_install_never_overwrites_a_writer_that_appears_in_the_gap(self):
        target = self.live / 'rhid_badge_source.py'
        foreign = b'concurrent = True\n'
        real_link = self.module.os.link
        raced = False
        def racing_link(source, destination, **kwargs):
            nonlocal raced
            if Path(destination) == target and not raced:
                raced = True
                target.write_bytes(foreign)
            return real_link(source, destination, **kwargs)
        with mock.patch.object(self.module.os, 'link', side_effect=racing_link):
            with self.assertRaisesRegex(RuntimeError, 'Concurrent'):
                self.module.install(self.new_module, target, target.stat(), digest(self.original_module))
        self.assertTrue(raced)
        self.assertEqual(target.read_bytes(), foreign)

    def test_deployment_locks_reject_a_second_cooperating_writer(self):
        lock = self.root / 'shared-deploy.lock'
        if not hasattr(self.module, 'deployment_locks'): self.fail('Deployment-wide shared locks are missing')
        with self.module.deployment_locks([lock]):
            with self.assertRaisesRegex(RuntimeError, 'locked'):
                with self.module.deployment_locks([lock]): self.fail('Second writer must not enter')

    def test_existing_shared_lock_is_opened_without_create_in_a_protected_tmp_directory(self):
        lock = self.root / 'shared-deploy.lock'
        lock.touch()
        real_open = self.module.os.open
        def protected_open(path, flags, *args, **kwargs):
            if Path(path) == lock and flags & self.module.os.O_CREAT:
                raise PermissionError('Linux protected_regular rejects O_CREAT on an existing shared lock')
            return real_open(path, flags, *args, **kwargs)
        with mock.patch.object(self.module.os, 'open', side_effect=protected_open):
            with self.module.deployment_locks([lock]): pass

if __name__ == '__main__': unittest.main()
