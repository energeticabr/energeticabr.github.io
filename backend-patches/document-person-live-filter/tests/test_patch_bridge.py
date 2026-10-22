"""Exact anchors, independent per-root preservation, idempotence and CLI guards."""
import ast
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from bridge_fixture import PATCH_ROOT, PINS, PRIVATE_ROOT, load_module, pinned_source


class PatchBridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.patcher = load_module("document_person_patch_guards", PATCH_ROOT / "patch_bridge.py")

    def setUp(self):
        temporary_root = PRIVATE_ROOT / "backend/tests"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="patch-", dir=temporary_root)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_both_candidates_compile_and_reapplication_is_idempotent(self):
        candidates = []
        for root in PINS:
            baseline = pinned_source(root)
            candidate = self.patcher.patch_bridge(baseline)
            compile(candidate, "channel_bridge.py", "exec")
            self.assertNotEqual(candidate, baseline)
            self.assertEqual(self.patcher.patch_bridge(candidate), candidate)
            candidates.append(candidate)
        self.assertNotEqual(*candidates, "Distinct root baselines must remain distinct")

    def test_missing_duplicate_partial_and_drifted_patched_anchors_are_refused(self):
        for root in PINS:
            baseline = pinned_source(root)
            patched = self.patcher.patch_bridge(baseline)
            for old, new in self.patcher.REPLACEMENTS:
                changes = (baseline.replace(old, "", 1), baseline + old,
                           baseline.replace(old, new, 1), patched.replace(new, "", 1), patched + new)
                for changed in changes:
                    with self.subTest(root=root), self.assertRaisesRegex(ValueError, "source changed"):
                        self.patcher.patch_bridge(changed)

    def test_only_import_and_real_messenger_filter_method_change(self):
        for root in PINS:
            before = ast.parse(pinned_source(root))
            after = ast.parse(self.patcher.patch_bridge(pinned_source(root)))
            for tree in (before, after):
                tree.body = [node for node in tree.body if not (isinstance(node, ast.ImportFrom) and node.module == "logic")]
                cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "ChannelMessenger")
                cls.body = [node for node in cls.body if not (isinstance(node, ast.FunctionDef) and node.name == "_send_option_poll")]
            self.assertEqual(ast.dump(before), ast.dump(after))

    def cli(self, source, target):
        return subprocess.run([sys.executable, "-B", str(PATCH_ROOT / "patch_bridge.py"), str(source), str(target)], capture_output=True, text=True)

    def test_cli_preserves_each_source_and_refuses_existing_output(self):
        for root in PINS:
            filename, _ = PINS[root]
            source = PRIVATE_ROOT / filename
            before = source.read_bytes()
            target = self.root / (root + ".py")
            result = self.cli(source, target)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(target.read_bytes(), self.patcher.patch_bridge(before.decode()).encode())
            second = self.cli(source, target)
            self.assertNotEqual(second.returncode, 0)
            self.assertEqual(source.read_bytes(), before)

    def test_cli_refuses_source_overwrite(self):
        source = self.root / "source.py"
        raw = pinned_source("production").encode()
        source.write_bytes(raw)
        self.assertNotEqual(self.cli(source, source).returncode, 0)
        self.assertEqual(source.read_bytes(), raw)

    def test_syntax_error_is_rejected_before_output_creation(self):
        source, output = self.root / "broken.py", self.root / "candidate.py"
        source.write_bytes((pinned_source("production") + "\ndef broken(:\n").encode())
        self.assertNotEqual(self.cli(source, output).returncode, 0)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
