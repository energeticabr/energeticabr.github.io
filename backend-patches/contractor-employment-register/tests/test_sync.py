"""Behavioral contracts: real client, synthetic REST, no remote calls or real data."""
import copy
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
from rest_fixture import ROOT, Transport, client, module


@pytest.fixture
def setup(tmp_path):
    transport = Transport()
    return module('contractor_employment'), transport, client(transport), SimpleNamespace(directory=tmp_path)


def test_mirrors_types_audit_expanded_users_attachments_and_empty_dates(setup):
    sync, remote, sp, store = setup
    result = sync.sync_supplier(sp, 7, state_store=store)
    assert result['status'] == 'synced'
    row = remote.items['FUNCIONARIOSRH'][result['target_id']]
    assert row['IDFORNECEDORORIGEM'] == '7'
    assert row['Title'] == 'SYNTHETIC 7'
    assert row['field_6'] == 123.5
    assert row['DATANASCIMENTO'] == '1990-01-02T03:00:00Z'
    assert row['DATAADMISSAO'] is None and row['CARGO'] is None
    assert row['EXTRA'] == 'legacy untouched'
    assert row['RESPONSAVELId'] == 12
    assert row['EQUIPEId'] == {'results': [12, 13]}
    assert row['ORIGEMCRIADOEM'] == '2024-01-01T12:00:00Z'
    assert json.loads(row['ORIGEMAUTORJSON'])['Id'] == 11
    assert json.loads(row['ORIGEMEDITORJSON'])['Id'] == 12
    assert json.loads(row['ORIGEMSNAPSHOTJSON'])['Author']['Title'] == 'SYNTHETIC AUTHOR'
    assert not {'Author', 'Editor', 'Created', 'Modified', 'Attachments', 'ContentTypeId'} & row.keys()
    assert remote.files[('FUNCIONARIOSRH', result['target_id'])] == {"synthetic's.pdf": b'SYNTHETIC BYTES'}
    original = copy.deepcopy(remote.items['FORNECEDORES'])
    sync.sync_supplier(sp, 7, state_store=store)
    assert len(remote.items['FUNCIONARIOSRH']) == 1
    assert remote.items['FORNECEDORES'] == original
    assert len([c for c in remote.calls if c[0] == 'POST' and '/add(' in c[1]]) == 1


@pytest.mark.parametrize('flag,status', [('NÃO','ATIVO'), ('SIM','INATIVO'), ('SIM',''), ('','ATIVO')])
def test_does_not_create_untracked_ineligible_rows(setup, flag, status):
    sync, remote, sp, store = setup
    remote.items['FORNECEDORES'][7].update(EMPREITEIRO=flag, STATUS=status)
    assert sync.sync_supplier(sp, 7, state_store=store)['status'] == 'skipped'
    assert remote.items['FUNCIONARIOSRH'] == {}


def test_fetches_latest_source_and_retains_tracked_inactive_history(setup):
    sync, remote, sp, store = setup
    target_id = sync.sync_supplier(sp, 7, state_store=store)['target_id']
    remote.items['FORNECEDORES'][7].update(STATUS='INATIVO', DATAADMISSAO='2026-10-01T03:00:00Z',
                                          DATADESLIGAMENTO='2026-10-20T03:00:00Z', EXTRA='updated')
    sync.sync_supplier(sp, 7, state_store=store)
    row = remote.items['FUNCIONARIOSRH'][target_id]
    assert row['STATUS'] == 'INATIVO'
    assert row['DATADESLIGAMENTO'] == '2026-10-20T03:00:00Z'
    assert row['EXTRA'] == 'updated'
    assert len(remote.items['FUNCIONARIOSRH']) == 1


def test_lost_post_reconciles_same_row(setup):
    sync, remote, sp, store = setup
    remote.lost_create = True
    assert sync.sync_supplier(sp, 7, state_store=store)['status'] == 'synced'
    assert len(remote.items['FUNCIONARIOSRH']) == 1


