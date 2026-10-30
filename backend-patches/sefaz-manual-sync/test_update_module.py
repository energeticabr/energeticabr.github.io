import importlib.util
import unittest
from pathlib import Path


class ModuleUpdateTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('update_module.py')
        self.assertTrue(path.exists(), 'Atualizador atômico do módulo fiscal ausente')
        spec = importlib.util.spec_from_file_location('sefaz_module_update', path)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_reviewed_candidate_matches_the_repository_module(self):
        source = Path(__file__).with_name('sefaz_sync.py').read_bytes()
        self.assertEqual(self.module.checked_module(source, self.module.CANDIDATE_MODULE), source)

    def test_hash_drift_and_invalid_python_fail_closed(self):
        with self.assertRaises(RuntimeError):
            self.module.checked_module(b'print(1)\n', '0' * 64)
        broken = b'def incomplete(:\n'
        import hashlib
        with self.assertRaises(SyntaxError):
            self.module.checked_module(broken, hashlib.sha256(broken).hexdigest())


if __name__ == '__main__':
    unittest.main()
