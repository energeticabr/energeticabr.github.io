"""Future submissions, never source import. All REST is synthetic."""
import copy
import hashlib
import json
from types import SimpleNamespace

import pytest

from rest_fixture import client, module, Transport

hr = module('contractor_employment')


def answers():
    return {'CADASTRO': 'SYNTHETIC', 'EMPREITEIRO': 'SIM', 'STATUS': 'ATIVO',
            'CARGO': 'PEDREIRO I', 'VINCULO': 'CLT', 'FILIAL': 'TEST',
            'DATAADMISSAO': '2026-10-01T00:00:00Z', 'DATANASCIMENTO': '1990-01-02',
            'ENDEREÇO': 'Rua teste 123-A', 'DOCUMENTO FORNECEDOR': '00000000000',
            'HOMOLOGAÇÃO': 'NÃO', 'FORMA PGTO': 'DIÁRIO', 'VLR DIARIO': '100,50',
            'DESCRITIVOETAPA ATUAL': 'etapa teste', 'ATIVIDADE EXERCIDA': 'atividade',
            'MEDIÇÃOATUAL': '1'}


def context(tmp_path):
    remote = Transport(); sp = client(remote); store = SimpleNamespace(directory=tmp_path)
    directory = hr._state_directory(sp, store)
    hr._checkpoint(directory / 'submission-7.json', {
        'version': 1, 'supplier_id': 7, 'flow_id': 'a'*32,
        'token_hash': hashlib.sha256(b'NEW-SYNTHETIC').hexdigest()})
    hr._checkpoint(directory / ('flow-'+'a'*32+'.json'), {
        'version': 1, 'flow_id': 'a'*32, 'token_hash': hashlib.sha256(b'NEW-SYNTHETIC').hexdigest()})
    return remote, sp, store


def register(sp, fields, store, files=()):
    function = getattr(hr, 'register_from_submission', None)
    assert callable(function), 'Future-only submission API is not implemented'
    return function(sp, 7, fields, files, state_store=store)


def test_new_submission_uses_only_target_and_exact_local_answers_and_bytes(tmp_path):
    remote, sp, store = context(tmp_path)
    fields = answers(); original = copy.deepcopy(fields)
    receipt = register(sp, fields, store, [{'filename': "synthetic's.pdf", 'content': b'LOCAL BYTES'}])
    assert receipt == {'status': 'registered', 'supplier_id': 7, 'target_id': 101, 'verified': True}
    row = remote.rows[101]
    assert row['Title'] == 'SYNTHETIC' and row['IDFORNECEDORORIGEM'] == '7'
    assert row['ENDERECO'] == 'Rua teste 123-A' and row['DOCUMENTOFORNECEDOR'] == '00000000000'
    assert row['DATAADMISSAO'] == '2026-10-01T03:00:00Z'
    assert row['DATANASCIMENTO'] == '1990-01-02T02:00:00Z'
    assert row['DATADESLIGAMENTO'] is None and row['EMAIL'] is None
    assert remote.files[101] == {"synthetic's.pdf": b'LOCAL BYTES'}
    assert fields == original


def test_existing_supplier_id_without_new_submission_proof_cannot_import(tmp_path):
    remote = Transport(); sp = client(remote)
    with pytest.raises(RuntimeError):
        register(sp, answers(), SimpleNamespace(directory=tmp_path))
    assert remote.posts == 0 and not remote.rows


@pytest.mark.parametrize('changes', [{'EMPREITEIRO': 'NÃO'}, {'STATUS': 'INATIVO'}])
def test_ineligible_answers_do_not_read_or_write_any_remote_data(tmp_path, changes):
    remote, sp, store = context(tmp_path)
    result = register(sp, {**answers(), **changes}, store)
    assert result['status'] == 'skipped' and remote.calls == []


def test_repeated_intent_is_idempotent_and_preserves_later_inactivation(tmp_path):
    remote, sp, store = context(tmp_path)
    register(sp, answers(), store)
    remote.rows[101].update(STATUS='INATIVO', DATADESLIGAMENTO='2026-10-20T03:00:00Z')
    result = register(client(remote), answers(), store)
    assert result['verified'] is True and remote.posts == 1
    assert remote.rows[101]['STATUS'] == 'INATIVO'
    assert remote.rows[101]['DATADESLIGAMENTO'] == '2026-10-20T03:00:00Z'


def test_changed_intent_is_rejected_without_overwriting(tmp_path):
    remote, sp, store = context(tmp_path)
    register(sp, answers(), store)
    with pytest.raises(RuntimeError):
        register(sp, {**answers(), 'CARGO': 'PEDREIRO II'}, store)
    assert remote.rows[101]['CARGO'] == 'PEDREIRO I' and remote.posts == 1


def test_checkpoint_is_durable_before_first_target_post_without_personal_data(tmp_path):
    remote, sp, store = context(tmp_path)
    def before():
        saved = [json.loads(p.read_text()) for p in tmp_path.rglob('target-7.json')]
        assert len(saved) == 1 and saved[0]['phase'] == 'create_pending'
        assert 'SYNTHETIC' not in json.dumps(saved)
    remote.before_post = before
    register(sp, answers(), store)


@pytest.mark.parametrize('visible', [True, False])
def test_lost_accepted_post_never_repeats_even_across_restart(tmp_path, visible):
    remote, sp, store = context(tmp_path)
    remote.lost_create = True; remote.hidden = not visible
    if visible:
        assert register(sp, answers(), store)['verified']
    else:
        for _ in range(2):
            with pytest.raises(RuntimeError):
                register(client(remote), answers(), store)
        remote.hidden = False
        assert register(client(remote), answers(), store)['verified']
    assert remote.posts == 1


