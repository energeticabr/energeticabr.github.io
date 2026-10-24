"""The original ten rollout scenarios, adapted to eight independent targets."""
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]
FILES = ('workflow.py', 'workflow_config.json', 'contractor_employment.py',
         'supplier_registration_checkpoint.py')


def load():
    path = ROOT / 'deploy.py'
    assert path.is_file(), 'Current eight-target installer is missing'
    spec = importlib.util.spec_from_file_location('employment_deploy_test', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Runner:
    def __init__(self):
        self.restarts = 0
        self.fail = False

    def health(self):
        return True

    def restart(self):
        self.restarts += 1
        if self.fail and self.restarts == 1:
            raise RuntimeError('synthetic restart failure')


def setup(tmp_path, monkeypatch):
    deploy = load()
    roots = (tmp_path / 'production', tmp_path / 'mirror')
    stage = tmp_path / 'stage'
    entries = []
    originals = {}
    for scope, root in zip(('app', 'build'), roots):
        for number, filename in enumerate(FILES):
            relative = 'worker/' + filename
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            candidate = stage / scope / relative
            candidate.parent.mkdir(parents=True, exist_ok=True)
            after = ('{"value":2}\n' if filename.endswith('.json')
                     else f'VALUE = {2 + number}\n# {scope}\n').encode()
            candidate.write_bytes(after)
            before = None
            if number < 2:
                original = ('{"value":1}\n' if filename.endswith('.json')
                            else f'VALUE = 1\n# {scope}\n').encode()
                target.write_bytes(original)
                originals[str(target)] = original
                before = hashlib.sha256(original).hexdigest()
            entries.append({'destination': str(target), 'candidate': scope + '/' + relative,
                'before_sha256': before, 'after_sha256': hashlib.sha256(after).hexdigest()})
    patch = b'synthetic scoped patch\n'
    (stage / 'source.patch').write_bytes(patch)
    manifest = {'version': 2, 'files': entries, 'patch_sha256': hashlib.sha256(patch).hexdigest()}
    (stage / 'deploy-manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    allowed = {str(root / ('worker/' + name)): scope + '/worker/' + name
               for scope, root in zip(('app', 'build'), roots) for name in FILES}
    monkeypatch.setattr(deploy, 'ALLOWED', allowed)
    @contextmanager
    def locks(paths):
        assert [str(p).replace('\\', '/') for p in paths] == [
            '/tmp/energetica-whatsapp-deploy.lock', '/home/opc/.energetica-deploy.lock']
        yield
    monkeypatch.setattr(deploy.safe, 'deployment_locks', locks)
    runner = Runner()
    def run(apply=False):
        return deploy.deploy(stage, apply=apply,
            expected_manifest_hash=hashlib.sha256((stage / 'deploy-manifest.json').read_bytes()).hexdigest(),
            runner=runner)
    return deploy, roots, stage, originals, entries, runner, run


def test_assemble_exact_hashes_and_new_helpers(tmp_path, monkeypatch):
    deploy, roots, stage, originals, entries, runner, run = setup(tmp_path, monkeypatch)
    assert run()['status'] == 'checked'
    receipt = run(True)
    assert receipt['status'] == 'published' and receipt['serviceHealth']
    assert len(receipt['codeHashes']) == 8
    for entry in entries:
        assert deploy.safe.digest(Path(entry['destination'])) == entry['after_sha256']


def test_assemble_requires_no_system_git_or_patch(tmp_path, monkeypatch):
    deploy, roots, stage, originals, entries, runner, run = setup(tmp_path, monkeypatch)
    def no_external_tools(*args, **kwargs):
        raise AssertionError('Assembler must not depend on system git/patch')
    monkeypatch.setattr(subprocess, 'run', no_external_tools)
    assert run()['status'] == 'checked'


def test_cached_assembly_compiles_every_pinned_source(tmp_path, monkeypatch):
    deploy, roots, stage, originals, entries, runner, run = setup(tmp_path, monkeypatch)
    assert run()['status'] == 'checked'
    broken = stage / 'build/worker/workflow.py'
    broken.write_text('def broken(\n')
    manifest = json.loads((stage / 'deploy-manifest.json').read_text())
    manifest['files'][4]['after_sha256'] = hashlib.sha256(broken.read_bytes()).hexdigest()
    (stage / 'deploy-manifest.json').write_text(json.dumps(manifest))
    with pytest.raises(SyntaxError):
        run(True)
    assert runner.restarts == 0
    assert all(Path(path).read_bytes() == content for path, content in originals.items())


def test_wrong_manifest_or_source_hash_fails_closed(tmp_path, monkeypatch):
    deploy, roots, stage, originals, entries, runner, run = setup(tmp_path, monkeypatch)
    with pytest.raises(RuntimeError, match='Manifest hash'):
        deploy.deploy(stage, expected_manifest_hash='0'*64, runner=runner)
    (stage / 'source.patch').write_text('tampered')
    with pytest.raises(RuntimeError, match='Source patch'):
        run()


def test_private_bundle_hash_and_member_paths_are_checked(tmp_path, monkeypatch):
    deploy, roots, stage, originals, entries, runner, run = setup(tmp_path, monkeypatch)
    (stage / 'app/worker/workflow.py').write_text('TAMPERED = True')
    with pytest.raises(RuntimeError):
        run(True)
    assert all(Path(path).read_bytes() == content for path, content in originals.items())


def test_drift_in_either_root_is_refused(tmp_path, monkeypatch):
    deploy, roots, stage, originals, entries, runner, run = setup(tmp_path, monkeypatch)
    (roots[1] / 'worker/workflow.py').write_text('foreign change')
    with pytest.raises(RuntimeError):
        run(True)
    assert runner.restarts == 0
    assert (roots[0] / 'worker/workflow.py').read_bytes() == originals[str(roots[0] / 'worker/workflow.py')]


def test_unknown_manifest_paths_are_refused(tmp_path, monkeypatch):
    deploy, roots, stage, originals, entries, runner, run = setup(tmp_path, monkeypatch)
    manifest = json.loads((stage / 'deploy-manifest.json').read_text())
    manifest['files'][0]['destination'] = '../credentials.env'
    (stage / 'deploy-manifest.json').write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match='scope|eight'):
        run()


