"""One-file production-only deployment contract; all targets are synthetic."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from bridge_fixture import PATCH_ROOT, PRIVATE_ROOT, load_module, pinned_source


def sha(data):
    return hashlib.sha256(data).hexdigest()


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        path = PATCH_ROOT / 'deploy.py'
        self.assertTrue(path.is_file(), 'Production-only installer must be prepared')
        self.d = load_module('document_person_deploy_tests', path)
        temporary_root = PRIVATE_ROOT / 'backend/tests'
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=temporary_root)
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.d.ROOT = self.base / 'live'
        self.d.MIRROR = self.base / 'mirror'
        self.d.STAGE = self.base / 'release'
        self.d.BACKUPS = self.base / 'backups'
        self.d.STAGE.mkdir()
        self.before, self.after, self.mirror = b'old = True\n', b'new = True\n', b'mirror = True\n'
        self.d.BEFORE = {'channel_bridge.py': sha(self.before)}
        self.d.AFTER = {'channel_bridge.py': sha(self.after)}
        self.d.MIRROR_PINS = {'channel_bridge.py': sha(self.mirror)}
        self.candidate = {'channel_bridge.py': self.after}
        for root, data in ((self.d.ROOT, self.before), (self.d.MIRROR, self.mirror)):
            root.mkdir()
            (root / 'channel_bridge.py').write_bytes(data)
            (root / 'workflow_config.json').write_bytes(b'untouched configuration\n')
        sources = {
            'patch_bridge.py': 'def patch_bridge(source):\n    return source.replace("old", "new")\n',
            'deploy.py': '# wrapper fixture\n', 'deploy.sh': '# shell fixture\n',
            'deployment_gate.sh': '# gate fixture\n', 'shared-deploy.py': '# runner fixture\n',
        }
        for name, data in sources.items():
            (self.d.STAGE / name).write_bytes(data.encode())
        self.d.SHARED_RUNNER_SHA = sha(sources['shared-deploy.py'].encode())
        self.d.GATE_SHA = sha(sources['deployment_gate.sh'].encode())
        self.manifest = {
            'files': {'channel_bridge.py': {'before': sha(self.before), 'after': sha(self.after)}},
            'mirror': dict(self.d.MIRROR_PINS),
            'inputs': {name: sha(data.encode()) for name, data in sources.items()},
        }

        class Runner:
            def __init__(runner):
                runner.writes, runner.restarts = [], 0
                runner.on_health = lambda: None
                runner.on_copy = lambda source, target: None
                runner.on_restart = lambda: None
                runner.fail_health_once = False

            def health(runner):
                runner.on_health()
                return {'status': 'ok'}

            def atomic_copy(runner, source, target, attributes):
                runner.writes.append(target)
                temporary = target.with_suffix('.atomic')
                shutil.copy2(source, temporary)
                os.replace(temporary, target)
                runner.on_copy(source, target)

            def restart(runner):
                runner.restarts += 1
                runner.on_restart()

            def wait_health(runner):
                if runner.fail_health_once and runner.restarts == 1:
                    raise RuntimeError('Synthetic health failure')
                return {'status': 'ok'}

        self.runner = Runner()
        self.target = self.d.ROOT / 'channel_bridge.py'
        self.mirror_target = self.d.MIRROR / 'channel_bridge.py'

    def manifest_pin(self):
        raw = json.dumps(self.manifest).encode()
        (self.d.STAGE / 'deploy-manifest.json').write_bytes(raw)
        return sha(raw)

    def snapshot(self):
        return {str(p.relative_to(self.base)): (p.read_bytes(), p.stat().st_mtime_ns)
                for p in self.base.rglob('*') if p.is_file()}

    def rollout(self, **kwargs):
        return self.d.rollout(self.manifest, self.candidate, self.runner, **kwargs)

    def receipt(self):
        return json.loads(next(self.d.BACKUPS.glob('*/receipt.json')).read_bytes())

    def assert_no_live_writes(self):
        self.assertEqual(self.runner.writes, [])
        self.assertEqual(self.runner.restarts, 0)
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertEqual(self.mirror_target.read_bytes(), self.mirror)

    def test_check_does_not_materialize_write_or_restart(self):
        pin = self.manifest_pin()
        before = self.snapshot()
        manifest = self.d.checked_manifest(pin)
        candidate = self.d.assemble(manifest)
        result = self.d.rollout(manifest, candidate, self.runner, check_only=True)
        self.assertEqual(result['status'], 'checked')
        self.assertEqual(self.snapshot(), before)
        self.assert_no_live_writes()
        self.assertFalse((self.d.STAGE / 'candidate').exists())
        self.assertFalse(self.d.BACKUPS.exists())

    def test_install_only_one_live_file_and_never_write_mirror_or_config(self):
        mirror_before = (self.mirror_target.read_bytes(), self.mirror_target.stat().st_mtime_ns)
        result = self.rollout()
        self.assertEqual(result['status'], 'deployed')
        self.assertEqual(self.runner.writes, [self.target])
        self.assertEqual(self.target.read_bytes(), self.after)
        self.assertEqual((self.mirror_target.read_bytes(), self.mirror_target.stat().st_mtime_ns), mirror_before)
        self.assertEqual(len(list(Path(result['backup']).glob('*.py'))), 1)
        for root in (self.d.ROOT, self.d.MIRROR):
            self.assertEqual((root / 'workflow_config.json').read_bytes(), b'untouched configuration\n')

    def test_health_failure_restores_known_bytes_and_only_live_target(self):
        self.runner.fail_health_once = True
        with self.assertRaisesRegex(RuntimeError, 'health failure'):
            self.rollout()
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertEqual(self.runner.writes, [self.target, self.target])
        self.assertEqual(self.mirror_target.read_bytes(), self.mirror)
        self.assertEqual(self.runner.restarts, 2)
        self.assertEqual(self.receipt()['status'], 'rolled_back')

    def test_unhealthy_initial_service_prevents_materialization(self):
        def fail():
            raise RuntimeError('Initial health failure')
        self.runner.on_health = fail
        with self.assertRaisesRegex(RuntimeError, 'Initial health'):
            self.rollout()
        self.assert_no_live_writes()
        self.assertFalse((self.d.STAGE / 'candidate').exists())

    def test_concurrent_live_drift_after_backup_prevents_first_write(self):
        original = shutil.copy2
        def racing_copy(source, target, *args, **kwargs):
            result = original(source, target, *args, **kwargs)
            if Path(target).parent.parent == self.d.BACKUPS:
                self.target.write_bytes(b'concurrent = True\n')
            return result
        with patch.object(self.d.shutil, 'copy2', side_effect=racing_copy):
            with self.assertRaisesRegex(RuntimeError, 'Concurrent source drift'):
                self.rollout()
        self.assertEqual(self.target.read_bytes(), b'concurrent = True\n')
        self.assertEqual(self.runner.writes, [])
        self.assertEqual(self.runner.restarts, 0)

    def test_postrestart_concurrent_writer_is_preserved_during_rollback(self):
        def race():
            if self.runner.restarts == 1:
                self.target.write_bytes(b'concurrent = True\n')
        self.runner.on_restart = race
        with self.assertRaisesRegex(RuntimeError, 'Post-restart source drift'):
            self.rollout()
        self.assertEqual(self.target.read_bytes(), b'concurrent = True\n')
        self.assertEqual(self.runner.writes, [self.target])
        self.assertEqual(self.receipt()['status'], 'rollback_incomplete')
        self.assertTrue(any('Concurrent writer' in error for error in self.receipt()['errors']))
        self.assertEqual(self.mirror_target.read_bytes(), self.mirror)

    def test_corrupted_backup_is_never_restored(self):
        def corrupt():
            if self.runner.restarts == 1:
                next(self.d.BACKUPS.glob('*/0-channel_bridge.py')).write_bytes(b'corrupt = True\n')
        self.runner.on_restart = corrupt
        self.runner.fail_health_once = True
        with self.assertRaisesRegex(RuntimeError, 'health failure'):
            self.rollout()
        self.assertEqual(self.target.read_bytes(), self.after)
        self.assertEqual(self.runner.writes, [self.target])
        self.assertEqual(self.receipt()['status'], 'rollback_incomplete')

    def test_copy_that_replaces_then_raises_is_rolled_back(self):
        def fail(source, target):
            if len(self.runner.writes) == 1:
                raise RuntimeError('Copy failed after replace')
        self.runner.on_copy = fail
        with self.assertRaisesRegex(RuntimeError, 'Copy failed'):
            self.rollout()
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertEqual(self.receipt()['status'], 'rolled_back')

    def test_rollback_rechecks_hash_after_recovery_restart(self):
        self.runner.fail_health_once = True
        def race():
            if self.runner.restarts == 2:
                self.target.write_bytes(b'concurrent = True\n')
        self.runner.on_restart = race
        with self.assertRaisesRegex(RuntimeError, 'health failure'):
            self.rollout()
        self.assertEqual(self.target.read_bytes(), b'concurrent = True\n')
        self.assertEqual(self.receipt()['status'], 'rollback_incomplete')

    def test_mirror_drift_blocks_initial_write(self):
        self.mirror_target.write_bytes(b'concurrent = True\n')
        with self.assertRaisesRegex(RuntimeError, 'mirror'):
            self.rollout()
        self.assertEqual(self.runner.writes, [])

    def test_mirror_drift_after_restart_is_preserved_and_live_restored(self):
        self.runner.on_restart = lambda: self.mirror_target.write_bytes(b'concurrent = True\n')
        with self.assertRaisesRegex(RuntimeError, 'mirror'):
            self.rollout()
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertEqual(self.mirror_target.read_bytes(), b'concurrent = True\n')
        self.assertEqual(self.receipt()['status'], 'rollback_incomplete')

    def test_manifest_rejects_changed_before_and_changed_after_exact_pins(self):
        for key in ('before', 'after'):
            with self.subTest(key=key):
                original = self.manifest['files']['channel_bridge.py'][key]
                self.manifest['files']['channel_bridge.py'][key] = '0' * 64
                with self.assertRaisesRegex(RuntimeError, 'pins'):
                    self.d.checked_manifest(self.manifest_pin())
                self.manifest['files']['channel_bridge.py'][key] = original

    def test_manifest_rejects_wrong_digest_extra_target_or_mirror_guard(self):
        self.manifest_pin()
        with self.assertRaisesRegex(RuntimeError, 'Manifest hash'):
            self.d.checked_manifest('0' * 64)
        self.manifest['files']['config.py'] = dict(self.manifest['files']['channel_bridge.py'])
        with self.assertRaisesRegex(RuntimeError, 'scope'):
            self.d.checked_manifest(self.manifest_pin())
        del self.manifest['files']['config.py']
        self.manifest['mirror'] = {}
        with self.assertRaisesRegex(RuntimeError, 'mirror'):
            self.d.checked_manifest(self.manifest_pin())

    def test_manifest_rejects_staged_input_drift(self):
        pin = self.manifest_pin()
        (self.d.STAGE / 'deployment_gate.sh').write_bytes(b'changed\n')
        with self.assertRaisesRegex(RuntimeError, 'input mismatch'):
            self.d.checked_manifest(pin)
        self.assert_no_live_writes()

    def test_manifest_rejects_self_consistent_wrong_runner_and_gate(self):
        for name in ('shared-deploy.py', 'deployment_gate.sh'):
            with self.subTest(name=name):
                old = (self.d.STAGE / name).read_bytes()
                (self.d.STAGE / name).write_bytes(b'changed\n')
                self.manifest['inputs'][name] = sha(b'changed\n')
                with self.assertRaisesRegex(RuntimeError, 'runner|gate'):
                    self.d.checked_manifest(self.manifest_pin())
                (self.d.STAGE / name).write_bytes(old)
                self.manifest['inputs'][name] = sha(old)

    def test_patcher_and_runner_drift_before_execution_is_refused(self):
        self.d.checked_manifest(self.manifest_pin())
        patcher = self.d.STAGE / 'patch_bridge.py'
        patcher.write_bytes(b'raise AssertionError("UNREVIEWED CODE EXECUTED")\n')
        with self.assertRaisesRegex(RuntimeError, 'input mismatch'):
            self.d.assemble(self.manifest)
        runner = self.d.STAGE / 'shared-deploy.py'
        runner.write_bytes(b'raise AssertionError("UNREVIEWED CODE EXECUTED")\n')
        with self.assertRaisesRegex(RuntimeError, 'input mismatch'):
            self.d.load('drifted_runner', runner, self.d.SHARED_RUNNER_SHA)
        self.assert_no_live_writes()

    def test_wrong_candidate_and_invalid_syntax_fail_before_live_write(self):
        self.candidate['channel_bridge.py'] = b'drift = True\n'
        with self.assertRaisesRegex(RuntimeError, 'Candidate'):
            self.rollout()
        bad = b'def broken(\n'
        self.candidate['channel_bridge.py'] = bad
        self.manifest['files']['channel_bridge.py']['after'] = sha(bad)
        with self.assertRaises(SyntaxError):
            self.rollout()
        self.assert_no_live_writes()

    def test_existing_candidate_is_never_silently_overwritten(self):
        path = self.d.STAGE / 'candidate/channel_bridge.py'
        path.parent.mkdir()
        path.write_bytes(b'private = True\n')
        for check in (False, True):
            with self.subTest(check=check), self.assertRaisesRegex(RuntimeError, 'candidate'):
                self.rollout(check_only=check)
        self.assertEqual(path.read_bytes(), b'private = True\n')
        self.assert_no_live_writes()

    def test_candidate_modified_after_backup_aborts_before_write(self):
        original = shutil.copy2
        def race(source, target, *args, **kwargs):
            result = original(source, target, *args, **kwargs)
            if Path(target).parent.parent == self.d.BACKUPS:
                (self.d.STAGE / 'candidate/channel_bridge.py').write_bytes(b'drift = True\n')
            return result
        with patch.object(self.d.shutil, 'copy2', side_effect=race):
            with self.assertRaisesRegex(RuntimeError, 'Candidate drift'):
                self.rollout()
        self.assert_no_live_writes()

    def test_existing_live_candidate_and_backup_aliases_are_rejected(self):
        for path in (self.target, self.d.STAGE / 'candidate/channel_bridge.py'):
            with self.subTest(path=str(path)):
                if not path.exists():
                    path.parent.mkdir(exist_ok=True)
                    path.write_bytes(self.after)
                alias = self.base / 'hardlink.py'
                os.link(path, alias)
                try:
                    with self.assertRaisesRegex(RuntimeError, 'alias'):
                        self.rollout()
                finally:
                    alias.unlink()
        # Existing directory aliases are rejected before backups/live writes.
        with self.assertRaisesRegex(RuntimeError, 'alias'):
            self.d.directory(self.target)
        self.assert_no_live_writes()

    def test_existing_backup_file_is_rejected_before_live_write(self):
        self.d.BACKUPS.write_bytes(b'preserve existing path\n')
        with self.assertRaisesRegex(RuntimeError, 'directory alias'):
            self.rollout()
        self.assertEqual(self.d.BACKUPS.read_bytes(), b'preserve existing path\n')
        self.assert_no_live_writes()

    def test_live_and_backup_parent_aliases_are_rejected(self):
        self.d.ROOT = self.base / 'live/../live'
        with self.assertRaisesRegex(RuntimeError, 'alias'):
            self.rollout()
        self.d.ROOT = self.base / 'live'
        (self.base / 'existing').mkdir()
        self.d.BACKUPS = self.base / 'existing/../backups'
        with self.assertRaisesRegex(RuntimeError, 'alias'):
            self.rollout()
        self.assert_no_live_writes()

    def test_real_source_pins_and_real_patcher_produce_exact_manifest_candidate(self):
        real = load_module('document_person_deploy_real', PATCH_ROOT / 'deploy.py')
        self.assertEqual(real.FILES, ('channel_bridge.py',))
        self.assertEqual(real.BEFORE, {'channel_bridge.py': '85f963428e6f82ab5207d1c75c177aeba20d42ba47136257652bc53e6c52f164'})
        self.assertEqual(real.AFTER, {'channel_bridge.py': '15ad4a8e23a8ee475719463199fe0a6d34e792fff4c3ed21676849596ad46bea'})
        self.assertEqual(real.MIRROR_PINS, {'channel_bridge.py': 'a5a8244d6525f34f53de781caa399570073df1f55ef8148ed4c1c5f9cdfa5e19'})
        patcher = load_module('document_person_real_patcher', PATCH_ROOT / 'patch_bridge.py')
        self.assertEqual(sha(patcher.patch_bridge(pinned_source('production')).encode()), real.AFTER['channel_bridge.py'])

    def test_manifest_builder_verifies_real_source_runner_and_exact_candidate(self):
        builder_path = PATCH_ROOT / 'build_manifest.py'
        self.assertTrue(builder_path.is_file(), 'Pinned manifest generator must be prepared')
        builder = load_module('document_person_manifest_builder', builder_path)
        runner = Path(os.environ['DOCUMENT_PERSON_SHARED_RUNNER_PATH'])
        source = PRIVATE_ROOT / 'channel_bridge.before.py'
        manifest = builder.build_manifest(source, runner)
        self.assertEqual(manifest['files'], {'channel_bridge.py': {
            'before': '85f963428e6f82ab5207d1c75c177aeba20d42ba47136257652bc53e6c52f164',
            'after': '15ad4a8e23a8ee475719463199fe0a6d34e792fff4c3ed21676849596ad46bea'}})
        self.assertEqual(set(manifest['inputs']), {'patch_bridge.py', 'deploy.py', 'deploy.sh', 'deployment_gate.sh', 'shared-deploy.py'})
        self.assertEqual(manifest['inputs']['shared-deploy.py'], '01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2')
        bad = self.base / 'bad.py'
        bad.write_bytes(b'wrong = True\n')
        with self.assertRaisesRegex(RuntimeError, 'source|Source'):
            builder.build_manifest(bad, runner)
        with self.assertRaisesRegex(RuntimeError, 'runner|Runner'):
            builder.build_manifest(source, bad)


if __name__ == '__main__':
    unittest.main()
