"""The reviewed package must retain identical bytes after a Git checkout."""
import hashlib
import json
from pathlib import Path
import unittest


class PackageInputsTests(unittest.TestCase):
    def test_reviewed_input_hashes_match_the_distributed_files(self):
        folder = Path(__file__).resolve().parent
        manifest = json.loads((folder / 'deploy-manifest.json').read_text(encoding='utf-8'))
        for name, expected in manifest['inputs'].items():
            with self.subTest(name=name):
                data = (folder / name).read_bytes()
                self.assertFalse(b'\r' in data, 'Git eol=lf must not change reviewed package bytes')
                self.assertEqual(hashlib.sha256(data).hexdigest(), expected)


if __name__ == '__main__':
    unittest.main()