def test_uncertain_create_checkpoint_survives_retry_without_second_post(setup):
    sync, remote, sp, store = setup
    remote.lost_create, remote.hide_target = True, True
    with pytest.raises(RuntimeError):
        sync.sync_supplier(sp, 7, state_store=store)
    with pytest.raises(RuntimeError):
        sync.sync_supplier(client(remote), 7, state_store=SimpleNamespace(directory=store.directory))
    creates = [c for c in remote.calls if c[0] == 'POST' and c[1].endswith('/items')]
    assert len(creates) == 1
    remote.hide_target = False
    assert sync.sync_supplier(sp, 7, state_store=store)['status'] == 'synced'
    assert len(remote.items['FUNCIONARIOSRH']) == 1


def test_duplicate_unique_constraint_is_rejected_before_write(setup):
    sync, remote, sp, store = setup
    key = next(f for f in remote.fields['FUNCIONARIOSRH'] if f['InternalName'] == 'IDFORNECEDORORIGEM')
    key['EnforceUniqueValues'] = False
    with pytest.raises(ValueError):
        sync.sync_supplier(sp, 7, state_store=store)
    assert not [c for c in remote.calls if c[0] != 'GET']


def test_partial_attachment_failure_is_explicit_and_retry_reuses_row(setup):
    sync, remote, sp, store = setup
    remote.fail_attachment = True
    with pytest.raises(Exception):
        sync.sync_supplier(sp, 7, state_store=store)
    remote.fail_attachment = False
    result = sync.sync_supplier(sp, 7, state_store=store)
    assert len(remote.items['FUNCIONARIOSRH']) == 1
    assert remote.files[('FUNCIONARIOSRH', result['target_id'])]["synthetic's.pdf"] == b'SYNTHETIC BYTES'


def test_update_is_verified_before_success(setup):
    sync, remote, sp, store = setup
    sync.sync_supplier(sp, 7, state_store=store)
    remote.items['FORNECEDORES'][7]['EXTRA'] = 'changed'
    remote.drop_merge = True
    with pytest.raises(RuntimeError):
        sync.sync_supplier(sp, 7, state_store=store)


def test_shared_directory_serializes_clients_without_duplicate_create(setup):
    sync, remote, sp, store = setup
    remote.delay_create = True
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: sync.sync_supplier(client(remote), 7,
            state_store=SimpleNamespace(directory=store.directory)), range(2)))
    assert all(r['status'] == 'synced' for r in results)
    assert len([c for c in remote.calls if c[0] == 'POST' and c[1].endswith('/items')]) == 1


def test_sync_all_paginates_and_reports_counts_without_personal_data(setup):
    sync, remote, sp, store = setup
    remote.page_size = 1
    remote.items['FORNECEDORES'][8] = {**remote.items['FORNECEDORES'][7], 'Id': 8, 'Title': 'SYNTHETIC 8', 'EMPREITEIRO': 'NÃO'}
    remote.items['FORNECEDORES'][9] = {**remote.items['FORNECEDORES'][7], 'Id': 9, 'Title': 'SYNTHETIC 9'}
    result = sync.sync_all(sp, state_store=store)
    assert result == {'processed': 3, 'synced': 2, 'skipped': 1, 'errors': 0}
    assert len(remote.items['FUNCIONARIOSRH']) == 2


def test_pagination_refuses_same_prefix_outside_site(setup):
    sync, remote, sp, store = setup
    remote.next_override = 'https://synthetic.invalid/sites/synthetic-evil/_api/web/lists/GetByTitle(\'FORNECEDORES\')/items'
    with pytest.raises(ValueError):
        sync.sync_all(sp, state_store=store)
    assert all('synthetic-evil' not in c[1] for c in remote.calls)


def test_multivalue_nometadata_array_response_verifies_and_retries_without_merge(setup):
    sync, remote, sp, store = setup
    remote.multi_as_array = True
    assert sync.sync_supplier(sp, 7, state_store=store)['status'] == 'synced'
    remote.calls.clear()
    sync.sync_supplier(sp, 7, state_store=store)
    assert not [c for c in remote.calls if c[0] == 'POST']


