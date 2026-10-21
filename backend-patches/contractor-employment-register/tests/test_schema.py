from pathlib import Path
import json
from xml.etree import ElementTree as ET

import pytest
from rest_fixture import Transport, client, module


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv('CONTRACTOR_EMPLOYMENT_STATE_DIR', str(tmp_path))
    remote = Transport()
    del remote.fields['FUNCIONARIOSRH']
    del remote.items['FUNCIONARIOSRH']
    remote.fields['FORNECEDORES'] = [f for f in remote.fields['FORNECEDORES']
                                    if f['InternalName'] not in {'DATAADMISSAO', 'DATADESLIGAMENTO'}]
    return module('contractor_schema', Path(__file__).parents[1] / 'schema.py'), remote, client(remote)


def test_plan_is_read_only_and_clones_business_names_types(setup):
    schema, remote, sp = setup
    result = schema.provision(sp)
    assert result['applied'] is False
    assert result['actions']
    assert all(c[0] == 'GET' for c in remote.calls)
    assert 'FUNCIONARIOSRH' not in remote.fields


def test_restricted_source_acl_is_cloned_exactly_without_site_extra_recipients(setup):
    schema, remote, sp = setup
    remote.security['FORNECEDORES']['HasUniqueRoleAssignments'] = True
    remote.roles['FORNECEDORES'] = {11: {1073741829}, 22: {1073741826, 1073741827}}
    remote.page_size = 1
    assert schema.provision(sp)['applied'] is False
    assert all(c[0] == 'GET' for c in remote.calls)
    receipt = schema.provision(sp, apply=True)
    assert receipt['permissions_hash']
    assert remote.security['FUNCIONARIOSRH'] == remote.security['FORNECEDORES']
    assert remote.roles['FUNCIONARIOSRH'] == {11: {1073741829}, 22: {1073741826, 1073741827}}
    grants = [c for c in remote.calls if c[0] == 'POST' and '/addroleassignment(' in c[1]]
    assert len(grants) == 1 and all('principalid=99,' not in c[1] for c in grants)
    remote.calls.clear()
    assert schema.provision(sp, apply=True)['actions'] == []
    assert all(c[0] == 'GET' for c in remote.calls)


def test_partial_permission_failure_blocks_data_and_retries_without_extra_recipients(setup):
    schema, remote, sp = setup
    remote.security['FORNECEDORES']['HasUniqueRoleAssignments'] = True
    remote.roles['FORNECEDORES'][33] = {1073741826}
    remote.fail_grant = True
    with pytest.raises(PermissionError):
        schema.provision(sp, apply=True)
    assert remote.items['FUNCIONARIOSRH'] == {}
    assert not [c for c in remote.calls if c[0] == 'POST' and '/fields' in c[1]]
    sync = module('contractor_employment')
    remote.calls.clear()
    with pytest.raises((ValueError, PermissionError)):
        sync.sync_supplier(sp, 7)
    assert all(c[0] == 'GET' for c in remote.calls)
    remote.fail_grant = False
    schema.provision(sp, apply=True)
    assert remote.roles['FUNCIONARIOSRH'] == remote.roles['FORNECEDORES']


@pytest.mark.parametrize('setting', ['ReadSecurity', 'WriteSecurity'])
@pytest.mark.parametrize('unique', [False, True])
def test_own_item_security_is_preserved_but_data_copy_refuses_different_authorship(setup, setting, unique):
    schema, remote, sp = setup
    remote.security['FORNECEDORES'].update(HasUniqueRoleAssignments=unique, **{setting: 2})
    schema.provision(sp, apply=True)
    assert remote.security['FUNCIONARIOSRH'][setting] == 2
    sync = module('contractor_employment')
    remote.calls.clear()
    with pytest.raises(PermissionError):
        sync.sync_supplier(sp, 7)
    assert all(c[0] == 'GET' for c in remote.calls)


def test_acl_change_during_provisioning_never_returns_a_verified_receipt(setup, monkeypatch):
    schema, remote, sp = setup
    remote.security['FORNECEDORES']['HasUniqueRoleAssignments'] = True
    remote.roles['FORNECEDORES'][33] = {1073741826}
    request = remote.request
    def restrict_source_during_grant(method, url, **kwargs):
        result = request(method, url, **kwargs)
        if method == 'POST' and '/addroleassignment(' in url:
            remote.roles['FORNECEDORES'].pop(22, None)
        return result
    monkeypatch.setattr(remote, 'request', restrict_source_during_grant)
    with pytest.raises(PermissionError):
        schema.provision(sp, apply=True)
    assert remote.items['FUNCIONARIOSRH'] == {}


