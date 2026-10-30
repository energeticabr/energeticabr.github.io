"""Synthetic deployment/packaging tests; no services, credentials or tenant calls."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


def sha(data):
    return hashlib.sha256(data).hexdigest()


def module(name):
    path = Path(__file__).with_name(name + '.py')
    if not path.exists():
        raise AssertionError('Missing source-specific ' + name)
    value = types.ModuleType('partial_' + name)
    value.__file__ = str(path)
    exec(compile(path.read_bytes(), str(path), 'exec'), value.__dict__)
    return value


class Backend:
    LOCK_EX, LOCK_NB = 2, 4

    def __init__(self):
        self.calls = 0

    def flock(self, fd, flags):
        self.calls += 1


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.d = module('deploy')
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name).resolve()
        self.d.ROOTS = (self.base / 'live', self.base / 'mirror')
        self.d.STAGE = self.base / 'release'
        self.d.BACKUPS = self.base / 'backups'
        self.d.LOCK = self.base / 'deploy.lock'
        self.d.LOCK.write_bytes(b'')
        self.d.LOCK_BACKEND = Backend()
        self.before, self.after = {}, {}
        for i, relative in enumerate(self.d.FILES):
            self.before[relative] = f'old = {i}\n'.encode()
            self.after[relative] = f'new = {i}\n'.encode()
        self.d.BEFORE = {n: sha(v) for n, v in self.before.items()}
        self.config = b'{"synthetic":true}\n'
        self.d.CONFIG_SHA = sha(self.config)
        for root in self.d.ROOTS:
            for relative, data in {**self.before, self.d.CONFIG: self.config}.items():
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
        self.d.STAGE.mkdir()
        for relative, data in self.after.items():
            p = self.d.STAGE / 'candidate' / relative
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        for name in self.d.INPUTS:
            (self.d.STAGE / name).write_bytes(('synthetic ' + name).encode())
        self.manifest = {'version': 1,
                         'files': {n: {'before': self.d.BEFORE[n], 'after': sha(v)} for n, v in self.after.items()},
                         'guards': {self.d.CONFIG: self.d.CONFIG_SHA},
                         'inputs': {n: sha((self.d.STAGE / n).read_bytes()) for n in self.d.INPUTS}}
        outer = self

        class Runner:
            def __init__(self):
                self.writes, self.attrs = [], []
                self.restarts = 0
                self.active = False
                self.fail_health = False
                self.on_copy = lambda p: None

            def health(self):
                return {'status': 'ok'}

            @contextmanager
            def ingress(self):
                self.active = True
                try:
                    yield
                finally:
                    self.active = False

            def atomic_copy(self, data, target, attributes):
                outer.assertTrue(self.active, 'writes must remain inside ingress gate')
                self.writes.append(target)
                self.attrs.append((target, attributes.st_uid, attributes.st_gid, attributes.st_mode))
                target.write_bytes(data)
                self.on_copy(target)

            def restart(self):
                self.restarts += 1

            def wait_health(self):
                if self.fail_health and self.restarts == 1:
                    raise RuntimeError('synthetic health failure')
                return {'status': 'ok'}

        self.runner = Runner()

    def execute(self, check=False):
        return self.d.rollout(self.manifest, self.runner, check_only=check)

    def contents(self):
        return {(str(root), n): (root / n).read_bytes() for root in self.d.ROOTS for n in self.d.FILES}

    def untouched(self):
        self.assertEqual(self.contents(), {(str(r), n): v for r in self.d.ROOTS for n, v in self.before.items()})
        self.assertEqual(self.runner.writes, [])
        self.assertEqual(self.runner.restarts, 0)

    def test_check_only_is_read_only_and_reentrant(self):
        snapshot = {str(p): (p.read_bytes(), p.stat().st_mtime_ns) for p in self.base.rglob('*') if p.is_file()}
        with self.d.deployment_lock(check_only=True):
            result = self.execute(True)
        self.assertEqual(result['status'], 'checked')
        self.assertEqual(self.d.LOCK_BACKEND.calls, 1)
        self.assertEqual(snapshot, {str(p): (p.read_bytes(), p.stat().st_mtime_ns) for p in self.base.rglob('*') if p.is_file()})
        self.untouched()

    def test_exact_six_targets_per_target_attrs_and_config_preserved(self):
        attrs = {(root / n): (root / n).stat() for root in self.d.ROOTS for n in self.d.FILES}
        result = self.execute()
        self.assertEqual(result['status'], 'deployed')
        self.assertEqual(set(self.runner.writes), set(attrs))
        self.assertEqual(self.contents(), {(str(r), n): v for r in self.d.ROOTS for n, v in self.after.items()})
        self.assertEqual(self.runner.restarts, 1)
        self.assertFalse(self.runner.active)
        for target, uid, gid, mode in self.runner.attrs:
            self.assertEqual((uid, gid, mode), (attrs[target].st_uid, attrs[target].st_gid, attrs[target].st_mode))
        for r in self.d.ROOTS:
            self.assertEqual((r / self.d.CONFIG).read_bytes(), self.config)
        self.assertEqual(len(list(Path(result['backup']).glob('*.py'))), 6)

    def test_any_live_or_mirror_source_or_config_drift_blocks_first_write(self):
        for root in self.d.ROOTS:
            for relative in (*self.d.FILES, self.d.CONFIG):
                p = root / relative
                saved = p.read_bytes()
                p.write_bytes(b'concurrent = True\n')
                with self.assertRaisesRegex(RuntimeError, 'drift'):
                    self.execute()
                p.write_bytes(saved)
                self.untouched()

    def test_candidate_drift_or_invalid_python_blocks_first_write(self):
        p = self.d.STAGE / 'candidate' / self.d.FILES[-1]
        p.write_bytes(b'drift = True\n')
        with self.assertRaisesRegex(RuntimeError, 'drift'):
            self.execute()
        self.untouched()
        p.write_bytes(b'def broken(\n')
        self.manifest['files'][self.d.FILES[-1]]['after'] = sha(p.read_bytes())
        with self.assertRaises(SyntaxError):
            self.execute()
        self.untouched()

    def test_scope_injection_or_config_pin_override_is_rejected(self):
        self.manifest['files']['worker/other.py'] = dict(next(iter(self.manifest['files'].values())))
        with self.assertRaisesRegex(RuntimeError, 'scope'):
            self.execute()
        del self.manifest['files']['worker/other.py']
        self.manifest['guards'][self.d.CONFIG] = '0' * 64
        with self.assertRaisesRegex(RuntimeError, 'guard'):
            self.execute()
        self.untouched()

    def test_health_failure_rolls_back_both_roots_and_releases_ingress(self):
        self.runner.fail_health = True
        with self.assertRaisesRegex(RuntimeError, 'health failure'):
            self.execute()
        self.assertEqual(self.contents(), {(str(r), n): v for r in self.d.ROOTS for n, v in self.before.items()})
        self.assertEqual(self.runner.restarts, 2)
        self.assertFalse(self.runner.active)
        receipt = json.loads(next(self.d.BACKUPS.glob('*/receipt.json')).read_bytes())
        self.assertEqual(receipt['status'], 'rolled_back')

    def test_write_then_raise_is_tracked_and_rolled_back(self):
        first = self.d.ROOTS[0] / self.d.FILES[0]
        def fail_once(p):
            if p == first and p.read_bytes() == self.after[self.d.FILES[0]]:
                raise RuntimeError('write completed then failed')
        self.runner.on_copy = fail_once
        with self.assertRaisesRegex(RuntimeError, 'write completed'):
            self.execute()
        self.assertEqual(self.contents(), {(str(r), n): v for r in self.d.ROOTS for n, v in self.before.items()})
        self.assertFalse(self.runner.active)

    def test_unknown_concurrent_writer_is_never_clobbered_in_rollback(self):
        first = self.d.ROOTS[0] / self.d.FILES[0]
        def concurrent(p):
            if p == first:
                p.write_bytes(b'unknown_writer = True\n')
                raise RuntimeError('concurrent writer')
        self.runner.on_copy = concurrent
        with self.assertRaises(RuntimeError):
            self.execute()
        self.assertEqual(first.read_bytes(), b'unknown_writer = True\n')
        receipt = json.loads(next(self.d.BACKUPS.glob('*/receipt.json')).read_bytes())
        self.assertEqual(receipt['status'], 'rollback_incomplete')
        self.assertFalse(self.runner.active)

    def test_candidate_changed_after_first_write_rolls_back(self):
        first = self.d.ROOTS[0] / self.d.FILES[0]
        def mutate(p):
            if p == first:
                (self.d.STAGE / 'candidate' / self.d.FILES[-1]).write_bytes(b'changed = True\n')
        self.runner.on_copy = mutate
        with self.assertRaisesRegex(RuntimeError, 'drift'):
            self.execute()
        self.assertEqual(self.contents(), {(str(r), n): v for r in self.d.ROOTS for n, v in self.before.items()})

    def test_read_only_lock_cannot_escalate_and_missing_lock_is_not_created(self):
        with self.d.deployment_lock(check_only=True):
            with self.assertRaisesRegex(RuntimeError, 'escalat'):
                with self.d.deployment_lock(check_only=False):
                    pass
        self.d.LOCK.unlink()
        with self.assertRaises(RuntimeError):
            with self.d.deployment_lock(check_only=True):
                pass
        self.assertFalse(self.d.LOCK.exists())

    def test_pinned_manifest_and_package_input_drift(self):
        p = self.d.STAGE / 'deploy-manifest.json'
        p.write_bytes(json.dumps(self.manifest).encode())
        self.assertEqual(self.d.checked_manifest(sha(p.read_bytes())), self.manifest)
        (self.d.STAGE / next(iter(self.d.INPUTS))).write_bytes(b'tampered')
        with self.assertRaisesRegex(RuntimeError, 'drift'):
            self.d.checked_manifest(sha(p.read_bytes()))

    def test_ingress_cleanup_failure_is_not_reported_as_clean_deploy(self):
        @contextmanager
        def failing_cleanup():
            self.runner.active = True
            try:
                yield
            finally:
                self.runner.active = False
                raise RuntimeError('synthetic gate cleanup failure')
        self.runner.ingress = failing_cleanup
        with self.assertRaisesRegex(RuntimeError, 'gate cleanup'):
            self.execute()
        receipt = json.loads(next(self.d.BACKUPS.glob('*/receipt.json')).read_bytes())
        self.assertEqual(receipt['status'], 'deployed_ingress_cleanup_failed')

    def test_concurrent_config_change_is_preserved_while_code_rolls_back(self):
        p = self.d.ROOTS[1] / self.d.CONFIG
        self.runner.on_copy = lambda _: p.write_bytes(b'{"concurrent":true}')
        with self.assertRaisesRegex(RuntimeError, 'drift'):
            self.execute()
        self.assertEqual(p.read_bytes(), b'{"concurrent":true}')
        self.assertEqual(self.contents(), {(str(r), n): v for r in self.d.ROOTS for n, v in self.before.items()})

    def test_real_gate_watchdog_failure_still_releases_rule(self):
        commands = []
        runner = self.d.Runner()
        def command(args):
            commands.append(args)
            if args[0] == 'systemd-run':
                raise RuntimeError('synthetic watchdog failure')
            return types.SimpleNamespace(stdout='')
        runner.command = command
        with patch.dict(sys.modules, {'pwd': types.SimpleNamespace(getpwnam=lambda _: types.SimpleNamespace(pw_uid=123))}):
            with self.assertRaisesRegex(RuntimeError, 'watchdog'):
                with runner.ingress():
                    self.fail('failed watchdog must not allow file writes')
        self.assertTrue(any(args[:3] == ['iptables', '-D', 'OUTPUT'] for args in commands))

    def test_real_gate_drain_timeout_releases_rule(self):
        commands = []
        runner = self.d.Runner()
        def command(args):
            commands.append(args)
            return types.SimpleNamespace(stdout='busy' if args[0] == 'ss' else '')
        runner.command = command
        with patch.dict(sys.modules, {'pwd': types.SimpleNamespace(getpwnam=lambda _: types.SimpleNamespace(pw_uid=123))}), patch.object(self.d.time, 'monotonic', side_effect=[0, 31]):
            with self.assertRaisesRegex(RuntimeError, 'did not drain'):
                with runner.ingress():
                    self.fail('busy ingress must not allow file writes')
        self.assertTrue(any(args[:3] == ['iptables', '-D', 'OUTPUT'] for args in commands))

    def test_hardlink_source_is_rejected(self):
        target = self.d.ROOTS[1] / self.d.FILES[-1]
        alias = self.base / 'hardlink.py'
        os.link(target, alias)
        with self.assertRaisesRegex(RuntimeError, 'alias'):
            self.execute()
        self.untouched()


class PackageTests(unittest.TestCase):
    def test_public_workspace_is_rejected_without_writing_sources(self):
        p = module('package')
        with self.assertRaisesRegex(RuntimeError, 'outside'):
            p.freeze(p.REPOSITORY / 'unsafe-private-source')

    def test_freeze_is_explicit_and_generates_only_exact_private_payload(self):
        p = module('package')
        d = module('deploy')
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp).resolve()
            public, workspace = base / 'repository' / 'patch', base / 'private'
            public.mkdir(parents=True)
            workspace.mkdir()
            for name in d.INPUTS - {'source.patch'}:
                (public / name).write_bytes(('synthetic ' + name).encode())
            before = {}
            for i, relative in enumerate(d.FILES):
                old = f'old = {i}\n'.encode()
                before[relative] = sha(old)
                for folder, data in [('baseline', old), ('candidate', f'new = {i}\n'.encode())]:
                    f = workspace / folder / relative
                    f.parent.mkdir(parents=True, exist_ok=True)
                    f.write_bytes(data)
            config = workspace / 'baseline' / d.CONFIG
            config.write_bytes(b'{}')
            with patch.object(p, 'PUBLIC', public), patch.object(p, 'REPOSITORY', base / 'repository'):
                manifest = p.freeze(workspace, deployment=d, before=before, config_sha=sha(b'{}'))
            self.assertEqual(set(manifest['files']), set(d.FILES))
            self.assertEqual(set(manifest['guards']), {d.CONFIG})
            self.assertFalse((workspace / 'release' / 'candidate' / d.CONFIG).exists())
            for relative in d.FILES:
                self.assertEqual((workspace / 'release' / 'candidate' / relative).read_bytes(), (workspace / 'candidate' / relative).read_bytes())
            self.assertTrue((public / 'source.patch').is_file())
            self.assertTrue((public / 'deploy-manifest.json').is_file())


if __name__ == '__main__':
    unittest.main()
