import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


@unittest.skipIf(os.name=='nt','OCI deployment uses Linux flock')
class GeneratedDeployTests(unittest.TestCase):
    def test_failure_after_replace_restores_bytes_and_worker(self):
        import deploy_generated_receipts as d
        with tempfile.TemporaryDirectory() as directory:
            first=Path(directory)/'first.py';second=Path(directory)/'second.py'
            first.write_bytes(b'old-first');second.write_bytes(b'old-second')
            originals={p:(p.read_bytes(),p.stat()) for p in (first,second)}
            commands=[]
            def run(*args):
                commands.append(args)
                if args[0]=='restorecon':raise RuntimeError('relabel failure after replace')
                return ''
            with patch.object(d,'run',run),patch.object(d.subprocess,'run'),patch.object(d,'health'):
                with self.assertRaises(RuntimeError):d.install_files({first:b'new-first',second:b'new-second'},originals,True)
            self.assertEqual(first.read_bytes(),b'old-first');self.assertEqual(second.read_bytes(),b'old-second')
            self.assertEqual(commands[-1],('systemctl','start',d.WORKER))

    def test_rollback_attempts_every_file_and_worker_after_one_restore_error(self):
        import deploy_generated_receipts as d
        with tempfile.TemporaryDirectory() as directory:
            first=Path(directory)/'first.py';second=Path(directory)/'second.py'
            for p in (first,second):p.write_bytes(b'old')
            originals={p:(p.read_bytes(),p.stat()) for p in (first,second)}
            real=d.atomic;commands=[]
            def atomic(path,data,metadata=None,*,relabel=True):
                if not relabel and path==second:raise OSError('one rollback failure')
                return real(path,data,metadata,relabel=relabel)
            with patch.object(d,'atomic',atomic),patch.object(d,'run',side_effect=lambda *args:commands.append(args)), \
                 patch.object(d.subprocess,'run'),patch.object(d,'health',side_effect=RuntimeError('health failure')):
                with self.assertRaisesRegex(RuntimeError,'rollback failures'):d.install_files({first:b'new',second:b'new'},originals,True)
            self.assertEqual(first.read_bytes(),b'old')
            self.assertEqual(commands[-1],('systemctl','start',d.WORKER))
