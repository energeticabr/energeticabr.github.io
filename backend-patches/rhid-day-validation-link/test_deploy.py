"""Linux-only atomic install checks; run on the VM against temporary paths."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import sys
import unittest

if sys.platform == "linux":
    import deploy
else:
    deploy = None


@unittest.skipUnless(sys.platform == "linux", "Atomic deploy requires Linux")
class AtomicInstallTests(unittest.TestCase):
    def test_candidate_is_installed_and_old_bytes_are_recoverable(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            live = root / "live"
            recovery = root / "recovery"
            live.mkdir()
            recovery.mkdir()
            path = live / "channel_bridge.py"
            path.write_bytes(b"old")
            with patch.object(deploy, "ROOTS", (live, root / "mirror")):
                displaced = deploy.atomic_install(path, b"new", deploy.digest(b"old"), recovery)
            self.assertEqual(path.read_bytes(), b"new")
            self.assertEqual(displaced.read_bytes(), b"old")

    def test_copy_failure_after_exchange_restores_old_target(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            live = root / "live"
            recovery = root / "recovery"
            live.mkdir()
            recovery.mkdir()
            path = live / "channel_bridge.py"
            path.write_bytes(b"old")
            with patch.object(deploy, "ROOTS", (live, root / "mirror")), patch.object(deploy.shutil, "copy2", side_effect=OSError("copy failed")):
                with self.assertRaisesRegex(OSError, "copy failed"):
                    deploy.atomic_install(path, b"new", deploy.digest(b"old"), recovery)
            self.assertEqual(path.read_bytes(), b"old")


if __name__ == "__main__":
    unittest.main()