def test_missing_expanded_business_user_is_not_silently_cleared(setup):
    sync, remote, sp, store = setup
    del remote.items['FORNECEDORES'][7]['RESPONSAVEL']
    with pytest.raises(ValueError):
        sync.sync_supplier(sp, 7, state_store=store)
    assert not [c for c in remote.calls if c[0] == 'POST']


@pytest.mark.parametrize('invalid', [True, 0, -1, '7/8', '7.0', None])
def test_invalid_source_id_is_rejected_without_rest(setup, invalid):
    sync, remote, sp, store = setup
    with pytest.raises(ValueError):
        sync.sync_supplier(sp, invalid, state_store=store)
    assert remote.calls == []


def test_duplicate_target_identity_is_explicit_and_never_merged(setup):
    sync, remote, sp, store = setup
    remote.items['FUNCIONARIOSRH'] = {101: {'Id': 101, 'IDFORNECEDORORIGEM': '7'},
                                     102: {'Id': 102, 'IDFORNECEDORORIGEM': '7'}}
    with pytest.raises(RuntimeError):
        sync.sync_supplier(sp, 7, state_store=store)
    assert not [c for c in remote.calls if c[0] == 'POST']


def test_sync_all_counts_failure_and_continues_without_leaking_fields(setup):
    sync, remote, sp, store = setup
    remote.fail_attachment = True
    remote.items['FORNECEDORES'][8] = {**remote.items['FORNECEDORES'][7], 'Id': 8}
    assert sync.sync_all(sp, state_store=store) == {'processed': 2, 'synced': 1, 'skipped': 0, 'errors': 1}


def test_default_state_directory_is_persistent_env_not_private_tmp(setup, monkeypatch):
    sync, remote, sp, store = setup
    monkeypatch.setenv('CONTRACTOR_EMPLOYMENT_STATE_DIR', str(store.directory))
    assert sync.sync_supplier(sp, 7)['status'] == 'synced'
    assert list(store.directory.rglob('7.json'))


def test_corrupt_checkpoint_never_allows_a_post(setup):
    sync, remote, sp, store = setup
    sync.sync_supplier(sp, 7, state_store=store)
    path = next(store.directory.rglob('7.json'))
    path.write_text('{"phase":"invalid"}', encoding='utf-8')
    remote.calls.clear()
    with pytest.raises(RuntimeError):
        sync.sync_supplier(sp, 7, state_store=store)
    assert not [c for c in remote.calls if c[0] == 'POST']


def test_timer_requires_shared_directory_before_constructing_client(setup, monkeypatch, capsys):
    _, remote, sp, store = setup
    cli = module('sync_contractors')
    monkeypatch.delenv('CONTRACTOR_EMPLOYMENT_STATE_DIR', raising=False)
    def unexpected_client():
        pytest.fail('Timer must reject missing shared directory before reading credentials')
    monkeypatch.setattr(cli, 'client_from_environment', unexpected_client)
    assert cli.main([]) == 1
    assert json.loads(capsys.readouterr().out) == {'status': 'error', 'type': 'ValueError'}
    assert remote.calls == []


def test_timer_processes_full_population_and_exits_nonzero_for_partial_failure(setup, monkeypatch, capsys):
    _, remote, sp, store = setup
    cli = module('sync_contractors')
    monkeypatch.setattr(cli, 'client_from_environment', lambda: sp)
    remote.fail_attachment = True
    remote.items['FORNECEDORES'][8] = {**remote.items['FORNECEDORES'][7], 'Id': 8}
    assert cli.main(['--state-directory', str(store.directory)]) == 1
    assert json.loads(capsys.readouterr().out) == {'processed': 2, 'synced': 1, 'skipped': 0, 'errors': 1}
    assert len(remote.items['FUNCIONARIOSRH']) == 2


