"""Deployment gates exercised in temporary roots, no service/network access."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import deploy
import package

class DeployTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.roots = {name:root/name for name in ('app','build')}
        self.stage = root/'candidate'
        self.manifest = {}
        for i,(name,path) in enumerate(self.roots.items()):
            (path/'worker').mkdir(parents=True)
            old = ('old = '+str(i)+'\n').encode()
            new = ('new = '+str(i)+'\n').encode()
            (path/'worker/workflow.py').write_bytes(old)
            candidate = self.stage/name/'worker/workflow.py'
            candidate.parent.mkdir(parents=True)
            candidate.write_bytes(new)
            self.manifest[name] = {'relative':'worker/workflow.py', 'before':hashlib.sha256(old).hexdigest(), 'after':hashlib.sha256(new).hexdigest()}
        for key,value in [('ROOTS',self.roots),('STAGE',self.stage),('BACKUPS',root/'backups')]:
            item = patch.object(deploy,key,value); item.start(); self.addCleanup(item.stop)
        self.restart = patch.object(deploy,'restart'); self.restart_mock = self.restart.start(); self.addCleanup(self.restart.stop)
        self.health = patch.object(deploy,'health',return_value={'status':'ok'}); self.health_mock = self.health.start(); self.addCleanup(self.health.stop)
        self.wait = patch.object(deploy,'wait_health',return_value={'status':'ok'}); self.wait_mock = self.wait.start(); self.addCleanup(self.wait.stop)

    def assert_before(self):
        for name,path in self.roots.items():
            self.assertEqual(deploy.digest(path/'worker/workflow.py'),self.manifest[name]['before'])

    def test_check_is_read_only(self):
        self.assertEqual(deploy.execute(self.manifest,True)['status'],'checked')
        self.assert_before(); self.restart_mock.assert_not_called()
        self.assertFalse(deploy.BACKUPS.exists())

    def test_independent_candidates_preserve_divergence(self):
        self.assertEqual(deploy.execute(self.manifest)['status'],'deployed')
        for name,path in self.roots.items():
            self.assertEqual(deploy.digest(path/'worker/workflow.py'),self.manifest[name]['after'])
        self.restart_mock.assert_called_once()

    def test_drift_blocks_before_any_write(self):
        (self.roots['build']/'worker/workflow.py').write_text('drift=1\n')
        with self.assertRaisesRegex(RuntimeError,'Live source drift'): deploy.execute(self.manifest)
        self.assertEqual(deploy.digest(self.roots['app']/'worker/workflow.py'),self.manifest['app']['before'])
        self.restart_mock.assert_not_called()

    def test_tampered_candidate_blocks(self):
        (self.stage/'app/worker/workflow.py').write_text('tampered=1\n')
        with self.assertRaisesRegex(RuntimeError,'Candidate hash mismatch'): deploy.execute(self.manifest)
        self.assert_before()

    def test_restart_failure_rolls_back_both(self):
        self.restart_mock.side_effect = [RuntimeError('restart failed'),None]
        with self.assertRaisesRegex(RuntimeError,'restart failed'): deploy.execute(self.manifest)
        self.assert_before()
        self.assertEqual(self.restart_mock.call_count,2)

    def test_failed_health_rolls_back_both(self):
        self.wait_mock.side_effect = [RuntimeError('unhealthy'),{'status':'ok'}]
        with self.assertRaisesRegex(RuntimeError,'unhealthy'): deploy.execute(self.manifest)
        self.assert_before()
        receipt = json.loads(next(deploy.BACKUPS.glob('*/receipt.json')).read_text())
        self.assertEqual(receipt['status'],'rolled_back')

    def test_concurrent_change_is_preserved_during_rollback(self):
        def drift():
            (self.roots['app']/'worker/workflow.py').write_text('concurrent=1\n')
            raise RuntimeError('restart failed')
        self.restart_mock.side_effect = [drift, None]
        # side_effect list returns callables; use an explicit callback instead.
        count = []
        def restart():
            count.append(True)
            if len(count)==1: return drift()
        self.restart_mock.side_effect = restart
        with self.assertRaisesRegex(RuntimeError,'restart failed'): deploy.execute(self.manifest)
        self.assertEqual((self.roots['app']/'worker/workflow.py').read_text(),'concurrent=1\n')
        receipt = json.loads(next(deploy.BACKUPS.glob('*/receipt.json')).read_text())
        self.assertEqual(receipt['status'],'rollback_incomplete')
        self.assertEqual(deploy.digest(self.roots['build']/'worker/workflow.py'),self.manifest['build']['before'])

    def test_manifest_cannot_escape_fixed_file(self):
        manifest = copy.deepcopy(self.manifest); manifest['app']['relative']='../outside.py'
        with self.assertRaisesRegex(RuntimeError,'Unexpected file'): deploy.execute(manifest)
        self.assert_before()

    def test_patch_anchor_drift_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError,'Unexpected patch anchor'):
            package.transform(b'x=1\n')

if __name__ == '__main__':
    unittest.main()
