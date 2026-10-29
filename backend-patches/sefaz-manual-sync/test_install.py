import hashlib
import importlib.util
import sys
import types
import unittest
from pathlib import Path

SOURCE = '''class Handler:
    def route(self, action, body, origin):
        path = "/portal/chat"
        if path == "/portal/chat":
                identity = self._portal_identity()
                if action in {"dda_refresh", "dda_refresh_status"}:
                    return "existing-dda"
                if action == "operation_progress":
                    return "existing-progress"
'''


class InstallTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('install.py')
        self.assertTrue(path.exists(), 'Hash-checked fiscal installer is missing')
        spec = importlib.util.spec_from_file_location('sefaz_install', path)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_route_passes_verified_identity_and_preserves_existing_routes(self):
        candidate = self.module.candidate(SOURCE.encode(), hashlib.sha256(SOURCE.encode()).hexdigest())
        namespace = {}
        exec(candidate, namespace)
        fake = types.ModuleType('sefaz_sync')
        fake.handle_portal = lambda identity, body: {'identity': identity, 'body': body}
        previous = sys.modules.get('sefaz_sync')
        sys.modules['sefaz_sync'] = fake
        try:
            handler = namespace['Handler']()
            handler._send_json = lambda status, body, cors_origin: (status, body, cors_origin)
            identity = {'oid': 'verified-owner'}
            handler._portal_identity = lambda: identity
            body = {'action': 'sefaz_refresh', 'requestId': 'a'*32}
            self.assertEqual(handler.route('sefaz_refresh', body, 'https://app.example'), (200, {'identity': identity, 'body': body}, 'https://app.example'))
            self.assertEqual(handler.route('dda_refresh', {}, ''), 'existing-dda')
            self.assertEqual(handler.route('operation_progress', {}, ''), 'existing-progress')
            def forbidden(): raise PermissionError('Not authenticated')
            handler._portal_identity = forbidden
            with self.assertRaises(PermissionError): handler.route('sefaz_refresh', body, '')
        finally:
            if previous is None: sys.modules.pop('sefaz_sync', None)
            else: sys.modules['sefaz_sync'] = previous

    def test_drift_missing_ambiguous_and_duplicate_hooks_fail_closed(self):
        for source, digest in ((SOURCE.encode(), '0'*64), (b'print(1)', hashlib.sha256(b'print(1)').hexdigest())):
            with self.assertRaises(RuntimeError): self.module.candidate(source, digest)
        duplicate = SOURCE + SOURCE
        with self.assertRaises(RuntimeError): self.module.candidate(duplicate.encode(), hashlib.sha256(duplicate.encode()).hexdigest())
        updated = self.module.candidate(SOURCE.encode(), hashlib.sha256(SOURCE.encode()).hexdigest())
        with self.assertRaises(RuntimeError): self.module.candidate(updated, hashlib.sha256(updated).hexdigest())

    def test_missing_authentication_before_hook_fails_closed(self):
        source = SOURCE.replace('identity = self._portal_identity()', 'identity = body')
        with self.assertRaises(RuntimeError): self.module.candidate(source.encode(), hashlib.sha256(source.encode()).hexdigest())


if __name__ == '__main__': unittest.main()