def test_failed_restart_restores_each_root_and_retains_inactive_helpers(tmp_path, monkeypatch):
    deploy, roots, stage, originals, entries, runner, run = setup(tmp_path, monkeypatch)
    runner.fail = True
    with pytest.raises(RuntimeError, match='synthetic'):
        run(True)
    assert all(Path(path).read_bytes() == content for path, content in originals.items())
    receipts = list(tmp_path.glob('contractor-employment-backup-*/receipt.json'))
    assert len(receipts) == 1
    receipt = json.loads(receipts[0].read_text())
    assert receipt['status'] == 'rolled_back'
    assert len(receipt['retainedHelpers']) == 4
    for entry in receipt['retainedHelpers']:
        assert deploy.safe.digest(Path(entry['path'])) == entry['sha256']
    assert runner.restarts == 2


def test_check_only_does_not_write_live_sources(tmp_path, monkeypatch):
    deploy, roots, stage, originals, entries, runner, run = setup(tmp_path, monkeypatch)
    assert run()['status'] == 'checked'
    assert all(Path(path).read_bytes() == content for path, content in originals.items())
    assert not list(tmp_path.glob('contractor-employment-backup-*'))
    assert not (roots[0] / 'worker/contractor_employment.py').exists()


def test_future_bundle_contains_only_four_files_without_old_background_or_acl_code(tmp_path, monkeypatch):
    deploy, roots, stage, originals, entries, runner, run = setup(tmp_path, monkeypatch)
    manifest = json.loads((stage / 'deploy-manifest.json').read_text())
    manifest['files'].append({'destination': '/opt/energetica-whatsapp/worker/contractor_permissions.py',
        'candidate': 'app/worker/contractor_permissions.py', 'before_sha256': None, 'after_sha256': 'a'*64})
    (stage / 'deploy-manifest.json').write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match='scope|eight'):
        run()


