"""Real Linux deployment-lock checks; skipped on Windows without fcntl."""
import importlib.util
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

from bridge_fixture import PATCH_ROOT, PRIVATE_ROOT


@unittest.skipIf(os.name == 'nt', 'Requires Linux flock and Unix ownership')
class LockTests(unittest.TestCase):
    def setUp(self):
        path = (PATCH_ROOT / 'deploy.py')
        spec = importlib.util.spec_from_file_location('lock_test_deploy', path)
        self.d = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.d)
        self.temp = tempfile.TemporaryDirectory(dir=PRIVATE_ROOT / 'backend/tests')
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
