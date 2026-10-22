"""Integrity checks against a private, hash-pinned source snapshot."""
import ast
import hashlib
import os
from pathlib import Path
import unittest

from patch_workflow import BEFORE, patch


class PatchTests(unittest.TestCase):
    def test_rejects_source_drift(self):
        with self.assertRaisesRegex(RuntimeError, 'baseline hash mismatch'):
            patch(b'class WorkflowEngine: pass\n')

    def test_only_scoped_workflow_methods_change_and_no_module_or_signature_code_changes(self):
        path = os.environ.get('MANUAL_WORKFLOW_BASELINE')
        self.assertTrue(path, 'Set MANUAL_WORKFLOW_BASELINE to the private baseline snapshot')
        data = Path(path).read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), BEFORE)
        output = patch(data)
        compile(output, 'worker/workflow.py', 'exec')
        before, after = ast.parse(data), ast.parse(output)
        old = next(n for n in before.body if isinstance(n, ast.ClassDef) and n.name == 'WorkflowEngine')
        new = next(n for n in after.body if isinstance(n, ast.ClassDef) and n.name == 'WorkflowEngine')
        methods = {n.name: ast.dump(n, include_attributes=False) for n in new.body if isinstance(n, ast.FunctionDef)}
        changed = set()
        for node in old.body:
            if isinstance(node, ast.FunctionDef) and ast.dump(node, include_attributes=False) != methods[node.name]:
                changed.add(node.name)
        self.assertEqual(changed, {'handle', '_request_attachment_compression',
            '_request_received_attachment_compression', '_begin_attachment_compression_check',
            '_handle_attachment', '_resend_current_prompt'})
        self.assertEqual(set(methods) - {n.name for n in old.body if isinstance(n, ast.FunctionDef)},
                         {'_recover_legacy_attachment_compression'})
        old.body, new.body = [], []
        self.assertEqual(ast.dump(before, include_attributes=False), ast.dump(after, include_attributes=False))


if __name__ == '__main__':
    unittest.main()
