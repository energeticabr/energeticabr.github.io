import hashlib
import importlib.util
import json
import shutil
import subprocess
import io
import tarfile
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def setup(tmp_path, monkeypatch, configuration=b'{"value": 2, "enabled": true, "default": null}\n'):
    deploy = load('launch_unit_deploy_test', ROOT / 'deploy.py')
    package = load('launch_unit_package_test', ROOT / 'package.py')
    roots = (tmp_path / 'production', tmp_path / 'mirror')
    before = tmp_path / 'before'
    after = tmp_path / 'after'
    stage = tmp_path / 'stage'
    mirror_hashes = {}
    for relative in deploy.FILES:
        final = after / relative
        final.parent.mkdir(parents=True, exist_ok=True)
        final.write_bytes(configuration if final.suffix == '.json' else b'VALUE = 2\n')
        if relative not in deploy.NEW_HELPERS:
            for directory in (*roots, before):
                path = directory / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'{"value": 1, "enabled": false, "default": null}\n'
                                 if path.suffix == '.json' else b'VALUE = 1\n')
            mirror_hashes[relative] = deploy.digest(roots[1] / relative)
        else:
            mirror_hashes[relative] = None
    package.package(before, after, stage, mirror_hashes)
    monkeypatch.setattr(deploy, 'ROOTS', roots)
    monkeypatch.setattr(deploy, 'STAGE', stage)
    monkeypatch.setattr(deploy, 'BACKUPS', tmp_path / 'backups', raising=False)
    deploy.BACKUPS.mkdir()
    return deploy, package, roots, stage


def test_assemble_exact_hashes_and_json_configuration(tmp_path, monkeypatch):
    deploy, package, roots, stage = setup(tmp_path, monkeypatch)
    manifest = deploy.checked_manifest(deploy.digest(stage / 'deploy-manifest.json'))
    candidate = deploy.assemble(manifest)
    assert all(deploy.digest(candidate / relative) == manifest['files'][relative]['after'] for relative in deploy.FILES)
    assert deploy.assemble(manifest) == candidate
    assert (candidate / 'worker/workflow.py').read_text() == 'VALUE = 2\n'
    assert (roots[0] / 'worker/workflow.py').read_text() == 'VALUE = 1\n'


def test_assemble_requires_no_system_git_or_patch(tmp_path, monkeypatch):
    deploy, package, roots, stage = setup(tmp_path, monkeypatch)
    def no_external_tools(*args, **kwargs):
        raise AssertionError('Assembler must not depend on system git/patch')
    monkeypatch.setattr(subprocess, 'run', no_external_tools)
    manifest = deploy.checked_manifest(deploy.digest(stage / 'deploy-manifest.json'))
    candidate = deploy.assemble(manifest)
    assert all(deploy.digest(candidate / relative) == manifest['files'][relative]['after'] for relative in deploy.FILES)


def test_cached_assembly_compiles_only_python_sources(tmp_path, monkeypatch):
    deploy, package, roots, stage = setup(tmp_path, monkeypatch)
    manifest = deploy.checked_manifest(deploy.digest(stage / 'deploy-manifest.json'))
    candidate = deploy.assemble(manifest)
    compiled = []
    original_compile = deploy.py_compile.compile
    def checked_compile(path, **kwargs):
        compiled.append(Path(path).relative_to(candidate).as_posix())
        return original_compile(path, **kwargs)
    monkeypatch.setattr(deploy.py_compile, 'compile', checked_compile)
    assert deploy.assemble(manifest) == candidate
    assert compiled == ['worker/workflow.py']


def test_scoped_files_stage_and_shared_runner_pin():
    deploy = load('launch_unit_deploy_scope_test', ROOT / 'deploy.py')
    package = load('launch_unit_package_scope_test', ROOT / 'package.py')
    expected = ('worker/workflow.py',)
    assert deploy.FILES == package.FILES == expected
    assert deploy.NEW_HELPERS == ()
    assert deploy.STAGE.as_posix() == '/home/opc/provision-contractor-payroll-20261029/package'
    assert deploy.SHARED_RUNNER_SHA == '01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2'


def test_wrong_manifest_or_source_hash_fails_closed(tmp_path, monkeypatch):
    deploy, package, roots, stage = setup(tmp_path, monkeypatch)
    with pytest.raises(RuntimeError, match='Manifest hash'):
        deploy.checked_manifest('incorrect')
    (stage / 'source.patch').write_text('tampered')
    with pytest.raises(RuntimeError, match='Source patch'):
        deploy.checked_manifest(deploy.digest(stage / 'deploy-manifest.json'))


def test_private_bundle_hash_and_member_paths_are_checked(tmp_path, monkeypatch):
    deploy, package, roots, stage = setup(tmp_path, monkeypatch)
    archive_path = stage / 'source-files.tar'
    archive_path.write_bytes(b'tampered')
    with pytest.raises(RuntimeError, match='bundle mismatch'):
        deploy.checked_manifest(deploy.digest(stage / 'deploy-manifest.json'))
    with tarfile.open(archive_path, 'w') as archive:
        for relative in deploy.FILES:
            info = tarfile.TarInfo('../outside.py' if relative == deploy.FILES[0] else relative)
            info.size = 1
            archive.addfile(info, io.BytesIO(b'x'))
    path = stage / 'deploy-manifest.json'
    manifest = json.loads(path.read_text())
    manifest['archive'] = deploy.digest(archive_path)
    path.write_text(json.dumps(manifest))
    checked = deploy.checked_manifest(deploy.digest(path))
    with pytest.raises(RuntimeError, match='scope mismatch'):
        deploy.assemble(checked)
    assert not (stage / 'candidate').exists()
    assert not (stage / 'outside.py').exists()


