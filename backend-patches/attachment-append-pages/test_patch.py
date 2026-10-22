import ast
import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit
import unittest

SPEC = importlib.util.spec_from_file_location('patcher', Path(__file__).with_name('patch_backend.py'))
patcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(patcher)


class PatchTests(unittest.TestCase):
    def setUp(self):
        source = Path(os.environ.get('ATTACHMENT_APPEND_BRIDGE_BASELINE') or
                      Path(__file__).with_name('bridge_upload_fixture.txt')).read_text(encoding='utf-8')
        patched = patcher.patch_bridge(source)
        tree = ast.parse(patched)
        cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'BridgeHandler')
        method = next(node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name == '_process_portal_upload')
        self.calls = []
        context = {'parse_qs': parse_qs, 'urlsplit': urlsplit,
                   'portal_replace_attachment': lambda *a, **kw: self.calls.append(kw) or {'status': 'processed', 'operation': 'attachment_replaced'},
                   'log': lambda *a, **kw: None}
        exec(compile(ast.Module(body=[method], type_ignores=[]), '<patched-handler>', 'exec'), context)
        self.handler = context['_process_portal_upload']
        self.removed = []
        self.bridge = SimpleNamespace(portal_authorize=lambda *a, **k: None,
            handle=lambda *a, **k: self.fail('replacement must not enter workflow.handle'))
        self.owner = SimpleNamespace(bridge=self.bridge, path='', headers={'X-Portal-Message-Id': 'retry-id'}, rfile=None,
            portal_authenticator=SimpleNamespace(allowed_emails={'owner'}), portal_media_store=None,
            portal_upload_store=SimpleNamespace(stage=lambda *a, **k: 'staged', remove=self.removed.append),
            _send_json=lambda status, body, **kwargs: (status, body))

    def test_real_upload_handler_dispatches_replacement_without_workflow_and_cleans_staged_upload(self):
        self.owner.path = '/portal/upload?operation=attachment_replace&attachment_id=target&expected_sha256=hash&request_id=retry-id'
        status, body = self.handler(self.owner, {'oid': 'owner'}, 100, 'https://example.test')
        self.assertEqual(status, 200)
        self.assertEqual(body['operation'], 'attachment_replaced')
        self.assertEqual(self.calls[0]['attachment_id'], 'target')
        self.assertEqual(self.removed, ['staged'])

    def test_unknown_or_duplicate_operation_and_mismatched_attempt_fail_closed(self):
        for query in ['operation=wrong', 'operation=attachment_replace&operation=wrong',
                      'operation=attachment_replace&attachment_id=id&expected_sha256=hash&request_id=other']:
            with self.subTest(query=query):
                self.owner.path = '/portal/upload?' + query
                status, body = self.handler(self.owner, {'oid': 'owner'}, 100)
                self.assertEqual(status, 422)
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()
