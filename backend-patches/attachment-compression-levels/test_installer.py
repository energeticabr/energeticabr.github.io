import importlib.util
import json
import os
from pathlib import Path
import tempfile
import sys
import unittest
from unittest.mock import patch

PACKAGE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('installer', PACKAGE / 'install.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


def baseline(root):
    edits = json.loads((PACKAGE / 'edits.json').read_text(encoding='utf-8'))
    source = Path(os.environ['COMPRESSION_BACKEND_SOURCE']) if os.environ.get('COMPRESSION_BACKEND_SOURCE') else PACKAGE.parents[2] / 'compression-levels-backend'
    final = {name: (source / name).read_text(encoding='utf-8') for name in {e['file'] for e in edits}}
    original = dict(final)
    for entry in reversed(edits):
        name, old, new = entry['file'], entry['old'], entry['new']
        assert new and original[name].count(new) == 1, name
        original[name] = original[name].replace(new, old, 1)
    for name, content in original.items():
        (root / name).write_text(content, encoding='utf-8')
    return final


class InstallerTests(unittest.TestCase):
    def test_actual_installer_writes_sources_and_keeps_original_backup(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            final = baseline(root)
            originals = {name: (root / name).read_bytes() for name in final}
            with patch.object(sys, 'argv', ['install.py', str(root)]):
                installer.main()
            self.assertEqual({name: (root / name).read_text(encoding='utf-8') for name in final}, final)
            backups = list(root.glob('attachment-compression-levels-backup-*'))
            self.assertEqual(len(backups), 1)
            self.assertEqual({name: (backups[0] / name).read_bytes() for name in final}, originals)

    def test_exact_anchors_prepare_expected_source_and_second_run_is_noop(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            final = baseline(root)
            prepared, already = installer.prepare(root)
            self.assertFalse(already)
            self.assertEqual(prepared, final)
            for name, content in prepared.items():
                (root / name).write_text(content, encoding='utf-8')
            self.assertEqual(installer.prepare(root), ({}, True))

    def test_drift_rejected_before_any_writes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            baseline(root)
            target = root / 'compression.py'
            target.write_text(target.read_text(encoding='utf-8').replace('def compress(self, attachments:', 'def different(self, attachments:'), encoding='utf-8')
            before = {p.name: p.read_bytes() for p in root.iterdir()}
            with self.assertRaisesRegex(RuntimeError, 'anchor'):
                installer.prepare(root)
            self.assertEqual(before, {p.name: p.read_bytes() for p in root.iterdir()})


if __name__ == '__main__':
    unittest.main()
