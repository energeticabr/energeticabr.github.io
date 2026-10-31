"""Synthetic deployment contract tests. No network, services or real user files."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


def sha(data):
    return hashlib.sha256(data).hexdigest()


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('deploy.py')
        self.assertTrue(path.is_file(), 'Safe pinned deployment wrapper is required')
        spec = importlib.util.spec_from_file_location('signed_global_discount_deploy', path)
        self.d = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.d)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.d.ROOT = self.base / 'live'
        self.d.MIRROR = self.base / 'mirror'
        self.d.STAGE = self.base / 'release'
        self.d.BACKUPS = self.base / 'backups'
        self.d.STAGE.mkdir()
        # Exercise cross-file rollback on two synthetic modules independently
        # of the four-file production scope pinned by the real manifest.
        self.files = ('worker/payment_provision_flow.py', 'worker/workflow.py')
        self.d.FILES = self.files
        self.before = b'old = True\n'
        self.after = b'new = True\n'
        self.mirror = b'mirror_without_level_api = True\n'
        self.candidate = dict.fromkeys(self.files, self.after)
        self.d.BEFORE = dict.fromkeys(self.files, sha(self.before))
        self.d.MIRROR_PINS = dict.fromkeys(self.files, sha(self.mirror))
        for root, data in ((self.d.ROOT, self.before), (self.d.MIRROR, self.mirror)):
            for relative in self.files:
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
        sources = {
            'patch_backend.py': 'def patch(relative, data):\n    return data.replace(b"old", b"new")\n',
            'deploy.py': '# synthetic wrapper input\n',
            'deploy.sh': '# synthetic shell input\n',
            'deployment_gate.sh': '# synthetic gate input\n',
            'shared-deploy.py': '# synthetic runner input\n',
            'source.patch': '# synthetic public diff\n',
            'source-files.tar': '# synthetic private bundle\n',
        }
        for relative, data in sources.items():
            (self.d.STAGE / relative).write_bytes(data.encode('utf-8'))
        self.d.SHARED_RUNNER_SHA = sha(sources['shared-deploy.py'].encode())
        self.manifest = {
            'files': {name: {'before': sha(self.before), 'after': sha(self.after)} for name in self.files},
            'mirror': dict(self.d.MIRROR_PINS),
            'inputs': {name: sha(data.encode()) for name, data in sources.items()},
        }
        install_bytes = self.d.atomic_bytes
        class Runner:
            def __init__(self):
                self.restarts = 0
                self.writes = []
                self.on_health = lambda: None
                self.on_before_copy = lambda source, target: None
                self.on_copy = lambda source, target: None
                self.on_restart = lambda: None
                self.fail_health_once = False

            def health(self):
                self.on_health()
                return {'status': 'ok'}

            def atomic_bytes(self, source, target, attributes, *, expected):
                self.writes.append(target)
                self.on_before_copy(source, target)
                install_bytes(source, target, attributes, expected=expected)
                self.on_copy(source, target)

            def restart(self):
                self.restarts += 1
                self.on_restart()

            def wait_health(self):
                if self.fail_health_once and self.restarts == 1:
                    raise RuntimeError('Synthetic health failure')
                return {'status': 'ok'}

        self.runner = Runner()
        self.d.atomic_bytes = self.runner.atomic_bytes

    def manifest_pin(self):
        path = self.d.STAGE / 'deploy-manifest.json'
        path.write_text(json.dumps(self.manifest), encoding='utf-8')
        return sha(path.read_bytes())

    def contents(self, root=None):
        return [(root or self.d.ROOT).joinpath(name).read_bytes() for name in self.files]

    def run_rollout(self, **kwargs):
        return self.d.rollout(self.manifest, self.candidate, self.runner, **kwargs)

    def assert_untouched(self):
        self.assertEqual(self.contents(), [self.before] * len(self.files))
        self.assertEqual(self.contents(self.d.MIRROR), [self.mirror] * len(self.files))
        self.assertEqual(self.runner.writes, [])
        self.assertEqual(self.runner.restarts, 0)

    # Removing the check-only early return must create files or restart and fail this.
    def test_check_has_no_file_writes_or_restart(self):
        self.manifest_pin()
        def snapshot():
            return {str(p.relative_to(self.base)): (p.read_bytes(), p.stat().st_mtime_ns)
                    for p in self.base.rglob('*') if p.is_file()}
        before = snapshot()
        manifest = self.d.checked_manifest(sha((self.d.STAGE / 'deploy-manifest.json').read_bytes()))
        data = self.d.assemble(manifest)
        result = self.d.rollout(self.manifest, data, self.runner, check_only=True)
        self.assertEqual(result['status'], 'checked')
        self.assertEqual(before, snapshot())
        self.assert_untouched()

    def test_install_exactly_two_live_targets_and_keep_mirror(self):
        result = self.run_rollout()
        self.assertEqual(result['status'], 'deployed')
        self.assertEqual(self.contents(), [self.after] * len(self.files))
        self.assertEqual(self.contents(self.d.MIRROR), [self.mirror] * len(self.files))
        self.assertEqual(set(self.runner.writes), {self.d.ROOT / name for name in self.files})
        self.assertEqual(self.runner.restarts, 1)
        backup = Path(result['backup'])
        self.assertEqual(len(list(backup.glob('*.py'))), len(self.files))
        self.assertEqual([p.read_bytes() for p in backup.glob('*.py')], [self.before] * len(self.files))
        for name in self.files:
            self.assertEqual((self.d.STAGE / 'candidate' / name).read_bytes(), self.after)

    def test_health_failure_restores_every_original(self):
        self.runner.fail_health_once = True
        with self.assertRaisesRegex(RuntimeError, 'health failure'):
            self.run_rollout()
        self.assertEqual(self.contents(), [self.before] * len(self.files))
        self.assertEqual(self.contents(self.d.MIRROR), [self.mirror] * len(self.files))
        self.assertEqual(self.runner.restarts, 2)
        receipt = json.loads(next(self.d.BACKUPS.glob('*/receipt.json')).read_text())
        self.assertEqual(receipt['status'], 'rolled_back')

    def test_candidate_swap_on_copy_never_installs_bad_bytes_and_rolls_back_healthy(self):
        bad = b'unreviewed_candidate = True\n'
        installed, restarted = [], []
        def swap(source, target):
            if len(self.runner.writes) == 1:
                (self.d.STAGE / 'candidate' / self.files[0]).write_bytes(bad)
        self.runner.on_before_copy = swap
        self.runner.on_copy = lambda source, target: installed.append(target.read_bytes())
        self.runner.on_restart = lambda: restarted.append(self.contents())
        with self.assertRaises(RuntimeError):
            self.run_rollout()
        self.assertNotIn(bad, installed, 'Unreviewed candidate bytes reached a live target')
        self.assertEqual(self.contents(), [self.before] * len(self.files))
        self.assertEqual(restarted, [[self.before] * len(self.files)])
        self.assertEqual(self.runner.wait_health(), {'status': 'ok'})
        receipt = json.loads(next(self.d.BACKUPS.glob('*/receipt.json')).read_text())
        self.assertEqual(receipt['status'], 'rolled_back')
        self.assertEqual(receipt['errors'], [])

    def test_backup_swap_on_restore_never_installs_bad_bytes_and_recovers_health(self):
        bad = b'unreviewed_backup = True\n'
        installed, restarted = [], []
        self.runner.fail_health_once = True
        def swap(source, target):
            if len(self.runner.writes) == len(self.files) + 1:
                next(self.d.BACKUPS.glob('*/0-payment_provision_flow.py')).write_bytes(bad)
        self.runner.on_before_copy = swap
        self.runner.on_copy = lambda source, target: installed.append(target.read_bytes())
        self.runner.on_restart = lambda: restarted.append(self.contents())
        with self.assertRaisesRegex(RuntimeError, 'health failure'):
            self.run_rollout()
        self.assertNotIn(bad, installed, 'Unreviewed backup bytes reached a live target')
        self.assertEqual(self.contents(), [self.before] * len(self.files))
        self.assertEqual(restarted, [[self.after] * len(self.files), [self.before] * len(self.files)])
        self.assertEqual(self.runner.wait_health(), {'status': 'ok'})
        receipt = json.loads(next(self.d.BACKUPS.glob('*/receipt.json')).read_text())
        self.assertEqual(receipt['status'], 'rolled_back')
        self.assertEqual(receipt['errors'], [])

    def test_all_candidate_hashes_are_checked_before_writes(self):
        self.candidate[self.files[-1]] = b'drift = True\n'
        with self.assertRaisesRegex(RuntimeError, 'Candidate'):
            self.run_rollout()
        self.assert_untouched()

    def test_all_candidates_compile_before_writes(self):
        bad = b'def broken(\n'
        self.candidate[self.files[-1]] = bad
        self.manifest['files'][self.files[-1]]['after'] = sha(bad)
        with self.assertRaises(SyntaxError):
            self.run_rollout()
        self.assert_untouched()

    def test_source_drift_blocks_even_first_write(self):
        (self.d.ROOT / self.files[-1]).write_bytes(b'concurrent = True\n')
        with self.assertRaisesRegex(RuntimeError, 'drift'):
            self.run_rollout()
        self.assertEqual(self.runner.writes, [])
        self.assertEqual(self.runner.restarts, 0)

    def test_mirror_drift_blocks_writes(self):
        (self.d.MIRROR / self.files[0]).write_bytes(b'drift = True\n')
        with self.assertRaisesRegex(RuntimeError, 'mirror|Mirror'):
            self.run_rollout()
        self.assertEqual(self.runner.writes, [])
        self.assertEqual(self.contents(), [self.before] * len(self.files))

    def test_cas_before_second_write_preserves_new_writer(self):
        def concurrent(source, target):
            if len(self.runner.writes) == 1:
                (self.d.ROOT / self.files[1]).write_bytes(b'concurrent = True\n')
        self.runner.on_copy = concurrent
        with self.assertRaisesRegex(RuntimeError, 'Concurrent'):
            self.run_rollout()
        self.assertEqual(self.contents(), [self.before, b'concurrent = True\n'])

    def test_postrestart_drift_is_preserved_in_incomplete_rollback(self):
        def concurrent():
            if self.runner.restarts == 1:
                (self.d.ROOT / self.files[0]).write_bytes(b'concurrent = True\n')
        self.runner.on_restart = concurrent
        with self.assertRaisesRegex(RuntimeError, 'Post-restart'):
            self.run_rollout()
        self.assertEqual(self.contents(), [b'concurrent = True\n', self.before])
        receipt = json.loads(next(self.d.BACKUPS.glob('*/receipt.json')).read_text())
        self.assertEqual(receipt['status'], 'rollback_incomplete')
        self.assertTrue(any('Concurrent writer' in text for text in receipt['errors']))

    def test_rollback_refuses_corrupted_backup_but_restores_other_files(self):
        def corrupt():
            if self.runner.restarts == 1:
                next(self.d.BACKUPS.glob('*/0-payment_provision_flow.py')).write_bytes(b'corrupt = True\n')
        self.runner.on_restart = corrupt
        self.runner.fail_health_once = True
        with self.assertRaisesRegex(RuntimeError, 'health failure'):
            self.run_rollout()
        self.assertEqual(self.contents(), [self.after, self.before])
        receipt = json.loads(next(self.d.BACKUPS.glob('*/receipt.json')).read_text())
        self.assertEqual(receipt['status'], 'rollback_incomplete')

    def test_existing_candidate_drift_is_not_overwritten(self):
        path = self.d.STAGE / 'candidate' / self.files[-1]
        path.parent.mkdir(parents=True)
        path.write_bytes(b'private_change = True\n')
        with self.assertRaisesRegex(RuntimeError, 'candidate|Candidate'):
            self.run_rollout()
        self.assertEqual(path.read_bytes(), b'private_change = True\n')
        self.assert_untouched()

    def test_check_rejects_existing_candidate_drift_without_writes(self):
        path = self.d.STAGE / 'candidate' / self.files[-1]
        path.parent.mkdir(parents=True)
        path.write_bytes(b'private_change = True\n')
        with self.assertRaisesRegex(RuntimeError, 'candidate|Candidate'):
            self.run_rollout(check_only=True)
        self.assert_untouched()

    def test_candidate_changed_between_live_writes_aborts(self):
        def drift(source, target):
            if len(self.runner.writes) == 1:
                (self.d.STAGE / 'candidate' / self.files[1]).write_bytes(b'drift = True\n')
        self.runner.on_copy = drift
        with self.assertRaisesRegex(RuntimeError, 'Candidate'):
            self.run_rollout()
        self.assertEqual(self.contents(), [self.before] * len(self.files))

    def test_mirror_changed_during_rollout_prevents_success_receipt(self):
        def drift():
            (self.d.MIRROR / self.files[0]).write_bytes(b'concurrent = True\n')
        self.runner.on_restart = drift
        with self.assertRaisesRegex(RuntimeError, 'mirror|Mirror'):
            self.run_rollout()
        self.assertEqual(self.contents(), [self.before] * len(self.files))
        self.assertEqual((self.d.MIRROR / self.files[0]).read_bytes(), b'concurrent = True\n')

    def test_manifest_requires_external_reviewed_digest(self):
        self.manifest_pin()
        with self.assertRaisesRegex(RuntimeError, 'Manifest hash'):
            self.d.checked_manifest('0' * 64)
        self.assert_untouched()

    def test_manifest_rejects_extra_target(self):
        self.manifest['files']['config.py'] = dict(self.manifest['files'][self.files[0]])
        with self.assertRaisesRegex(RuntimeError, 'scope'):
            self.d.checked_manifest(self.manifest_pin())

    def test_manifest_rejects_changed_baseline(self):
        self.manifest['files'][self.files[0]]['before'] = '0' * 64
        with self.assertRaisesRegex(RuntimeError, 'pins'):
            self.d.checked_manifest(self.manifest_pin())

    def test_manifest_rejects_missing_guard(self):
        del self.manifest['mirror'][self.files[0]]
        with self.assertRaisesRegex(RuntimeError, 'mirror|Mirror'):
            self.d.checked_manifest(self.manifest_pin())

    def test_manifest_rejects_extra_package_input(self):
        self.manifest['inputs']['other.py'] = '0' * 64
        with self.assertRaisesRegex(RuntimeError, 'inputs'):
            self.d.checked_manifest(self.manifest_pin())

    def test_manifest_rejects_unreviewed_input(self):
        (self.d.STAGE / 'deployment_gate.sh').write_bytes(b'changed\n')
        with self.assertRaisesRegex(RuntimeError, 'input mismatch'):
            self.d.checked_manifest(self.manifest_pin())

    def test_manifest_rejects_wrong_shared_runner_even_when_self_consistent(self):
        data = b'wrong_runner = True\n'
        (self.d.STAGE / 'shared-deploy.py').write_bytes(data)
        self.manifest['inputs']['shared-deploy.py'] = sha(data)
        with self.assertRaisesRegex(RuntimeError, 'Shared runner'):
            self.d.checked_manifest(self.manifest_pin())

    def test_assemble_derives_all_candidates_without_creating_files(self):
        self.d.checked_manifest(self.manifest_pin())
        self.assertEqual(self.d.assemble(self.manifest), dict.fromkeys(self.files, self.after))
        self.assertFalse((self.d.STAGE / 'candidate').exists())
        self.assertFalse(list(self.d.STAGE.rglob('__pycache__')))

    def test_assemble_refuses_wrong_patched_output(self):
        self.manifest['files'][self.files[-1]]['after'] = '0' * 64
        with self.assertRaisesRegex(RuntimeError, 'Candidate'):
            self.d.assemble(self.manifest)
        self.assert_untouched()

    def test_patcher_changed_after_manifest_verification_is_not_executed(self):
        self.d.checked_manifest(self.manifest_pin())
        path = self.d.STAGE / 'patch_backend.py'
        path.write_bytes(path.read_bytes() + b'\nraise AssertionError("unreviewed code ran")\n')
        with self.assertRaisesRegex(RuntimeError, 'input mismatch'):
            self.d.assemble(self.manifest)
        self.assert_untouched()

    def test_loaded_runner_bytes_must_match_reviewed_pin(self):
        path = self.d.STAGE / 'shared-deploy.py'
        path.write_bytes(b'raise AssertionError("unreviewed runner ran")\n')
        with self.assertRaisesRegex(RuntimeError, 'input mismatch'):
            self.d.load('synthetic_runner', path, self.d.SHARED_RUNNER_SHA)
        self.assert_untouched()

    def test_rollback_rechecks_restored_hashes_after_recovery_restart(self):
        self.runner.fail_health_once = True
        def drift():
            if self.runner.restarts == 2:
                (self.d.ROOT / self.files[0]).write_bytes(b'concurrent = True\n')
        self.runner.on_restart = drift
        with self.assertRaisesRegex(RuntimeError, 'health failure'):
            self.run_rollout()
        self.assertEqual(self.contents(), [b'concurrent = True\n', self.before])
        receipt = json.loads(next(self.d.BACKUPS.glob('*/receipt.json')).read_text())
        self.assertEqual(receipt['status'], 'rollback_incomplete')

    def test_atomic_copy_that_replaces_then_raises_is_rolled_back(self):
        def fail(source, target):
            if len(self.runner.writes) == 2:
                raise RuntimeError('Synthetic copy failure after replace')
        self.runner.on_copy = fail
        with self.assertRaisesRegex(RuntimeError, 'copy failure'):
            self.run_rollout()
        self.assertEqual(self.contents(), [self.before] * len(self.files))
        self.assertEqual(self.runner.restarts, 1)

    def test_failed_restore_does_not_prevent_other_restores(self):
        self.runner.fail_health_once = True
        def fail(source, target):
            if len(self.runner.writes) == 3:
                target.write_bytes(b'failed_restore = True\n')
                raise RuntimeError('Synthetic restore failure')
        self.runner.on_copy = fail
        with self.assertRaisesRegex(RuntimeError, 'health failure'):
            self.run_rollout()
        self.assertEqual(self.contents(), [b'failed_restore = True\n', self.before])
        receipt = json.loads(next(self.d.BACKUPS.glob('*/receipt.json')).read_text())
        self.assertEqual(receipt['status'], 'rollback_incomplete')

    def test_hardlinked_live_file_is_rejected(self):
        source = self.d.ROOT / self.files[0]
        os.link(source, self.base / 'alias.py')
        with self.assertRaisesRegex(RuntimeError, 'alias'):
            self.run_rollout()
        self.assert_untouched()

    @unittest.skipIf(os.name == 'nt', 'Requires Linux symlink QA')
    def test_symlinked_live_parent_is_rejected(self):
        worker = self.d.ROOT / 'worker'
        moved = self.base / 'elsewhere'
        worker.rename(moved)
        worker.symlink_to(moved, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'alias'):
            self.run_rollout()
        self.assert_untouched()


class AtomicBytesTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('atomic_bytes_test_deploy', Path(__file__).with_name('deploy.py'))
        self.d = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.d)
        self.assertTrue(callable(getattr(self.d, 'atomic_bytes', None)), 'Atomic byte installer is required')
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name).resolve()
        self.target = self.base / 'live.py'
        self.before, self.after = b'old = True\n', b'new = True\n'
        self.target.write_bytes(self.before)
        self.attributes = self.target.stat()

    def install(self):
        self.d.atomic_bytes(self.after, self.target, self.attributes, expected=sha(self.before))

    def test_exact_bytes_are_flushed_before_replace_and_temporary_file_is_removed(self):
        fsync, replace = os.fsync, os.replace
        events = []
        def sync(fd):
            events.append('fsync')
            fsync(fd)
        def install(source, target):
            self.assertEqual(events, ['fsync'])
            self.assertEqual(self.target.read_bytes(), self.before)
            self.assertEqual(Path(source).read_bytes(), self.after)
            events.append('replace')
            replace(source, target)
        with patch.object(self.d.os, 'fsync', side_effect=sync), patch.object(self.d.os, 'replace', side_effect=install):
            self.install()
        self.assertEqual(self.target.read_bytes(), self.after)
        self.assertEqual(list(self.base.iterdir()), [self.target])
        self.assertEqual(events, ['fsync', 'replace'] if os.name == 'nt' else ['fsync', 'replace', 'fsync'])

    def test_replace_failure_leaves_original_and_no_temporary_payload(self):
        with patch.object(self.d.os, 'replace', side_effect=OSError('synthetic replace failure')):
            with self.assertRaisesRegex(OSError, 'replace failure'):
                self.install()
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertEqual(list(self.base.iterdir()), [self.target])

    def test_live_cas_is_rechecked_after_temp_fsync_before_replace(self):
        fsync = os.fsync
        other = b'concurrent = True\n'
        def concurrent(fd):
            self.target.write_bytes(other)
            fsync(fd)
        with patch.object(self.d.os, 'fsync', side_effect=concurrent):
            with self.assertRaisesRegex(RuntimeError, 'Concurrent source drift'):
                self.install()
        self.assertEqual(self.target.read_bytes(), other)
        self.assertEqual(list(self.base.iterdir()), [self.target])

    @unittest.skipIf(os.name == 'nt', 'Requires Unix ownership and permissions')
    def test_preserves_mode_uid_and_gid(self):
        self.target.chmod(0o640)
        self.attributes = self.target.stat()
        self.install()
        info = self.target.stat()
        self.assertEqual(info.st_mode & 0o7777, 0o640)
        self.assertEqual((info.st_uid, info.st_gid), (self.attributes.st_uid, self.attributes.st_gid))


class FourFileDeploymentTests(unittest.TestCase):
    """Removing JSON validation or omitting config from rollback must fail here."""

    def setUp(self):
        fixture = DeploymentTests('runTest')
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.f = fixture
        self.d = fixture.d
        self.files = ('worker/payment_provision_group.py', 'worker/payment_provision_flow.py',
                      'worker/workflow.py', 'worker/workflow_config.json')
        self.d.FILES = self.files
        self.before = {name: (b'{"prompt": null}\n' if name.endswith('.json') else b'old = True\n')
                       for name in self.files}
        self.after = {name: (b'{"prompt": true}\n' if name.endswith('.json') else b'new = True\n')
                      for name in self.files}
        self.d.BEFORE = {name: sha(data) for name, data in self.before.items()}
        self.d.MIRROR_PINS = dict(self.d.BEFORE)
        self.manifest = fixture.manifest
        self.manifest['files'] = {name: {'before': sha(self.before[name]), 'after': sha(self.after[name])}
                                  for name in self.files}
        self.manifest['mirror'] = dict(self.d.MIRROR_PINS)
        for root in (self.d.ROOT, self.d.MIRROR):
            for name, data in self.before.items():
                (root / name).write_bytes(data)
        self.runner = fixture.runner

    def rollout(self, **kwargs):
        return self.d.rollout(self.manifest, self.after, self.runner, **kwargs)

    def contents(self, root):
        return {name: (root / name).read_bytes() for name in self.files}

    def replace_config(self, data):
        name = self.files[-1]
        self.after[name] = data
        self.manifest['files'][name]['after'] = sha(data)

    def test_json_literals_are_parsed_and_all_four_live_files_installed(self):
        # JSON null/true are valid config and must never be compiled as Python.
        result = self.rollout()
        self.assertEqual(result['status'], 'deployed')
        self.assertEqual(self.contents(self.d.ROOT), self.after)
        self.assertEqual(self.contents(self.d.MIRROR), self.before)
        self.assertEqual(set(self.runner.writes), {self.d.ROOT / name for name in self.files})
        backup = Path(result['backup'])
        self.assertEqual((backup / '3-workflow_config.json').read_bytes(), self.before[self.files[-1]])
        self.assertEqual(len(result['after']), 4)

    def test_check_with_json_does_not_create_candidates_or_backups(self):
        self.assertEqual(self.rollout(check_only=True)['status'], 'checked')
        self.assertFalse((self.d.STAGE / 'candidate').exists())
        self.assertFalse(self.d.BACKUPS.exists())
        self.assertEqual(self.runner.writes, [])

    def test_python_valid_but_invalid_json_is_rejected_before_any_write(self):
        self.replace_config(b'{"prompt": True}\n')
        with self.assertRaises(json.JSONDecodeError):
            self.rollout()
        self.assertEqual(self.runner.writes, [])
        self.assertFalse(self.d.BACKUPS.exists())

    def test_config_requires_an_object(self):
        self.replace_config(b'[true, null]\n')
        with self.assertRaisesRegex(RuntimeError, 'config.*object'):
            self.rollout()
        self.assertEqual(self.runner.writes, [])

    def test_config_candidate_guard_parses_staged_json(self):
        self.replace_config(b'{"prompt": True}\n')
        for name, data in self.after.items():
            target = self.d.STAGE / 'candidate' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        with self.assertRaises(json.JSONDecodeError):
            self.d.candidate_guard(self.manifest)
        self.assertEqual(self.runner.writes, [])

    def test_config_only_mirror_drift_blocks_entire_rollout(self):
        (self.d.MIRROR / self.files[-1]).write_bytes(b'{"drift": true}\n')
        with self.assertRaisesRegex(RuntimeError, 'mirror'):
            self.rollout()
        self.assertEqual(self.runner.writes, [])

    def test_config_cas_preserves_concurrent_writer_and_restores_three_python_files(self):
        other = b'{"concurrent": true}\n'
        def drift(source, target):
            if len(self.runner.writes) == 3:
                (self.d.ROOT / self.files[-1]).write_bytes(other)
        self.runner.on_copy = drift
        with self.assertRaisesRegex(RuntimeError, 'Concurrent source drift'):
            self.rollout()
        expected = {**self.before, self.files[-1]: other}
        self.assertEqual(self.contents(self.d.ROOT), expected)
        self.assertEqual(self.contents(self.d.MIRROR), self.before)

    def test_baseexception_after_config_replace_restores_all_four_files(self):
        def interrupt(source, target):
            if len(self.runner.writes) == 4:
                raise KeyboardInterrupt('synthetic interruption after config replace')
        self.runner.on_copy = interrupt
        with self.assertRaises(KeyboardInterrupt):
            self.rollout()
        self.assertEqual(self.contents(self.d.ROOT), self.before)
        self.assertEqual(self.contents(self.d.MIRROR), self.before)
        self.assertEqual(self.runner.restarts, 1)
        receipt = json.loads(next(self.d.BACKUPS.glob('*/receipt.json')).read_text())
        self.assertEqual(receipt['status'], 'rolled_back')

    def test_health_failure_restores_config_and_python(self):
        self.runner.fail_health_once = True
        with self.assertRaisesRegex(RuntimeError, 'health failure'):
            self.rollout()
        self.assertEqual(self.contents(self.d.ROOT), self.before)
        self.assertEqual(self.runner.restarts, 2)

    @unittest.skipIf(os.name == 'nt', 'Requires Unix permissions')
    def test_backup_directory_is_private_and_file_modes_are_retained(self):
        for name in self.files:
            (self.d.ROOT / name).chmod(0o640)
        result = self.rollout()
        backup = Path(result['backup'])
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        for index, name in enumerate(self.files):
            self.assertEqual((backup / (str(index) + '-' + Path(name).name)).stat().st_mode & 0o777, 0o640)
            self.assertEqual((self.d.ROOT / name).stat().st_mode & 0o777, 0o640)


@unittest.skipIf(os.name == 'nt', 'Requires Linux flock and Unix ownership')
class LockTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('deploy.py')
        spec = importlib.util.spec_from_file_location('lock_test_deploy', path)
        self.d = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.d)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.d.LOCK = Path(self.temp.name) / 'shared.lock'
        # Isolate account lookup only; exercise real descriptors and flock.
        lookup = patch('pwd.getpwnam', return_value=types.SimpleNamespace(pw_uid=os.getuid()))
        lookup.start()
        self.addCleanup(lookup.stop)

    def test_check_never_creates_missing_shared_lock(self):
        with self.assertRaisesRegex(RuntimeError, 'read-only check cannot create'):
            with self.d.deployment_lock(check_only=True):
                self.fail('Missing lock accepted')
        self.assertFalse(self.d.LOCK.exists())

    def test_shared_lock_blocks_other_open_descriptors(self):
        import fcntl
        self.d.LOCK.write_bytes(b'preserve contents\n')
        with self.d.deployment_lock(check_only=True):
            with self.d.LOCK.open('r') as contender:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(contender, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with self.d.deployment_lock(check_only=True):
            pass
        self.assertEqual(self.d.LOCK.read_bytes(), b'preserve contents\n')

    def test_hardlinked_shared_lock_is_rejected(self):
        self.d.LOCK.write_bytes(b'preserve contents\n')
        os.link(self.d.LOCK, self.d.LOCK.with_name('other.lock'))
        with self.assertRaisesRegex(RuntimeError, 'Unexpected deployment lock'):
            with self.d.deployment_lock():
                self.fail('Aliased lock accepted')


class GateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bash = os.environ.get('BASH_TEST_SHELL') or shutil.which('bash')
        if not cls.bash and Path('C:/Program Files/Git/bin/bash.exe').is_file():
            cls.bash = 'C:/Program Files/Git/bin/bash.exe'
        if not cls.bash:
            raise unittest.SkipTest('bash unavailable')
        cls.bash_env = {**os.environ, 'PATH': str(Path(cls.bash).parent) + os.pathsep + os.environ.get('PATH', '')}

    def gate(self, scenario):
        path = Path(__file__).with_name('deployment_gate.sh')
        self.assertTrue(path.is_file(), 'Existing ingress gate must be packaged')
        script = r'''
set +o posix
set -euo pipefail
source "$1"
id() { [[ "$*" == '-u caddy' ]]; echo 1001; }
iptables() {
  local operation="$1"; shift
  if [[ "$operation" == '-I' ]]; then
    [[ "$1 $2" == 'OUTPUT 1' ]]; shift 2
  else
    [[ "$operation $1" == '-D OUTPUT' ]]; shift
  fi
  [[ "$*" == "-o lo -d 127.0.0.1 -p tcp --dport 8765 --syn -m owner ! --uid-owner 0 -m comment --comment diary-progress-$$ -j REJECT --reject-with tcp-reset" ]] || return 9
  echo "firewall $operation"
}
systemd-run() {
  [[ "$*" == "--quiet --unit=energetica-diary-progress-release-$$ --on-active=120s /usr/sbin/iptables -D OUTPUT -o lo -d 127.0.0.1 -p tcp --dport 8765 --syn -m owner ! --uid-owner 0 -m comment --comment diary-progress-$$ -j REJECT --reject-with tcp-reset" ]] || return 9
  echo watchdog
}
systemctl() { echo timer-stop; }
ss() { return 0; }
sleep() { :; }
trap diary_release_ingress EXIT
'''
        return subprocess.run([self.bash, '-c', script + scenario, 'test', path.as_posix()],
                              env=self.bash_env, text=True, capture_output=True, timeout=10)

    def test_gate_releases_after_successful_drain(self):
        result = self.gate('diary_block_ingress\ndiary_drain_requests\necho rollout\n')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(),
                         ['firewall -I', 'watchdog', 'rollout', 'firewall -D'])

    def test_watchdog_schedule_failure_releases_ingress(self):
        result = self.gate('systemd-run() { return 1; }\ndiary_block_ingress\necho rollout\n')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout.splitlines(), ['firewall -I', 'firewall -D'])

    def test_drain_timeout_cancels_rollout_and_releases_ingress(self):
        result = self.gate('ss() { echo active; }\ndiary_block_ingress\ndiary_drain_requests\necho rollout\n')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('rollout', result.stdout.splitlines())
        self.assertEqual(result.stdout.splitlines()[-1], 'firewall -D')

    def test_drain_query_failure_cancels_rollout(self):
        result = self.gate('ss() { return 1; }\ndiary_block_ingress\ndiary_drain_requests\necho rollout\n')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('rollout', result.stdout.splitlines())
        self.assertEqual(result.stdout.splitlines()[-1], 'firewall -D')

    def test_root_proxy_is_refused_before_firewall_mutation(self):
        result = self.gate('id() { echo 0; }\ndiary_block_ingress\necho rollout\n')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')

    def test_shells_parse_without_executing_deployment(self):
        base = Path(__file__).parent
        result = subprocess.run([self.bash, '-n', str(base / 'deploy.sh')],
                                text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = subprocess.run([self.bash, '-n', str(base / 'deployment_gate.sh')],
                                text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def captured_shell(self, mutation):
        # Exercise the real shell entry point; isolate only paths, Python runner
        # and privileged external commands inside a disposable synthetic package.
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            gate = base / 'deployment_gate.sh'
            gate.write_bytes(Path(__file__).with_name('deployment_gate.sh').read_bytes())
            shell = Path(__file__).with_name('deploy.sh').read_text()
            shell = shell.replace('/home/opc/signed-global-discount-20261031/release',
                                  '$(cd -- "' + base.as_posix() + '" && pwd)')
            shell = shell.replace('/opt/energetica-whatsapp/.venv/bin/python', Path(sys.executable).as_posix())
            (base / 'deploy.sh').write_bytes(shell.encode('utf-8'))
            (base / 'deploy.py').write_text(
                'import os, pathlib, sys\n'
                'base = pathlib.Path(__file__).parent\n'
                'if sys.argv[1] == "--check" and os.environ["MUTATION"] == "check":\n'
                '    with (base / "deployment_gate.sh").open("a") as f:\n'
                '        f.write("\\necho UNREVIEWED_GATE_EXECUTED >&2\\nexit 93\\n")\n'
                'print(sys.argv[1])\n')
            program = r'''
set +o posix
set -euo pipefail
id() { if [[ "$*" == '-u' ]]; then echo 0; else echo 1001; fi; }
iptables() { echo "firewall $1"; }
systemd-run() { :; }
systemctl() { :; }
ss() { :; }
sha256sum() {
  # Real hashing, also available in the minimal Windows Git Bash runtime.
  "$SCENARIO_PYTHON" -c 'import hashlib, sys; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest() + "  -")'
  if [[ "$MUTATION" == 'hash' ]]; then
    printf '\necho UNREVIEWED_GATE_EXECUTED >&2\nexit 93\n' >> "$SCENARIO_GATE"
  fi
}
export -f id iptables systemd-run systemctl ss sha256sum
"$2" -c 'set +o posix; target="$1"; shift; source "$target"' test "$1" reviewed-manifest
'''
            result = subprocess.run([self.bash, '-c', program, 'test', str(base / 'deploy.sh'), self.bash],
                                    env={**self.bash_env, 'MUTATION': mutation, 'SCENARIO_GATE': gate.as_posix(),
                                         'SCENARIO_PYTHON': Path(sys.executable).as_posix()},
                                    text=True, capture_output=True, timeout=10)
            return result, gate.read_text()

    def test_gate_mutated_after_check_is_not_executed(self):
        result, gate = self.captured_shell('check')
        self.assertIn('UNREVIEWED_GATE_EXECUTED', gate)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('UNREVIEWED_GATE_EXECUTED', result.stderr)
        self.assertNotIn('--deploy', result.stdout)
        self.assertNotIn('firewall', result.stdout)

    def test_gate_mutated_after_capture_still_executes_only_verified_capture(self):
        result, gate = self.captured_shell('hash')
        self.assertIn('UNREVIEWED_GATE_EXECUTED', gate)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('UNREVIEWED_GATE_EXECUTED', result.stderr)
        self.assertIn('--deploy', result.stdout)
        self.assertIn('firewall -D', result.stdout)


if __name__ == '__main__':
    unittest.main()
