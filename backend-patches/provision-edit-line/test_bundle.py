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
        spec = importlib.util.spec_from_file_location('provision_edit_line_bundle', source)
        self.reader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.reader)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.reader.STAGE = Path(self.temp.name)
        self.before = {name: b'OLD = 1\n' for name in self.reader.FILES}
        self.after = {name: b'NEW = 2\n' for name in self.reader.FILES}
        self.manifest = {'files': {name: {
            'before': hashlib.sha256(self.before[name]).hexdigest(),
            'after': hashlib.sha256(self.after[name]).hexdigest()} for name in self.reader.FILES}}
        (self.reader.STAGE / 'deploy-manifest.json').write_text(json.dumps(self.manifest), encoding='utf-8')
        self.archive()

    def archive(self, extra=None, duplicate=False, symlink=False, content=None):
        with tarfile.open(self.reader.STAGE / 'source-files.tar', 'w') as archive:
            for index, name in enumerate(self.reader.FILES):
                data = self.after[name] if content is None else content
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
                member.size = len(b'NEW = 2\n')
                archive.addfile(member, io.BytesIO(b'NEW = 2\n'))

    def test_returns_exact_payload_without_extracting_files(self):
        for name in self.reader.FILES:
            self.assertEqual(self.reader.patch(name, self.before[name]), self.after[name])
        self.assertEqual({p.name for p in self.reader.STAGE.iterdir()},
                         {'source-files.tar', 'deploy-manifest.json'})

    def test_rejects_wrong_baseline(self):
        with self.assertRaisesRegex(RuntimeError, 'baseline'):
            self.reader.patch(self.reader.FILES[0], b'OTHER = 1\n')

    def test_rejects_unknown_target(self):
        with self.assertRaisesRegex(RuntimeError, 'scope'):
            self.reader.patch('../outside.py', b'OLD = 1\n')

    def test_rejects_group_and_config_from_previous_patch_scope(self):
        for name in ('worker/payment_provision_group.py', 'worker/workflow_config.json'):
            with self.subTest(name=name):
                with self.assertRaisesRegex(RuntimeError, 'scope'):
                    self.reader.patch(name, b'OLD = 1\n')

    def test_rejects_extra_members_and_path_traversal(self):
        for extra in ['other.py', '../outside.py', 'worker/payment_provision_group.py',
                      'worker/workflow_config.json']:
            with self.subTest(extra=extra):
                self.archive(extra=extra)
                with self.assertRaisesRegex(RuntimeError, 'scope'):
                    self.reader.patch(self.reader.FILES[0], self.before[self.reader.FILES[0]])

    def test_rejects_duplicate_members(self):
        self.archive(duplicate=True)
        with self.assertRaisesRegex(RuntimeError, 'scope'):
            self.reader.patch(self.reader.FILES[0], self.before[self.reader.FILES[0]])

    def test_rejects_links(self):
        self.archive(symlink=True)
        with self.assertRaisesRegex(RuntimeError, 'member'):
            self.reader.patch(self.reader.FILES[0], self.before[self.reader.FILES[0]])

    def test_rejects_changed_payload(self):
        self.archive(content=b'CHANGED = 3\n')
        with self.assertRaisesRegex(RuntimeError, 'hash'):
            self.reader.patch(self.reader.FILES[0], self.before[self.reader.FILES[0]])


