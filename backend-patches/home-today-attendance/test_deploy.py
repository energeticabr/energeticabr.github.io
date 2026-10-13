"""Execute the production deploy function with in-memory filesystem/service boundaries."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest

def load_deploy(safe, restart):
    tree = ast.parse(Path(__file__).with_name('deploy.py').read_text())
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'deploy')
    context = {'Path': Path, 'STAGE': Path('/stage'), 'BEFORE': 'before', 'AFTER': 'after',
               'safe': safe, 'health': lambda: {'status': 'ok'}, 'restart': restart}
    exec(compile(ast.Module(body=[function], type_ignores=[]), 'deploy.py', 'exec'), context)
    return context['deploy']

class DeployTests(unittest.TestCase):
    def test_mirror_rollback_conflict_still_restores_live_and_restarts(self):
        calls, restarts = [], []
        def install(content, target, attributes, expected):
            calls.append((str(target), expected))
            if expected == 'after' and str(target).startswith('/home/opc'):
                raise RuntimeError('Concurrent mirror change preserved')
        def restart():
            restarts.append(True)
            if len(restarts) == 1: raise RuntimeError('Unhealthy new process')
            return {'status':'ok'}
        safe = SimpleNamespace(checked=lambda *_: b'pass\n', digest=lambda *_:'config', install=install)
        from unittest.mock import patch
        with patch.object(Path, 'stat', return_value=object()):
            with self.assertRaises(RuntimeError): load_deploy(safe, restart)(True)
        self.assertIn(('/opt/energetica-whatsapp/worker/workflow.py', 'after'), calls)
        self.assertEqual(len(restarts), 2)

if __name__ == '__main__': unittest.main()