def test_drift_in_either_root_is_refused(tmp_path, monkeypatch):
    deploy, package, roots, stage = setup(tmp_path, monkeypatch)
    (roots[1] / deploy.FILES[0]).write_text('foreign change')
    with pytest.raises(RuntimeError, match='Source drift'):
        deploy.checked_manifest(deploy.digest(stage / 'deploy-manifest.json'))


def test_unknown_manifest_paths_are_refused(tmp_path, monkeypatch):
    deploy, package, roots, stage = setup(tmp_path, monkeypatch)
    path = stage / 'deploy-manifest.json'
    manifest = json.loads(path.read_text())
    manifest['files']['../credentials.env'] = {'before': None, 'after': 'bad'}
    path.write_text(json.dumps(manifest))
    with pytest.raises(RuntimeError, match='scope'):
        deploy.checked_manifest(deploy.digest(path))


def test_failed_restart_restores_each_root_and_removes_only_owned_helpers(tmp_path, monkeypatch):
    deploy, package, roots, stage = setup(tmp_path, monkeypatch)
    manifest = deploy.checked_manifest(deploy.digest(stage / 'deploy-manifest.json'))
    candidate = deploy.assemble(manifest)
    count = [0]
    def restart():
        count[0] += 1
        if count[0] == 1:
            raise RuntimeError('synthetic restart failure')
    runner = SimpleNamespace(health=lambda: {'status': 'ok'}, wait_health=lambda: {'status': 'ok'},
                             restart=restart, atomic_copy=lambda source, target, attributes=None: shutil.copyfile(source, target))
    with pytest.raises(RuntimeError, match='synthetic'):
        deploy.rollout(manifest, candidate, runner)
    for root in roots:
        for relative in deploy.FILES:
            assert deploy.digest(root / relative) == manifest['files'][relative]['before']
    assert count[0] == 2
    receipts = list(deploy.BACKUPS.glob('provision-contractor-payroll-*/receipt.json'))
    assert len(receipts) == 1
    assert json.loads(receipts[0].read_text()) == {'status': 'rolled_back', 'errors': []}


def test_rollback_preserves_concurrent_source_changes(tmp_path, monkeypatch):
    deploy, package, roots, stage = setup(tmp_path, monkeypatch)
    manifest = deploy.checked_manifest(deploy.digest(stage / 'deploy-manifest.json'))
    candidate = deploy.assemble(manifest)
    foreign_target = roots[0] / 'worker/workflow.py'
    count = [0]

    def restart():
        count[0] += 1
        if count[0] == 1:
            foreign_target.write_bytes(b'{"foreign": true}\n')
            raise RuntimeError('synthetic concurrent change')

    runner = SimpleNamespace(health=lambda: {'status': 'ok'}, wait_health=lambda: {'status': 'ok'},
                             restart=restart, atomic_copy=lambda source, target, attributes=None: shutil.copyfile(source, target))
    with pytest.raises(RuntimeError, match='synthetic concurrent change'):
        deploy.rollout(manifest, candidate, runner)
    assert foreign_target.read_bytes() == b'{"foreign": true}\n'
    for root in roots:
        for relative in deploy.FILES:
            target = root / relative
            if target != foreign_target:
                assert deploy.digest(target) == manifest['files'][relative]['before']
    receipt = json.loads(next(deploy.BACKUPS.glob('*/receipt.json')).read_text())
    assert receipt['status'] == 'rollback_incomplete'
    assert any('Concurrent source change preserved' in error for error in receipt['errors'])


def test_successful_rollout_installs_every_pinned_file_in_both_roots(tmp_path, monkeypatch):
    deploy, package, roots, stage = setup(tmp_path, monkeypatch)
    manifest = deploy.checked_manifest(deploy.digest(stage / 'deploy-manifest.json'))
    candidate = deploy.assemble(manifest)
    runner = SimpleNamespace(health=lambda: {'status': 'ok'}, wait_health=lambda: {'status': 'ok'},
                             restart=lambda: None, atomic_copy=lambda source, target, attributes=None: shutil.copyfile(source, target))
    result = deploy.rollout(manifest, candidate, runner)
    assert result['status'] == 'deployed'
    assert Path(result['backup']).name.startswith('provision-contractor-payroll-')
    assert json.loads((Path(result['backup']) / 'receipt.json').read_text()) == result
    for root in roots:
        for relative in deploy.FILES:
            assert deploy.digest(root / relative) == manifest['files'][relative]['after']


def test_check_only_does_not_write_live_sources(tmp_path, monkeypatch):
    deploy, package, roots, stage = setup(tmp_path, monkeypatch)
    manifest = deploy.checked_manifest(deploy.digest(stage / 'deploy-manifest.json'))
    candidate = deploy.assemble(manifest)
    runner = SimpleNamespace(health=lambda: {'status': 'ok'})
    result = deploy.rollout(manifest, candidate, runner, check_only=True)
    assert result['status'] == 'checked'
    assert (roots[0] / 'worker/workflow.py').read_text() == 'VALUE = 1\n'