def test_partial_attachment_failure_raises_then_resumes_existing_target(tmp_path):
    remote, sp, store = context(tmp_path)
    files = [{'filename': 'test.pdf', 'content': b'EXPECTED'}]
    remote.fail_attachment = True
    with pytest.raises(RuntimeError):
        register(sp, answers(), store, files)
    remote.fail_attachment = False
    assert register(client(remote), answers(), store, files)['verified']
    assert remote.posts == 1 and remote.files[101]['test.pdf'] == b'EXPECTED'


@pytest.mark.parametrize('failure', ['corrupt_field', 'corrupt_attachment'])
def test_readback_must_confirm_payload_and_file_content(tmp_path, failure):
    remote, sp, store = context(tmp_path)
    setattr(remote, failure, True)
    with pytest.raises(RuntimeError):
        register(sp, answers(), store, [{'filename': 'test.pdf', 'content': b'EXPECTED'}])
    assert remote.posts == 1


@pytest.mark.parametrize('changes', [{'DATAADMISSAO': None}, {'DATAADMISSAO': '2026-02-31'},
    {'CARGO': 'UNSUPPORTED'}, {'Author': {'Id': 2}}, {'DATADESLIGAMENTO': '2026-10-20'}])
def test_invalid_or_system_answers_fail_before_target_writes(tmp_path, changes):
    remote, sp, store = context(tmp_path)
    with pytest.raises(ValueError):
        register(sp, {**answers(), **changes}, store)
    assert remote.posts == 0


def test_nonunique_target_identity_fails_before_data(tmp_path):
    remote, sp, store = context(tmp_path)
    next(f for f in remote.fields if f['InternalName'] == 'IDFORNECEDORORIGEM')['EnforceUniqueValues'] = False
    with pytest.raises(ValueError):
        register(sp, answers(), store)
    assert remote.posts == 0


def test_duplicate_target_identity_on_later_page_is_not_adopted(tmp_path):
    remote, sp, store = context(tmp_path)
    remote.rows = {1: {'Id': 1, 'IDFORNECEDORORIGEM': '7'}, 2: {'Id': 2, 'IDFORNECEDORORIGEM': '7'}}
    remote.page_size = 1
    with pytest.raises(RuntimeError):
        register(sp, answers(), store)
    assert remote.posts == 0


def test_source_receipt_alone_without_new_flow_marker_is_not_authority(tmp_path):
    remote, sp, store = context(tmp_path)
    next(tmp_path.rglob('flow-*.json')).unlink()
    with pytest.raises(RuntimeError):
        register(sp, answers(), store)
    assert remote.posts == 0


def test_parallel_services_sharing_state_create_once(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    remote, sp, store = context(tmp_path)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: register(client(remote), answers(), store), range(2)))
    assert all(r['target_id'] == 101 and r['verified'] for r in results)
    assert remote.posts == 1


def test_mid_file_failure_resumes_without_reposting_existing_attachment(tmp_path):
    remote, sp, store = context(tmp_path)
    files = [{'filename': 'one.pdf', 'content': b'ONE'}, {'filename': 'two.pdf', 'content': b'TWO'}]
    remote.fail_attachment_after = 1
    with pytest.raises(RuntimeError):
        register(sp, answers(), store, files)
    remote.fail_attachment_after = None
    assert register(client(remote), answers(), store, files)['verified']
    assert remote.attachment_posts == 2 and remote.posts == 1


def test_changed_local_file_intent_is_rejected_after_partial_copy(tmp_path):
    remote, sp, store = context(tmp_path)
    remote.fail_attachment = True
    with pytest.raises(RuntimeError):
        register(sp, answers(), store, [{'filename': 'one.pdf', 'content': b'ONE'}])
    remote.fail_attachment = False
    with pytest.raises(RuntimeError):
        register(sp, answers(), store, [{'filename': 'one.pdf', 'content': b'CHANGED'}])
    assert remote.posts == 1 and remote.attachment_posts == 0


def test_real_source_lost_response_and_restart_authorizes_exactly_one_future_hr_row(tmp_path):
    from test_source_identity import Transport as SourceTransport, client as source_client
    from supplier_registration_checkpoint import start_future_flow, ensure_supplier
    source, target = SourceTransport(), Transport()
    store = SimpleNamespace(directory=tmp_path)
    ordinary = source_client(source)
    flow_id = start_future_flow(ordinary, 'NEW-TOKEN', state_store=store)
    source.hidden = True; source.lost = True
    with pytest.raises(RuntimeError):
        ensure_supplier(ordinary, 'NEW-TOKEN', {'CADASTRO': 'SYNTHETIC'}, state_store=store, future_flow_id=flow_id)
    source.hidden = False
    item_id = ensure_supplier(source_client(source), 'NEW-TOKEN', {'CADASTRO': 'SYNTHETIC'}, state_store=store, future_flow_id=flow_id)
    for _ in range(2):
        result = hr.register_from_submission(client(target), item_id, answers(), state_store=store)
        assert result['verified'] and result['target_id'] == 101
    assert source.posts == 1 and target.posts == 1


def test_actual_local_state_store_survives_restart_and_checkpoints_are_not_sessions(tmp_path):
    from local_app import LocalStateStore
    remote = Transport(); sp = client(remote); store = LocalStateStore(tmp_path)
    _, _, seeded = context(tmp_path)
    store.save('synthetic-session', {'fields': answers()}, None)
    register(sp, answers(), store)
    restarted = LocalStateStore(tmp_path)
    assert register(client(remote), restarted.load('synthetic-session')[0]['fields'], restarted)['verified']
    assert len(list(restarted.iter_states())) == 1
    assert remote.posts == 1
