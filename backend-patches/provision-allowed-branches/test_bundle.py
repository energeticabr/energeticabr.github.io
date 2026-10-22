"""The real bundle reader must return only exact reviewed private source bytes."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest


class BundleTests(unittest.TestCase):
    def setUp(self):
        source = Path(__file__).with_name('patch_backend.py')
        self.assertTrue(source.is_file(), 'A validated private-bundle reader is required')
        spec = importlib.util.spec_from_file_location('allowed_branches_bundle', source)
        self.reader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.reader)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.reader.STAGE = Path(self.temp.name)
        self.before, self.after = b'OLD = 1\n', b'NEW = 2\n'
        self.manifest = {'files': {name: {
            'before': hashlib.sha256(self.before).hexdigest(),
            'after': hashlib.sha256(self.after).hexdigest()} for name in self.reader.FILES}}
        (self.reader.STAGE / 'deploy-manifest.json').write_text(json.dumps(self.manifest), encoding='utf-8')
        self.archive()

    def archive(self, extra=None, duplicate=False, symlink=False, content=None):
        with tarfile.open(self.reader.STAGE / 'source-files.tar', 'w') as archive:
            for index, name in enumerate(self.reader.FILES):
                data = self.after if content is None else content
                member = tarfile.TarInfo(name)
                member.size = len(data)
                if symlink and index == 0:
                    member.type, member.linkname = tarfile.SYMTYPE, '../outside.py'
                    member.size = 0
                    archive.addfile(member)
                else:
                    archive.addfile(member, io.BytesIO(data))
                if duplicate and index == 0:
                    archive.addfile(member, io.BytesIO(data))
            if extra:
                member = tarfile.TarInfo(extra)
                member.size = len(self.after)
                archive.addfile(member, io.BytesIO(self.after))

    def test_returns_exact_payload_without_extracting_files(self):
        for name in self.reader.FILES:
            self.assertEqual(self.reader.patch(name, self.before), b'NEW = 2\n')
        self.assertEqual({p.name for p in self.reader.STAGE.iterdir()},
                         {'source-files.tar', 'deploy-manifest.json'})

    def test_rejects_wrong_baseline(self):
        with self.assertRaisesRegex(RuntimeError, 'baseline'):
            self.reader.patch(self.reader.FILES[0], b'OTHER = 1\n')

    def test_rejects_unknown_target(self):
        with self.assertRaisesRegex(RuntimeError, 'scope'):
            self.reader.patch('../outside.py', self.before)

    def test_rejects_extra_members_and_path_traversal(self):
        for extra in ['other.py', '../outside.py']:
            with self.subTest(extra=extra):
                self.archive(extra=extra)
                with self.assertRaisesRegex(RuntimeError, 'scope'):
                    self.reader.patch(self.reader.FILES[0], self.before)

    def test_rejects_duplicate_members(self):
        self.archive(duplicate=True)
        with self.assertRaisesRegex(RuntimeError, 'scope'):
            self.reader.patch(self.reader.FILES[0], self.before)

    def test_rejects_links(self):
        self.archive(symlink=True)
        with self.assertRaisesRegex(RuntimeError, 'member'):
            self.reader.patch(self.reader.FILES[0], self.before)

    def test_rejects_changed_payload(self):
        self.archive(content=b'CHANGED = 3\n')
        with self.assertRaisesRegex(RuntimeError, 'hash'):
            self.reader.patch(self.reader.FILES[0], self.before)


if __name__ == '__main__':
    unittest.main()
