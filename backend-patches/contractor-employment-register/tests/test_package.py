"""Surgical adaptation and reproduction guards on the actual captured variants."""
import ast
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil

import pytest

HERE = Path(__file__).resolve().parents[1]
PRIVATE = Path(os.environ['ENERGETICA_PRIVATE_OUTPUT'])


def builder():
    spec = importlib.util.spec_from_file_location('employment_package_test', HERE / 'package.py')
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


@pytest.fixture
def legacy_path_write_text(monkeypatch):
    """Exercise the service Python 3.9 Path API on newer local interpreters."""
    original = Path.write_text

    def write_text(path, data, encoding=None, errors=None):
        return original(path, data, encoding=encoding, errors=errors)

    monkeypatch.setattr(Path, 'write_text', write_text)


def test_output_alias_is_rejected_before_any_generated_write(tmp_path, monkeypatch):
    output = tmp_path / 'stage'
    original = Path.is_symlink
    monkeypatch.setattr(Path, 'is_symlink', lambda self: self == output / 'source.patch' or original(self))
    with pytest.raises(RuntimeError, match='alias'):
        builder().package(PRIVATE / 'live', output)
    assert not output.exists()


def test_repeated_build_produces_the_same_eight_targets_diff_and_manifest(tmp_path, legacy_path_write_text):
    package = builder()
    first, second = tmp_path / 'first', tmp_path / 'second'
    manifest = package.package(PRIVATE / 'live', first)
    assert package.package(PRIVATE / 'live', second) == manifest
    assert len(manifest['files']) == 8
    assert {entry['candidate'] for entry in manifest['files']} == {
        scope + '/worker/' + name for scope in ('app', 'build') for name in (
            'workflow.py', 'workflow_config.json', 'contractor_employment.py', 'supplier_registration_checkpoint.py')}
    for path in first.rglob('*'):
        if path.is_file():
            assert path.read_bytes() == (second / path.relative_to(first)).read_bytes()
    assert (first / 'app/worker/workflow.py').read_bytes() != (first / 'build/worker/workflow.py').read_bytes()


def test_private_stage_includes_reviewed_installer_and_only_its_two_code_dependencies(tmp_path, legacy_path_write_text):
    package = builder()
    output = tmp_path / 'stage'
    manifest = package.package(PRIVATE / 'live', output)
    assert (output / 'deploy.py').is_file(), 'Private deployment stage must be directly runnable'
    assert (output / 'deploy.py').read_bytes() == (HERE / 'deploy.py').read_bytes()
    expected_helpers = {'deploy_context.py': 'cbf8f8434b00e7aaa5c148dec2c8c09f3b4aef734d0ea711e8fcce42370bca51',
        'patch_presence_context.py': 'e7ba490d03e70171d12afcd8f76713ccbaab65b7ec77b2f9464cf753b6d5aaa6'}
    for name, expected in expected_helpers.items():
        assert package.digest((output / 'deployment_helpers' / name).read_bytes()) == expected
    assert {path.relative_to(output).as_posix() for path in output.rglob('*') if path.is_file()} == {
        *[entry['candidate'] for entry in manifest['files']], 'source.patch', 'deploy-manifest.json', 'deploy.py',
        'deployment_helpers/deploy_context.py', 'deployment_helpers/patch_presence_context.py'}


@pytest.mark.parametrize('name', ['workflow-app.py', 'workflow.py', 'workflow_config.json'])
def test_either_captured_variant_or_config_drift_aborts_before_output(tmp_path, name):
    capture = tmp_path / 'live'
    capture.mkdir()
    for filename in ['workflow-app.py', 'workflow.py', 'workflow_config.json']:
        shutil.copyfile(PRIVATE / 'live' / filename, capture / filename)
    (capture / name).write_bytes((capture / name).read_bytes() + b'\n')
    with pytest.raises(RuntimeError, match='hash drift'):
        builder().package(capture, tmp_path / 'stage')
    assert not (tmp_path / 'stage').exists()


@pytest.mark.parametrize(('scope', 'filename'), [('app', 'workflow-app.py'), ('build', 'workflow.py')])
def test_only_reviewed_workflow_methods_change_and_every_other_method_survives(scope, filename):
    original = ast.parse((PRIVATE / 'live' / filename).read_text(encoding='utf-8'))
    candidate = ast.parse((PRIVATE / 'task2-candidates' / scope / 'worker/workflow.py').read_text(encoding='utf-8'))
    def methods(tree):
        engine = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'WorkflowEngine')
        return {node.name: ast.dump(node, include_attributes=False) for node in engine.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
    before, after = methods(original), methods(candidate)
    changed = {key for key in before if before[key] != after.get(key)}
    assert changed == {'_begin_action', '_attachment_total_or_request_reupload', '_migrate_supplier_employment_steps',
        '_supplier_employment_review', '_start_embedded_launch_registration', '_new_submission_identity', '_commit'}
    assert set(after) - set(before) == {'_start_supplier_hr_cutover', '_reassociate_supplier_hr_files'}
    assert set(before) <= set(after)


@pytest.mark.parametrize('scope', ['app', 'build'])
def test_config_changes_are_limited_to_role_and_admission_and_preserve_binary_menus(scope):
    original = json.loads((PRIVATE / 'live/workflow_config.json').read_text(encoding='utf-8'))
    candidate = json.loads((PRIVATE / 'task2-candidates' / scope / 'worker/workflow_config.json').read_text(encoding='utf-8'))
    before = copy.deepcopy(original['sharepoint']['supply_supplier_registration_flow'])
    after = copy.deepcopy(candidate['sharepoint']['supply_supplier_registration_flow'])
    assert {step['key']: step for step in before['steps'] if step['key'] in {
        'homologacao_fornecedor_suprimentos', 'whatsapp_fornecedor_suprimentos'}} == {
        step['key']: step for step in after['steps'] if step['key'] in {
        'homologacao_fornecedor_suprimentos', 'whatsapp_fornecedor_suprimentos'}}
    def without_feature(flow):
        for key, value in list(flow.items()):
            if isinstance(value, list):
                flow[key] = [item for item in value if not (isinstance(item, dict) and (
                    item.get('key') in {'cargo_fornecedor_suprimentos', 'admissao_fornecedor_suprimentos'}
                    or item.get('field') in {'CARGO', 'DATAADMISSAO'}))]
        return flow
    assert without_feature(before) == without_feature(after)
    original['sharepoint'].pop('supply_supplier_registration_flow')
    candidate['sharepoint'].pop('supply_supplier_registration_flow')
    assert original == candidate


@pytest.mark.parametrize(('name', 'source'), [('test_current_homologation.py', 'supplier-homologation-binary/test_homologation.py'),
    ('test_current_whatsapp.py', 'supplier-whatsapp-binary/test_whatsapp.py')])
def test_current_binary_regression_fixtures_change_only_the_session_version(name, source):
    original = (HERE.parent / source).read_text(encoding='utf-8')
    assert (HERE / 'tests' / name).read_text(encoding='utf-8') == original.replace(
        'supplier_employment_version=1', 'supplier_employment_version=2')