class PackageTests(unittest.TestCase):
    """Use disposable synthetic snapshots only; never package the live candidate."""

    def setUp(self):
        source = Path(__file__).with_name('package.py')
        self.assertTrue(source.is_file(), 'Two-file private packaging is required')
        spec = importlib.util.spec_from_file_location('provision_edit_line_package', source)
        self.p = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.p)
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        base = Path(temporary.name).resolve()
        self.p.REPOSITORY = base / 'public-repo'
        self.p.PUBLIC = self.p.REPOSITORY / 'backend-patches/provision-edit-line'
        self.p.PUBLIC.mkdir(parents=True)
        self.workspace = base / 'private'
        self.files = ('worker/payment_provision_flow.py', 'worker/workflow.py')
        self.before = {name: b'old = True\n'
                       for name in self.files}
        self.after = {name: b'new = True\n'
                      for name in self.files}
        for directory, payloads in (('baseline', self.before), ('candidate', self.after)):
            for name, data in payloads.items():
                target = self.workspace / directory / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
        self.runner = self.p.REPOSITORY / 'backend-patches/launch-payroll-per-payment/deploy.py'
        self.runner.parent.mkdir(parents=True)
        self.runner.write_bytes(b'# synthetic shared runner\n')
        self.shared_sha = hashlib.sha256(self.runner.read_bytes()).hexdigest()
        # Real deployment configuration, with only source pins changed to fixtures.
        deployment = Path(__file__).with_name('deploy.py').read_text(encoding='utf-8')
        pins = {name: hashlib.sha256(data).hexdigest() for name, data in self.before.items()}
        deployment += '\nBEFORE = ' + repr(pins) + '\nSHARED_RUNNER_SHA = ' + repr(self.shared_sha) + '\n'
        (self.p.PUBLIC / 'deploy.py').write_text(deployment, encoding='utf-8')
        for name in ('patch_backend.py', 'deploy.sh', 'deployment_gate.sh'):
            (self.p.PUBLIC / name).write_bytes(Path(__file__).with_name(name).read_bytes())

    def package(self):
        return self.p.package(self.workspace)

    def assert_no_outputs(self):
        for path in (self.p.PUBLIC / 'source.patch', self.p.PUBLIC / 'deploy-manifest.json',
                     self.workspace / 'source-files.tar', self.workspace / 'shared-deploy.py'):
            self.assertFalse(path.exists(), str(path))

    def test_two_file_bundle_is_private_deterministic_and_round_trips(self):
        manifest = self.package()
        self.assertEqual(set(manifest['files']), set(self.files))
        with tarfile.open(self.workspace / 'source-files.tar') as archive:
            self.assertEqual(archive.getnames(), list(self.files))
            for member in archive.getmembers():
                self.assertTrue(member.isfile())
                self.assertEqual(member.mtime, 0)
                self.assertEqual(archive.extractfile(member).read(), self.after[member.name])
        self.assertFalse(list(self.p.REPOSITORY.rglob('source-files.tar')))
        previous = (self.workspace / 'source-files.tar').read_bytes()
        self.assertEqual(self.package(), manifest)
        self.assertEqual((self.workspace / 'source-files.tar').read_bytes(), previous)
        for name, pin in manifest['inputs'].items():
            root = self.workspace if name in {'source-files.tar', 'shared-deploy.py'} else self.p.PUBLIC
            self.assertEqual(hashlib.sha256((root / name).read_bytes()).hexdigest(), pin)
        spec = importlib.util.spec_from_file_location('packaged_bundle_reader', self.p.PUBLIC / 'patch_backend.py')
        reader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(reader)
        reader.STAGE = self.workspace
        (self.workspace / 'deploy-manifest.json').write_bytes((self.p.PUBLIC / 'deploy-manifest.json').read_bytes())
        for name in self.files:
            self.assertEqual(reader.patch(name, self.before[name]), self.after[name])

    def test_public_diff_contains_only_minimal_changes_for_two_files(self):
        self.package()
        diff = (self.p.PUBLIC / 'source.patch').read_text()
        self.assertEqual(diff.count('--- a/worker/'), 2)
        self.assertIn('+++ b/worker/workflow.py', diff)
        self.assertIn('-old = True\n+new = True\n', diff)



    def test_rejects_python_syntax_error_before_creating_any_outputs(self):
        (self.workspace / 'candidate' / self.files[0]).write_bytes(b'def broken(\n')
        with self.assertRaises(SyntaxError):
            self.package()
        self.assert_no_outputs()

    def test_rejects_changed_baseline_before_creating_any_outputs(self):
        (self.workspace / 'baseline' / self.files[-1]).write_bytes(b'{}\n')
        with self.assertRaisesRegex(RuntimeError, 'baseline'):
            self.package()
        self.assert_no_outputs()

    def test_rejects_unchanged_source_before_creating_any_outputs(self):
        (self.workspace / 'candidate' / self.files[-1]).write_bytes(self.before[self.files[-1]])
        with self.assertRaisesRegex(RuntimeError, 'unchanged'):
            self.package()
        self.assert_no_outputs()

    def test_rejects_unpinned_shared_runner_before_creating_any_outputs(self):
        self.runner.write_bytes(b'# wrong runner\n')
        with self.assertRaisesRegex(RuntimeError, 'Shared installer source drift'):
            self.package()
        self.assert_no_outputs()

    def test_rejects_private_archive_destination_inside_public_repository(self):
        with self.assertRaisesRegex(ValueError, 'outside the public repository'):
            self.p.package(self.p.REPOSITORY / 'private')
        self.assert_no_outputs()


if __name__ == '__main__':
    unittest.main()