def test_existing_target_acl_loses_extra_role_bindings_and_extra_recipients(setup):
    schema, remote, sp = setup
    from rest_fixture import field
    remote.fields['FUNCIONARIOSRH'] = [field('Title')]
    remote.items['FUNCIONARIOSRH'] = {}
    remote.security['FORNECEDORES']['HasUniqueRoleAssignments'] = True
    remote.security['FUNCIONARIOSRH']['HasUniqueRoleAssignments'] = True
    remote.roles['FUNCIONARIOSRH'] = {11: {1073741829}, 22: {1073741826, 1073741829}, 88: {1073741826}}
    schema.provision(sp, apply=True)
    assert remote.roles['FUNCIONARIOSRH'] == {11: {1073741829}, 22: {1073741826}}
    acl_writes = [c for c in remote.calls if c[0] == 'POST' and '/roleassignments/' in c[1]]
    assert len(acl_writes) == 2
    assert all("GetByTitle('FUNCIONARIOSRH')" in c[1] and '/removeroleassignment(' in c[1] for c in acl_writes)


@pytest.mark.parametrize('setting,value', [('HasUniqueRoleAssignments', None), ('ReadSecurity', None), ('WriteSecurity', None)])
def test_unknown_source_security_metadata_refuses_any_mutation(setup, setting, value):
    schema, remote, sp = setup
    remote.security['FORNECEDORES'][setting] = value
    with pytest.raises(PermissionError):
        schema.provision(sp, apply=True)
    assert all(c[0] == 'GET' for c in remote.calls)


def test_missing_manage_permissions_is_reported_without_self_grant_or_data(setup, monkeypatch):
    schema, remote, sp = setup
    remote.security['FORNECEDORES']['HasUniqueRoleAssignments'] = True
    request = remote.request
    def deny_break(method, url, **kwargs):
        if method == 'POST' and '/breakroleinheritance(' in url:
            return remote.response(status=403)
        return request(method, url, **kwargs)
    monkeypatch.setattr(remote, 'request', deny_break)
    with pytest.raises(PermissionError, match='ManagePermissions'):
        schema.provision(sp, apply=True)
    assert remote.items['FUNCIONARIOSRH'] == {}
    assert not [c for c in remote.calls if c[0] == 'POST' and ('/roleassignments/' in c[1] or '/fields' in c[1])]


def test_accepted_but_unpersisted_grants_fail_equivalent_hash_verification(setup, monkeypatch):
    schema, remote, sp = setup
    remote.security['FORNECEDORES']['HasUniqueRoleAssignments'] = True
    remote.roles['FORNECEDORES'][33] = {1073741826}
    request = remote.request
    def drop_grants(method, url, **kwargs):
        if method == 'POST' and '/addroleassignment(' in url:
            return remote.response(status=204)
        return request(method, url, **kwargs)
    monkeypatch.setattr(remote, 'request', drop_grants)
    with pytest.raises(PermissionError):
        schema.provision(sp, apply=True)
    assert remote.items['FUNCIONARIOSRH'] == {}
    assert not [c for c in remote.calls if c[0] == 'POST' and '/fields' in c[1]]


def test_source_roleassignments_403_blocks_apply_before_list_or_data_creation(setup, monkeypatch):
    schema, remote, sp = setup
    remote.security['FORNECEDORES']['HasUniqueRoleAssignments'] = True
    request = remote.request
    def deny_source_acl_read(method, url, **kwargs):
        if method == 'GET' and url.endswith("GetByTitle('FORNECEDORES')/roleassignments"):
            return remote.response({'error': {'message': 'synthetic Forbidden'}}, status=403)
        return request(method, url, **kwargs)
    monkeypatch.setattr(remote, 'request', deny_source_acl_read)
    with pytest.raises(PermissionError):
        schema.provision(sp, apply=True)
    assert 'FUNCIONARIOSRH' not in remote.fields
    assert all(c[0] == 'GET' for c in remote.calls)


@pytest.mark.parametrize('successful_grants', [0, 1], ids=['first-grant-403', 'mid-grant-403'])
def test_acl_failure_never_introduces_caller_full_control_even_transiently(setup, successful_grants):
    schema, remote, sp = setup
    remote.security['FORNECEDORES']['HasUniqueRoleAssignments'] = True
    remote.roles['FORNECEDORES'] = {11: {1073741829}, 22: {1073741826},
                                    33: {1073741826}, 44: {1073741827}}
    remote.fail_grant_after = successful_grants
    with pytest.raises(PermissionError):
        schema.provision(sp, apply=True)
    assert remote.grant_attempts == successful_grants + 1
    assert remote.acl_history[0] == ('created', {
        11: {1073741829}, 22: {1073741826}, 99: {1073741827}})
    inherited = remote.acl_history[0][1]
    assert next(roles for step, roles in remote.acl_history if step == 'inheritance_broken') == inherited
    inherited_pairs = {(p, role) for p, roles in inherited.items() for role in roles}
    authorized_pairs = {(p, role) for p, roles in remote.roles['FORNECEDORES'].items() for role in roles}
    assert all({(p, role) for p, bindings in roles.items() for role in bindings} - inherited_pairs
               <= authorized_pairs for _, roles in remote.acl_history)
    assert all(1073741829 not in roles.get(99, set()) for _, roles in remote.acl_history)
    assert remote.roles['FUNCIONARIOSRH'][99] == {1073741827}
    assert remote.items['FUNCIONARIOSRH'] == {}
    assert not [c for c in remote.calls if c[0] == 'POST' and '/fields' in c[1]]
    grants = [c for c in remote.calls if c[0] == 'POST' and '/addroleassignment(' in c[1]]
    assert all('principalid=99,' not in c[1] for c in grants)
    remote.fail_grant_after = None
    receipt = schema.provision(sp, apply=True)
    assert receipt['permissions_hash']
    assert remote.roles['FUNCIONARIOSRH'] == remote.roles['FORNECEDORES']
    assert all(1073741829 not in roles.get(99, set()) for _, roles in remote.acl_history)
    remote.calls.clear()
    assert schema.provision(sp, apply=True)['actions'] == []
    assert all(c[0] == 'GET' for c in remote.calls)


