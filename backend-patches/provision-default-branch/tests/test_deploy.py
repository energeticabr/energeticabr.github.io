import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

PACKAGE = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, PACKAGE/(name+'.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.deploy, self.change = load('deploy'), load('patch_backend').change
        self.package = root/'package'
        self.package.mkdir()
        roots = (root/'production', root/'mirror')
        self.sources = {}
        for index, folder in enumerate(roots):
            path = folder/self.deploy.RELATIVE
            path.parent.mkdir(parents=True)
            data = json.dumps({'baseline': index, 'sharepoint': {'payment_flow': {'steps': [
                {'key': 'filial_pagamento', 'source': {'sort_field': 'Title'}},
                {'key': 'imovel_pagamento'}]}}}, indent=2).encode()
            # Use the exact indentation of the installed config.
            data = data.replace(b'          "sort_field": "Title"', b'            "sort_field": "Title"')
            path.write_bytes(data)
            self.sources[path] = data
        for name in self.deploy.INPUTS:
            shutil.copyfile(PACKAGE/name, self.package/name)
        manifest = {'inputs': {name: self.deploy.digest((self.package/name).read_bytes()) for name in self.deploy.INPUTS},
            'files': {str(path): {'before': self.deploy.digest(data), 'after': self.deploy.digest(self.change(data))} for path, data in self.sources.items()}}
        raw = json.dumps(manifest).encode()
        (self.package/'deploy-manifest.json').write_bytes(raw)
        self.pin = self.deploy.digest(raw)
        for name, value in [('PACKAGE', self.package), ('ROOTS', roots), ('BACKUPS', root/'backups')]:
            mocked = patch.object(self.deploy, name, value)
            mocked.start()
            self.addCleanup(mocked.stop)
        for name in ['health', 'restart']:
            mocked = patch.object(self.deploy, name, return_value='ok')
            mocked.start()
            self.addCleanup(mocked.stop)

    def test_check_does_not_write_and_preserves_independent_configs(self):
        plan = self.deploy.prepare(self.pin)
        self.assertEqual(len(plan), 2)
        self.assertNotEqual(plan[0][2], plan[1][2])
        for path, before, after in plan:
            self.assertEqual(path.read_bytes(), before)
            self.assertIn('recommended', json.loads(after)['sharepoint']['payment_flow']['steps'][0]['source'])

    def test_source_drift_is_rejected(self):
        path = next(iter(self.sources))
        path.write_bytes(b'{}')
        with self.assertRaisesRegex(RuntimeError, 'Source drift'):
            self.deploy.prepare(self.pin)
        self.assertEqual(path.read_bytes(), b'{}')

    def test_manifest_and_input_drift_are_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'Manifest hash'):
            self.deploy.prepare('0'*64)
        (self.package/'patch_backend.py').write_bytes(b'')
        with self.assertRaisesRegex(RuntimeError, 'input mismatch'):
            self.deploy.prepare(self.pin)

    def test_success_backs_up_both_configs(self):
        plan = self.deploy.prepare(self.pin)
        receipt = self.deploy.rollout(plan)
        self.assertEqual(receipt['status'], 'deployed')
        for index, (path, before, after) in enumerate(plan):
            self.assertEqual(path.read_bytes(), after)
            self.assertEqual((Path(receipt['backup'])/str(index)).read_bytes(), before)

    def test_failed_restart_rolls_back_both_configs(self):
        plan = self.deploy.prepare(self.pin)
        with patch.object(self.deploy, 'restart', side_effect=[RuntimeError('restart failed'), 'ok']):
            with self.assertRaisesRegex(RuntimeError, 'restart failed'):
                self.deploy.rollout(plan)
        for path, data in self.sources.items():
            self.assertEqual(path.read_bytes(), data)


if __name__ == '__main__':
    unittest.main()