def test_real_local_state_store_restart_preserves_sessions_and_blank_inactive_dates(setup):
    sync, remote, sp, synthetic_store = setup
    boot = module('boot_local_app', ROOT / 'local_app.py')
    directory = synthetic_store.directory / 'state'
    state = boot.LocalStateStore(directory)
    state.save('synthetic-session', {'synthetic': True}, None)
    target_id = sync.sync_supplier(sp, 7, state_store=state)['target_id']
    remote.items['FORNECEDORES'][7]['STATUS'] = 'INATIVO'
    restarted = boot.LocalStateStore(directory)
    assert sync.sync_supplier(sp, 7, state_store=restarted)['target_id'] == target_id
    sessions = list(restarted.iter_states())
    assert len(sessions) == 1 and sessions[0][0] == {'synthetic': True}
    row = remote.items['FUNCIONARIOSRH'][target_id]
    assert row['STATUS'] == 'INATIVO'
    assert row['DATAADMISSAO'] is None and row['DATADESLIGAMENTO'] is None and row['CARGO'] is None
    assert len(list(directory.glob('contractor-employment-register/*/7.json'))) == 1
    assert len([c for c in remote.calls if c[0] == 'POST' and c[1].endswith('/items')]) == 1


def test_batch_paginates_both_lists_and_only_fetches_active_or_tracked_candidates(setup):
    sync, remote, sp, store = setup
    for source_id in range(8, 12):
        remote.items['FORNECEDORES'][source_id] = {**remote.items['FORNECEDORES'][7],
            'Id': source_id, 'Title': f'SYNTHETIC {source_id}'}
    target_8 = sync.sync_supplier(sp, 8, state_store=store)['target_id']
    target_9 = sync.sync_supplier(sp, 9, state_store=store)['target_id']
    remote.items['FORNECEDORES'][8].update(STATUS='INATIVO', DATADESLIGAMENTO='2026-10-20T03:00:00Z')
    remote.items['FORNECEDORES'][9]['EMPREITEIRO'] = 'NÃO'
    remote.items['FORNECEDORES'][10]['EMPREITEIRO'] = 'NÃO'
    remote.items['FORNECEDORES'][11]['STATUS'] = 'INATIVO'
    remote.page_size = 1
    remote.calls.clear()
    assert sync.sync_all(sp, state_store=store) == {
        'processed': 5, 'synced': 3, 'skipped': 2, 'errors': 0}
    source_reads = [c for c in remote.calls
                    if c[0] == 'GET' and "GetByTitle('FORNECEDORES')/items(" in c[1]
                    and urlsplit(c[1]).path.endswith(')')]
    snapshots = [c for c in source_reads if (c[2].get('params') or {}).get('$select', '').startswith('*')]
    guards = [c for c in source_reads if (c[2].get('params') or {}).get('$select') == 'Id,Modified,HasUniqueRoleAssignments']
    assert [urlsplit(c[1]).path for c in snapshots] == [
        "/sites/synthetic/_api/web/lists/GetByTitle('FORNECEDORES')/items(7)",
        "/sites/synthetic/_api/web/lists/GetByTitle('FORNECEDORES')/items(8)",
        "/sites/synthetic/_api/web/lists/GetByTitle('FORNECEDORES')/items(9)"]
    assert len(source_reads) == len(snapshots) + len(guards)
    assert all(any(c[1].endswith(f'/items({source_id})') for source_id in (7, 8, 9)) for c in guards)
    for source_id in (7, 8, 9):
        assert 2 <= sum(c[1].endswith(f'/items({source_id})') for c in guards) <= 3
    schema_reads = [c for c in remote.calls if c[0] == 'GET' and c[1].endswith('/fields')]
    assert len(schema_reads) == 2
    scans = [c for c in remote.calls if c[0] == 'GET' and urlsplit(c[1]).path.endswith('/items')
             and not ((c[2].get('params') or {}).get('$filter') or '$filter' in parse_qs(urlsplit(c[1]).query))]
    source_pages = [c for c in scans if "GetByTitle('FORNECEDORES')" in c[1]]
    target_pages = [c for c in scans if "GetByTitle('FUNCIONARIOSRH')" in c[1]]
    assert len(source_pages) == 5 and len(target_pages) == 2
    assert source_pages[0][2]['params']['$select'] == 'Id,EMPREITEIRO,STATUS'
    assert target_pages[0][2]['params']['$select'] == 'IDFORNECEDORORIGEM'
    assert remote.items['FUNCIONARIOSRH'][target_8]['STATUS'] == 'INATIVO'
    assert remote.items['FUNCIONARIOSRH'][target_8]['DATADESLIGAMENTO'] == '2026-10-20T03:00:00Z'
    assert remote.items['FUNCIONARIOSRH'][target_9]['EMPREITEIRO'] == 'NÃO'