def test_apply_clones_source_and_audit_additions_without_duplicate_list(setup):
    schema, remote, sp = setup
    schema.provision(sp, apply=True)
    fields = {f['InternalName']: f for f in remote.fields['FUNCIONARIOSRH']}
    assert fields['Title']['Title'] == 'CADASTRO'
    assert fields['field_6']['TypeAsString'] == 'Number'
    assert fields['DATANASCIMENTO']['TypeAsString'] == 'DateTime'
    assert fields['CARGO']['TypeAsString'] == fields['VINCULO']['TypeAsString'] == 'Text'
    assert fields['IDFORNECEDORORIGEM']['EnforceUniqueValues'] is True
    assert fields['IDFORNECEDORORIGEM']['Indexed'] is True
    assert fields['ORIGEMSNAPSHOTJSON']['TypeAsString'] == 'Note'
    assert 'Author' not in fields and 'ContentType' not in fields
    for title in ['FORNECEDORES', 'FUNCIONARIOSRH']:
        for name in ['DATAADMISSAO', 'DATADESLIGAMENTO']:
            date = next(f for f in remote.fields[title] if f['InternalName'] == name)
            assert ET.fromstring(date['SchemaXml']).attrib['Format'] == 'DateOnly'
    assert schema.provision(sp, apply=True)['actions'] == []
    assert len([c for c in remote.calls if c[0] == 'POST' and c[1].endswith('/web/lists')]) == 1


def test_lost_list_creation_response_reconciles_before_retry(setup):
    schema, remote, sp = setup
    remote.lost_list = True
    schema.provision(sp, apply=True)
    schema.provision(sp, apply=True)
    assert len([c for c in remote.calls if c[0] == 'POST' and c[1].endswith('/web/lists')]) == 1


@pytest.mark.parametrize('name,change', [('CARGO', {'TypeAsString': 'Number'}),
    ('IDFORNECEDORORIGEM', {'EnforceUniqueValues': False}),
    ('DATAADMISSAO', {'SchemaXml': '<Field Type="DateTime" Format="DateTime" />'})])
def test_conflicting_existing_schema_fails_before_mutation(setup, name, change):
    schema, remote, sp = setup
    remote.fields['FUNCIONARIOSRH'] = [dict(f) for f in remote.fields['FORNECEDORES']]
    from rest_fixture import field
    remote.fields['FUNCIONARIOSRH'].extend([field('IDFORNECEDORORIGEM', Indexed=True, EnforceUniqueValues=True), field('DATAADMISSAO', 'DateTime')])
    next(f for f in remote.fields['FUNCIONARIOSRH'] if f['InternalName'] == name).update(change)
    with pytest.raises(ValueError):
        schema.provision(sp, apply=True)
    assert not [c for c in remote.calls if c[0] != 'GET']


def test_invisible_uncertain_list_create_never_posts_again_on_retry(setup):
    schema, remote, sp = setup
    remote.lost_list, remote.hide_list = True, True
    with pytest.raises(RuntimeError):
        schema.provision(sp, apply=True)
    with pytest.raises(RuntimeError):
        schema.provision(client(remote), apply=True)
    creates = [c for c in remote.calls if c[0] == 'POST' and c[1].endswith('/web/lists')]
    assert len(creates) == 1
    remote.hide_list = False
    assert schema.provision(sp, apply=True)['applied'] is True


def test_schema_cli_defaults_to_remote_reads_and_only_explicit_apply_mutates(setup, monkeypatch, capsys):
    schema, remote, sp = setup
    cli = module('sync_contractors')
    monkeypatch.setattr(cli, 'client_from_environment', lambda: sp)
    assert schema.main([]) == 0
    assert json.loads(capsys.readouterr().out)['applied'] is False
    assert not [c for c in remote.calls if c[0] != 'GET']
    assert schema.main(['--apply']) == 0
    assert json.loads(capsys.readouterr().out)['applied'] is True
    assert 'FUNCIONARIOSRH' in remote.fields
