"""Integrity checks for the bounded source-only compression rollout."""
import ast
import os
from pathlib import Path
import unittest

from patch_backend import BEFORE, patch


class PatchTests(unittest.TestCase):
    def test_source_drift_is_rejected(self):
        for relative in BEFORE:
            with self.assertRaisesRegex(RuntimeError, 'baseline hash mismatch'):
                patch(relative, b'unknown = True\n')

    def test_only_the_three_policy_methods_change(self):
        baseline = Path(os.environ["BEST_EFFORT_BASELINE"])
        for relative, owner_name, method_name in (
            ("worker/compression.py", "AttachmentCompressor", "_compress_at_level"),
            ("channel_bridge.py", "ChannelBridge", "portal_attachment_compress"),
            ("worker/workflow.py", "WorkflowEngine", "_send_attachment_compression_levels"),
        ):
            data = (baseline / Path(relative).name).read_bytes()
            original, changed = ast.parse(data), ast.parse(patch(relative, data))
            old_owner = next(node for node in original.body if isinstance(node, ast.ClassDef) and node.name == owner_name)
            new_owner = next(node for node in changed.body if isinstance(node, ast.ClassDef) and node.name == owner_name)
            old_methods = {node.name: ast.dump(node) for node in old_owner.body if isinstance(node, ast.FunctionDef)}
            new_methods = {node.name: ast.dump(node) for node in new_owner.body if isinstance(node, ast.FunctionDef)}
            self.assertEqual(set(old_methods), set(new_methods))
            self.assertEqual({name for name in old_methods if old_methods[name] != new_methods[name]}, {method_name})
            old_owner.body, new_owner.body = [], []
            self.assertEqual(ast.dump(original), ast.dump(changed))


if __name__ == "__main__":
    unittest.main()