def test_batch_skips_275_unrelated_rows_with_two_scans_and_no_schema_or_item_reads(setup):
    sync, remote, sp, store = setup
    source = remote.items['FORNECEDORES'][7]
    remote.items['FORNECEDORES'] = {i: {**source, 'Id': i, 'EMPREITEIRO': 'NÃO'} for i in range(1, 276)}
    remote.page_size = 5000
    assert sync.sync_all(sp, state_store=store) == {
        'processed': 275, 'synced': 0, 'skipped': 275, 'errors': 0}
    assert len(remote.calls) == 2
    assert all(c[0] == 'GET' and c[1].endswith('/items') for c in remote.calls)


def test_batch_refreshes_schema_next_run_and_counts_each_failed_candidate_once(setup):
    sync, remote, sp, store = setup
    remote.items['FORNECEDORES'][8] = {**remote.items['FORNECEDORES'][7], 'Id': 8}
    remote.items['FORNECEDORES'][9] = {**remote.items['FORNECEDORES'][7], 'Id': 9, 'EMPREITEIRO': 'NÃO'}
    assert sync.sync_all(sp, state_store=store) == {
        'processed': 3, 'synced': 2, 'skipped': 1, 'errors': 0}
    assert len([c for c in remote.calls if c[1].endswith('/fields')]) == 2
    next(f for f in remote.fields['FUNCIONARIOSRH'] if f['InternalName'] == 'IDFORNECEDORORIGEM')['Indexed'] = False
    remote.calls.clear()
    assert sync.sync_all(sp, state_store=store) == {
        'processed': 3, 'synced': 0, 'skipped': 1, 'errors': 2}
    assert len([c for c in remote.calls if c[1].endswith('/fields')]) == 2
    assert all(c[0] == 'GET' for c in remote.calls)


def test_batch_rechecks_selected_source_eligibility_before_any_create(setup, monkeypatch):
    sync, remote, sp, store = setup
    request = remote.request
    def change_before_item_get(method, url, **kwargs):
        if method == 'GET' and url.endswith("GetByTitle('FORNECEDORES')/items(7)"):
            remote.items['FORNECEDORES'][7]['STATUS'] = 'INATIVO'
        return request(method, url, **kwargs)
    monkeypatch.setattr(remote, 'request', change_before_item_get)
    assert sync.sync_all(sp, state_store=store) == {
        'processed': 1, 'synced': 0, 'skipped': 1, 'errors': 0}
    assert remote.items['FUNCIONARIOSRH'] == {}
    assert all(c[0] == 'GET' for c in remote.calls)


def test_gallery_inactivation_after_source_snapshot_is_not_restored_to_active(setup, monkeypatch):
    sync, remote, sp, store = setup
    target_id = sync.sync_supplier(sp, 7, state_store=store)['target_id']
    request = remote.request
    changed = False
    def close_after_source_snapshot(method, url, **kwargs):
        nonlocal changed
        response = request(method, url, **kwargs)
        if not changed and method == 'GET' and url.endswith("GetByTitle('FORNECEDORES')/items(7)"):
            changed = True
            remote.edit('FORNECEDORES', 7, STATUS='INATIVO', DATADESLIGAMENTO='2026-10-20T03:00:00Z')
            remote.edit('FUNCIONARIOSRH', target_id, STATUS='INATIVO', DATADESLIGAMENTO='2026-10-20T03:00:00Z')
        return response
    monkeypatch.setattr(remote, 'request', close_after_source_snapshot)
    with pytest.raises(RuntimeError):
        sync.sync_supplier(sp, 7, state_store=store)
    row = remote.items['FUNCIONARIOSRH'][target_id]
    assert row['STATUS'] == 'INATIVO' and row['DATADESLIGAMENTO'] == '2026-10-20T03:00:00Z'


