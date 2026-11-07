import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

PACKAGE = Path(__file__).resolve().parents[1]


def load(name):
    spec=importlib.util.spec_from_file_location(name,PACKAGE/(name+'.py'))
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name)
        self.deploy,self.patch=load('deploy'),load('patch_backend')
        self.package=root/'package'
        self.package.mkdir()
        roots=(root/'production',root/'mirror')
        self.sources={}
        for index,folder in enumerate(roots):
            for relative in self.deploy.RELATIVES:
                path=folder/relative
                path.parent.mkdir(parents=True,exist_ok=True)
                anchors=''.join(before for before,after in self.patch.CHANGES[relative])
                data=(f'BASELINE = {index}\nSOURCE = '+"'''\n"+anchors+"'''\n").encode()
                if index==1:
                    data=data.replace(b'\n',b'\r\n')
                path.write_bytes(data)
                self.sources[path]=data
        for name in self.deploy.INPUTS:
            shutil.copyfile(PACKAGE/name,self.package/name)
        manifest={'inputs':{name:self.deploy.digest((self.package/name).read_bytes()) for name in self.deploy.INPUTS},
            'files':{str(path):{'before':self.deploy.digest(data),'after':self.deploy.digest(self.patch.patch(str(path.relative_to(path.parents[1])) if path.parent.name=='worker' else path.name,data))} for path,data in self.sources.items()}}
        raw=json.dumps(manifest).encode()
        (self.package/'deploy-manifest.json').write_bytes(raw)
        self.pin=self.deploy.digest(raw)
        for name,value in [('PACKAGE',self.package),('ROOTS',roots),('BACKUPS',root/'backups')]:
            mocked=patch.object(self.deploy,name,value);mocked.start();self.addCleanup(mocked.stop)
        for name in ['health','restart']:
            mocked=patch.object(self.deploy,name,return_value='ok');mocked.start();self.addCleanup(mocked.stop)

    def test_check_preserves_independent_sources_and_line_endings(self):
        plan=self.deploy.prepare(self.pin)
        self.assertEqual(len(plan),6)
        for path,before,after in plan:
            self.assertEqual(path.read_bytes(),before)
            self.assertNotEqual(before,after)
            self.assertEqual(b'\r\n' in before,b'\r\n' in after)

    def test_source_drift_prevents_any_write(self):
        path=next(iter(self.sources));path.write_bytes(b'CONCURRENT = True\n')
        with self.assertRaisesRegex(RuntimeError,'Source drift'):
            self.deploy.prepare(self.pin)
        self.assertEqual(path.read_bytes(),b'CONCURRENT = True\n')

    def test_manifest_and_package_drift_are_rejected(self):
        with self.assertRaisesRegex(RuntimeError,'Manifest hash'):
            self.deploy.prepare('0'*64)
        (self.package/'patch_backend.py').write_bytes(b'')
        with self.assertRaisesRegex(RuntimeError,'input mismatch'):
            self.deploy.prepare(self.pin)

    def test_success_backs_up_and_verifies_all_six_sources(self):
        plan=self.deploy.prepare(self.pin)
        result=self.deploy.rollout(plan)
        self.assertEqual(result['status'],'deployed')
        for index,(path,before,after) in enumerate(plan):
            self.assertEqual(path.read_bytes(),after)
            self.assertEqual((Path(result['backup'])/str(index)).read_bytes(),before)

    def test_restart_failure_rolls_back_all_six_sources(self):
        plan=self.deploy.prepare(self.pin)
        with patch.object(self.deploy,'restart',side_effect=[RuntimeError('restart failed'),'ok']):
            with self.assertRaisesRegex(RuntimeError,'restart failed'):
                self.deploy.rollout(plan)
        for path,data in self.sources.items():
            self.assertEqual(path.read_bytes(),data)

    def test_symlink_target_is_rejected(self):
        path=next(iter(self.sources));original=path.with_suffix('.original')
        path.rename(original);path.symlink_to(original)
        with self.assertRaisesRegex(RuntimeError,'target alias'):
            self.deploy.prepare(self.pin)

    def test_post_install_drift_preserves_conflict_and_restores_all_other_files(self):
        plan=self.deploy.prepare(self.pin)
        conflict=plan[1][0]
        concurrent=b'CONCURRENT = True\n'
        attempts=[]
        def restart():
            attempts.append(True)
            if len(attempts)==1:
                conflict.write_bytes(concurrent)
                raise RuntimeError('restart failed')
            return 'ok'
        with patch.object(self.deploy,'restart',side_effect=restart):
            with self.assertRaisesRegex(RuntimeError,'Concurrent source change'):
                self.deploy.rollout(plan)
        self.assertEqual(len(attempts),2,'Services must restart after restoring other files')
        for path,before,after in plan:
            self.assertEqual(path.read_bytes(),concurrent if path==conflict else before)


if __name__=='__main__':
    unittest.main()