def test_existing_helper_is_never_replaced(tmp_path, monkeypatch):
    deploy, roots, stage, originals, entries, runner, run = setup(tmp_path, monkeypatch)
    target = roots[1] / 'worker/contractor_employment.py'
    target.write_bytes(b'CONCURRENT')
    with pytest.raises(RuntimeError):
        run(True)
    assert target.read_bytes() == b'CONCURRENT'
    assert all(Path(path).read_bytes() == content for path, content in originals.items())


def test_stage_inside_live_root_is_rejected_before_writes(tmp_path, monkeypatch):
    import shutil
    deploy, roots, stage, originals, entries, runner, run = setup(tmp_path, monkeypatch)
    inside = roots[0] / 'candidate-stage'
    shutil.copytree(stage, inside)
    with pytest.raises(ValueError, match='outside'):
        deploy.deploy(inside, apply=True, expected_manifest_hash=hashlib.sha256(
            (inside / 'deploy-manifest.json').read_bytes()).hexdigest(), runner=runner)
    assert all(Path(path).read_bytes() == content for path, content in originals.items())


def test_absent_helper_state_must_be_explicit_in_manifest(tmp_path, monkeypatch):
    deploy, roots, stage, originals, entries, runner, run = setup(tmp_path, monkeypatch)
    manifest = json.loads((stage / 'deploy-manifest.json').read_text())
    del manifest['files'][2]['before_sha256']
    (stage / 'deploy-manifest.json').write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match='explicit|scope'):
        run(True)
    assert all(Path(path).read_bytes() == content for path, content in originals.items())


def test_concurrent_helper_publisher_wins_without_overwrite(tmp_path, monkeypatch):
    deploy, roots, stage, originals, entries, runner, run = setup(tmp_path, monkeypatch)
    target = roots[1] / 'worker/contractor_employment.py'
    actual = deploy.create_only
    def race(content, path, info):
        if path == target:
            target.write_bytes(b'CONCURRENT')
        return actual(content, path, info)
    monkeypatch.setattr(deploy, 'create_only', race)
    with pytest.raises(RuntimeError):
        run(True)
    assert target.read_bytes() == b'CONCURRENT'
    assert all(Path(path).read_bytes() == content for path, content in originals.items())


def test_rollback_preserves_concurrent_workflow_and_recovery(tmp_path, monkeypatch):
    deploy, roots, stage, originals, entries, runner, run = setup(tmp_path, monkeypatch)
    target = roots[0] / 'worker/workflow.py'
    def changed():
        target.write_bytes(b'FOREIGN = True\n')
        runner.restarts += 1
        raise RuntimeError('concurrent writer')
    runner.restart = changed
    with pytest.raises(RuntimeError, match='Rollback incomplete'):
        run(True)
    assert target.read_bytes() == b'FOREIGN = True\n'
    receipt = json.loads(next(tmp_path.glob('contractor-employment-backup-*/receipt.json')).read_text())
    assert receipt['status'] == 'rollback_incomplete'
    assert receipt['errors']


def test_symlink_target_and_candidate_are_rejected(tmp_path, monkeypatch):
    deploy, roots, stage, originals, entries, runner, run = setup(tmp_path, monkeypatch)
    candidate = stage / 'app/worker/workflow.py'
    content = candidate.read_bytes()
    candidate.unlink()
    real = stage / 'elsewhere.py'
    real.write_bytes(content)
    try:
        candidate.symlink_to(real)
    except OSError:
        # Directory junctions are real Windows aliases and require no admin token.
        if os.name != 'nt':
            raise
        import _winapi
        directory = candidate.parent
        alternate = directory.with_name('worker-real')
        directory.rename(alternate)
        (alternate / candidate.name).write_bytes(content)
        _winapi.CreateJunction(str(alternate), str(directory))
    with pytest.raises(RuntimeError):
        run(True)
    assert all(Path(path).read_bytes() == content for path, content in originals.items())