def test_target_etag_prevents_gallery_inactivation_between_checks_and_merge(setup, monkeypatch):
    sync, remote, sp, store = setup
    target_id = sync.sync_supplier(sp, 7, state_store=store)['target_id']
    remote.edit('FORNECEDORES', 7, EXTRA='requires merge')
    remote.edit('FUNCIONARIOSRH', target_id, STATUS='INATIVO', DATADESLIGAMENTO='2026-10-19T03:00:00Z')
    request = remote.request
    merges = []
    def close_immediately_before_merge(method, url, **kwargs):
        if method == 'POST' and kwargs.get('headers', {}).get('X-HTTP-Method') == 'MERGE':
            merges.append(kwargs['headers']['IF-MATCH'])
            remote.edit('FORNECEDORES', 7, STATUS='INATIVO', DATADESLIGAMENTO='2026-10-20T03:00:00Z')
            remote.edit('FUNCIONARIOSRH', target_id, STATUS='INATIVO', DATADESLIGAMENTO='2026-10-20T03:00:00Z')
        return request(method, url, **kwargs)
    monkeypatch.setattr(remote, 'request', close_immediately_before_merge)
    with pytest.raises(RuntimeError):
        sync.sync_supplier(sp, 7, state_store=store)
    assert merges and '*' not in merges
    row = remote.items['FUNCIONARIOSRH'][target_id]
    assert row['STATUS'] == 'INATIVO' and row['DATADESLIGAMENTO'] == '2026-10-20T03:00:00Z'
    assert json.loads(next(store.directory.rglob('7.json')).read_text())['phase'] == 'linked'


def test_source_change_during_merge_is_error_and_retry_uses_latest_same_identity(setup, monkeypatch):
    sync, remote, sp, store = setup
    target_id = sync.sync_supplier(sp, 7, state_store=store)['target_id']
    remote.edit('FORNECEDORES', 7, EXTRA='requires merge')
    request = remote.request
    def close_source_after_merge(method, url, **kwargs):
        response = request(method, url, **kwargs)
        if method == 'POST' and kwargs.get('headers', {}).get('X-HTTP-Method') == 'MERGE':
            remote.edit('FORNECEDORES', 7, STATUS='INATIVO', DATADESLIGAMENTO='2026-10-20T03:00:00Z')
        return response
    monkeypatch.setattr(remote, 'request', close_source_after_merge)
    with pytest.raises(RuntimeError):
        sync.sync_supplier(sp, 7, state_store=store)
    monkeypatch.setattr(remote, 'request', request)
    assert sync.sync_supplier(sp, 7, state_store=store)['target_id'] == target_id
    row = remote.items['FUNCIONARIOSRH'][target_id]
    assert row['STATUS'] == 'INATIVO' and row['DATADESLIGAMENTO'] == '2026-10-20T03:00:00Z'
    assert len(remote.items['FUNCIONARIOSRH']) == 1


def test_source_change_during_final_target_verification_is_not_reported_synced(setup, monkeypatch):
    sync, remote, sp, store = setup
    target_id = sync.sync_supplier(sp, 7, state_store=store)['target_id']
    request = remote.request
    reads = 0
    def change_during_final_read(method, url, **kwargs):
        nonlocal reads
        response = request(method, url, **kwargs)
        if method == 'GET' and url.endswith(f"GetByTitle('FUNCIONARIOSRH')/items({target_id})"):
            reads += 1
            if reads == 2:
                remote.edit('FORNECEDORES', 7, STATUS='INATIVO', DATADESLIGAMENTO='2026-10-20T03:00:00Z')
        return response
    monkeypatch.setattr(remote, 'request', change_during_final_read)
    with pytest.raises(RuntimeError):
        sync.sync_supplier(sp, 7, state_store=store)
    assert reads == 2


