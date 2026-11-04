"""Installer contracts use temporary files and fake service boundaries."""
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.deploy = load('price_deploy', ROOT/'deploy.py')
        self.roots = (self.root/'production', self.root/'mirror')
        self.package = self.root/'package'
        self.package.mkdir()
        self.sources = {}
        for name in self.deploy.INPUTS:
            shutil.copyfile(ROOT/name, self.package/name)
        # Synthetic transform is the installer's input boundary. Exercise the
        # real patch separately against both fresh private source snapshots.
        (self.package/'patch_backend.py').write_text(
            "def change(relative, data):\n    return data.replace(b'VERSION = 1', b'VERSION = 2')\n")
        for index, root in enumerate(self.roots):
            for relative in self.deploy.RELATIVES:
                target = root/relative
                target.parent.mkdir(parents=True,exist_ok=True)
                data = f'BASELINE = {len(self.sources)}\nVERSION = 1\n'.encode()
                target.write_bytes(data)
                self.sources[target] = data
        manifest = {'inputs': {name: self.deploy.digest((self.package/name).read_bytes())
                              for name in self.deploy.INPUTS},
            'files': {str(path): {'before': self.deploy.digest(data),
                                  'after': self.deploy.digest(data.replace(b'VERSION = 1', b'VERSION = 2'))}
                      for path, data in self.sources.items()}}
        raw = json.dumps(manifest).encode()
        (self.package/'deploy-manifest.json').write_bytes(raw)
        self.pin = self.deploy.digest(raw)
        for name, value in [('PACKAGE', self.package), ('ROOTS', self.roots),
                            ('BACKUPS', self.root/'backups')]:
            mocked = patch.object(self.deploy, name, value)
            mocked.start()
            self.addCleanup(mocked.stop)
        for name in ('health', 'restart'):
            mocked = patch.object(self.deploy, name, return_value='ok')
            mocked.start()
            self.addCleanup(mocked.stop)

    def test_prepare_validates_both_roots_without_writing(self):
        plan = self.deploy.prepare(self.pin)
        self.assertEqual(len(plan), 4)
        for path, data in self.sources.items():
            self.assertEqual(path.read_bytes(), data)
        self.assertNotEqual(plan[0][2], plan[1][2])

    def test_modified_manifest_and_inputs_are_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'Manifest hash'):
            self.deploy.prepare('0'*64)
        (self.package/'patch_backend.py').write_bytes(b'corrupted')
        with self.assertRaisesRegex(RuntimeError, 'input mismatch'):
            self.deploy.prepare(self.pin)

    def test_source_drift_is_rejected_before_writes(self):
        path = next(iter(self.sources))
        path.write_bytes(b'NEW_SOURCE = True\n')
        with self.assertRaisesRegex(RuntimeError, 'Source drift'):
            self.deploy.prepare(self.pin)
        self.assertEqual(path.read_bytes(), b'NEW_SOURCE = True\n')

    def test_success_preserves_independent_roots_and_backs_up_originals(self):
        plan = self.deploy.prepare(self.pin)
        result = self.deploy.rollout(plan)
        self.assertEqual(result['status'], 'deployed')
        for index, (path, before, after) in enumerate(plan):
            self.assertEqual(path.read_bytes(), after)
            self.assertEqual((Path(result['backup'])/str(index)).read_bytes(), before)
            self.assertIn(f'BASELINE = {index}'.encode(), after)

    def test_restart_failure_restores_both_original_sources(self):
        plan = self.deploy.prepare(self.pin)
        with patch.object(self.deploy, 'restart', side_effect=[RuntimeError('restart failed'), 'ok']):
            with self.assertRaisesRegex(RuntimeError, 'restart failed'):
                self.deploy.rollout(plan)
        for path, before in self.sources.items():
            self.assertEqual(path.read_bytes(), before)

    def test_concurrent_drift_is_preserved(self):
        plan = self.deploy.prepare(self.pin)
        target = plan[0][0]
        target.write_bytes(b'CONCURRENT = True\n')
        with self.assertRaisesRegex(RuntimeError, 'Concurrent source drift'):
            self.deploy.rollout(plan)
        self.assertEqual(target.read_bytes(), b'CONCURRENT = True\n')

    def test_health_rejects_inactive_worker_even_when_bridge_is_active(self):
        deploy = load('price_deploy_health', ROOT/'deploy.py')
        def run(command, check):
            if command[-1] == 'energetica-whatsapp':
                raise deploy.subprocess.CalledProcessError(3, command)
        with patch.object(deploy.subprocess, 'run', side_effect=run):
            with self.assertRaises(deploy.subprocess.CalledProcessError):
                deploy.health()

    def test_real_patcher_preserves_uniform_lf_and_crlf(self):
        patcher=load('table_patch_endings',ROOT/'patch_backend.py')
        with patch.object(patcher,'CHANGES',{'channel_bridge.py':[('value = 1\n','value = 2\n')]}):
            self.assertEqual(patcher.change('channel_bridge.py',b'value = 1\r\nkeep = 3\r\n'),b'value = 2\r\nkeep = 3\r\n')
            self.assertEqual(patcher.change('channel_bridge.py',b'value = 1\nkeep = 3\n'),b'value = 2\nkeep = 3\n')

    def test_real_patcher_rejects_mixed_endings_and_duplicate_anchors(self):
        patcher=load('table_patch_reject',ROOT/'patch_backend.py')
        with patch.object(patcher,'CHANGES',{'channel_bridge.py':[('value = 1\n','value = 2\n')]}):
            with self.assertRaisesRegex(RuntimeError,'Mixed'):
                patcher.change('channel_bridge.py',b'value = 1\r\nkeep = 3\n')
            with self.assertRaisesRegex(RuntimeError,'exactly once'):
                patcher.change('channel_bridge.py',b'value = 1\nvalue = 1\n')

    def test_mid_install_drift_rolls_back_first_file_and_preserves_concurrent_change(self):
        plan=self.deploy.prepare(self.pin)
        original=self.deploy.atomic
        second=plan[1][0]
        changed=b'CONCURRENT = True\n'
        def install(path,data,attributes):
            original(path,data,attributes)
            if path==plan[0][0] and data==plan[0][2]:
                second.write_bytes(changed)
        with patch.object(self.deploy,'atomic',side_effect=install):
            with self.assertRaisesRegex(RuntimeError,'Concurrent source drift'):
                self.deploy.rollout(plan)
        self.assertEqual(plan[0][0].read_bytes(),plan[0][1])
        self.assertEqual(second.read_bytes(),changed)
        for path,before,after in plan[2:]:
            self.assertEqual(path.read_bytes(),before)


if __name__ == '__main__':
    unittest.main()
