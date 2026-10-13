"""Exercise the guarded patch and CLI, including fail-closed drift handling."""
import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from bridge_fixture import PATCH_ROOT, SOURCE, SOURCE_SHA256, load_module, pinned_source


class PatchBridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.patcher = load_module("attachment_recovery_patch_guards", PATCH_ROOT / "patch_bridge.py")
        cls.baseline = pinned_source()

    def setUp(self):
        temporary_root = PATCH_ROOT / "tests/.tmp"
        temporary_root.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="patch-", dir=temporary_root)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_exact_patch_compiles_without_writing_readonly_source(self):
        result = self.patcher.patch_bridge(self.baseline)
        compile(result, "patched_channel_bridge.py", "exec")
        self.assertNotEqual(result, self.baseline)
        self.assertEqual(hashlib.sha256(SOURCE.read_bytes()).hexdigest(), SOURCE_SHA256)

    def test_each_missing_or_duplicated_anchor_is_refused(self):
        self.assertEqual(len(self.patcher.REPLACEMENTS), 3)
        for index, (old, _) in enumerate(self.patcher.REPLACEMENTS):
            for changed in (self.baseline.replace(old, "", 1), self.baseline + old):
                with self.subTest(replacement=index), self.assertRaisesRegex(ValueError, "source changed"):
                    self.patcher.patch_bridge(changed)

    def test_reapplication_is_refused(self):
        candidate = self.patcher.patch_bridge(self.baseline)
        with self.assertRaises(ValueError):
            self.patcher.patch_bridge(candidate)

    def test_syntax_error_is_refused_before_output_creation(self):
        broken = self.root / "broken.py"
        broken.write_bytes((self.baseline + "\ndef broken(:\n").encode("utf-8"))
        output = self.root / "candidate.py"
        process = subprocess.run([sys.executable, "-B", str(PATCH_ROOT / "patch_bridge.py"), str(broken), str(output)],
                                 capture_output=True, text=True)
        self.assertNotEqual(process.returncode, 0)
        self.assertIn("SyntaxError", process.stderr)
        self.assertFalse(output.exists())

    def test_cli_writes_only_requested_candidate_and_preserves_source_bytes(self):
        output = self.root / "candidate.py"
        process = subprocess.run([sys.executable, "-B", str(PATCH_ROOT / "patch_bridge.py"), str(SOURCE), str(output)],
                                 capture_output=True, text=True)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(output.read_bytes(), self.patcher.patch_bridge(self.baseline).encode("utf-8"))
        self.assertEqual(hashlib.sha256(SOURCE.read_bytes()).hexdigest(), SOURCE_SHA256)

    def test_cli_refuses_source_overwrite(self):
        original = self.root / "source.py"
        original.write_bytes(self.baseline.encode("utf-8"))
        process = subprocess.run([sys.executable, "-B", str(PATCH_ROOT / "patch_bridge.py"), str(original), str(original)],
                                 capture_output=True, text=True)
        self.assertNotEqual(process.returncode, 0)
        self.assertIn("read-only", process.stderr)
        self.assertEqual(original.read_bytes(), self.baseline.encode("utf-8"))


if __name__ == "__main__":
    unittest.main()