def test_source_changed_after_lookup_cannot_create_obsolete_active_row(setup, monkeypatch):
    sync, remote, sp, store = setup
    request = remote.request
    def close_after_lookup(method, url, **kwargs):
        response = request(method, url, **kwargs)
        if method == 'GET' and url.endswith("GetByTitle('FUNCIONARIOSRH')/items") and (kwargs.get('params') or {}).get('$filter'):
            remote.edit('FORNECEDORES', 7, STATUS='INATIVO', DATADESLIGAMENTO='2026-10-20T03:00:00Z')
        return response
    monkeypatch.setattr(remote, 'request', close_after_lookup)
    with pytest.raises(RuntimeError):
        sync.sync_supplier(sp, 7, state_store=store)
    assert remote.items['FUNCIONARIOSRH'] == {}


@pytest.mark.parametrize('title', ['FORNECEDORES', 'FUNCIONARIOSRH'])
def test_missing_item_etag_never_confirms_sync_or_writes_without_guard(setup, monkeypatch, title):
    sync, remote, sp, store = setup
    sync.sync_supplier(sp, 7, state_store=store)
    remote.calls.clear()
    request = remote.request
    def omit_item_etag(method, url, **kwargs):
        response = request(method, url, **kwargs)
        if method == 'GET' and f"GetByTitle('{title}')/items(" in url and url.endswith(')'):
            body = response.json()
            body.pop('@odata.etag', None)
            response._content = json.dumps(body).encode()
            response.headers.pop('ETag', None)
        return response
    monkeypatch.setattr(remote, 'request', omit_item_etag)
    with pytest.raises(RuntimeError):
        sync.sync_supplier(sp, 7, state_store=store)
    assert not [c for c in remote.calls if c[0] == 'POST']


def test_sync_refuses_target_with_additional_acl_recipient_before_employee_writes(setup):
    sync, remote, sp, store = setup
    remote.roles['FUNCIONARIOSRH'][99] = {1073741826}
    with pytest.raises(PermissionError):
        sync.sync_supplier(sp, 7, state_store=store)
    assert all(c[0] == 'GET' for c in remote.calls)
    assert remote.items['FUNCIONARIOSRH'] == {}


def test_unique_item_permissions_are_refused_and_timer_counts_error_without_data(setup):
    sync, remote, sp, store = setup
    remote.items['FORNECEDORES'][7]['HasUniqueRoleAssignments'] = True
    with pytest.raises(PermissionError):
        sync.sync_supplier(sp, 7, state_store=store)
    assert sync.sync_all(sp, state_store=store) == {'processed': 1, 'synced': 0, 'skipped': 0, 'errors': 1}
    assert not [c for c in remote.calls if c[0] == 'POST']


def test_item_acl_becoming_unique_after_snapshot_blocks_create(setup, monkeypatch):
    sync, remote, sp, store = setup
    request = remote.request
    def make_unique_after_source_read(method, url, **kwargs):
        response = request(method, url, **kwargs)
        if method == 'GET' and url.endswith("GetByTitle('FORNECEDORES')/items(7)"):
            remote.items['FORNECEDORES'][7]['HasUniqueRoleAssignments'] = True
        return response
    monkeypatch.setattr(remote, 'request', make_unique_after_source_read)
    with pytest.raises(PermissionError):
        sync.sync_supplier(sp, 7, state_store=store)
    assert remote.items['FUNCIONARIOSRH'] == {}


def test_source_roleassignments_403_raises_and_timer_reports_error_without_copy(setup, monkeypatch):
    sync, remote, sp, store = setup
    remote.security['FORNECEDORES']['HasUniqueRoleAssignments'] = True
    request = remote.request
    def deny_source_acl_read(method, url, **kwargs):
        if method == 'GET' and url.endswith("GetByTitle('FORNECEDORES')/roleassignments"):
            return remote.response({'error': {'message': 'synthetic Forbidden'}}, status=403)
        return request(method, url, **kwargs)
    monkeypatch.setattr(remote, 'request', deny_source_acl_read)
    with pytest.raises(PermissionError):
        sync.sync_supplier(sp, 7, state_store=store)
    assert sync.sync_all(sp, state_store=store) == {'processed': 1, 'synced': 0, 'skipped': 0, 'errors': 1}
    assert remote.items['FUNCIONARIOSRH'] == {}
    assert all(c[0] == 'GET' for c in remote.calls)
