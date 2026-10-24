"""Restart/reconciliation through actual engine, REST client, local media/store."""
import copy
import json
from urllib.parse import unquote, urlsplit

import pytest
import requests

from test_reupload import Recovery
from test_workflow import ADMISSION, ROLES
from rest_fixture import Transport


@pytest.mark.parametrize('link', ['CLT', 'TERCEIRIZADO', 'INFORMAL'])
@pytest.mark.parametrize('role', ROLES)
def test_actual_engine_client_registers_all_role_link_paths_with_27_field_readback(tmp_path, link, role):
    run = Recovery(tmp_path)
    run.state['fields'].update(CARGO=role, VINCULO=link)
    run.attach('original.pdf', b'EXACT LOCAL BYTES')
    assert run.commit()['status'] == 'completed'
    assert run.remote.source_posts == run.remote.target.posts == 1
    row = run.remote.target.rows[101]
    assert row['CARGO'] == role and row['VINCULO'] == link
    assert row['DATAADMISSAO'] == '2026-10-01T03:00:00Z'
    assert row['DATADESLIGAMENTO'] is None
    assert run.remote.source_files == run.remote.target.files[101]
    assert run.remote.source_downloads == 0
    selections = [kw['params']['$select'].split(',') for method, url, kw in run.remote.target.calls
        if method == 'GET' and urlsplit(url).path.endswith('/items(101)')]
    required = {'Id', 'Title', 'IDFORNECEDORORIGEM', 'CARGO', 'EMPREITEIRO', 'STATUS', 'FILIAL',
        'TIPO', 'CIDADE', 'VINCULO', 'HOMOLOGACAO', 'TIPODOCUMENTO', 'DOCUMENTOFORNECEDOR',
        'TELEFONECONTATO', 'WHATSAPP', 'EMAIL', 'PROFISSAO', 'FORMAPGTO', 'VLRDIARIO',
        'HORASTRABALHO', 'MEDICAOATUAL', 'IMOVEL', 'ENDERECO', 'DESCRITIVOETAPAATUAL',
        'ATIVIDADEEXERCIDA', 'DATAADMISSAO', 'DATADESLIGAMENTO', 'DATANASCIMENTO'}
    assert len(selections) == 2 and all(set(selection) == required for selection in selections)
    run.restart()
    assert run.commit()['status'] == 'completed'
    assert run.remote.source_posts == run.remote.target.posts == 1


def test_actual_engine_uncertain_source_post_restarts_without_target_or_second_source_post(tmp_path):
    run = Recovery(tmp_path)
    run.attach('original.pdf', b'LOCAL')
    request = run.remote.request
    hidden = [True]
    def transport(method, url, **kwargs):
        path = unquote(urlsplit(url).path)
        if path.casefold().endswith("getbytitle('fornecedores')/items"):
            if method == 'POST':
                checkpoints = [json.loads(p.read_text()) for p in (tmp_path / 'state').rglob('source-*.json')]
                assert len(checkpoints) == 1 and checkpoints[0]['phase'] == 'create_pending'
                assert checkpoints[0]['future_flow_id'] == run.state['supplier_hr_flow_id']
                request(method, url, **kwargs)
                raise requests.Timeout('accepted source POST with lost response')
            if hidden[0]:
                return Transport.response({'value': []})
        return request(method, url, **kwargs)
    run.remote.request = transport
    for attempt in range(2):
        if attempt:
            run.restart()
        assert run.commit()['status'] == 'submission_failed'
        assert run.remote.source_posts == 1 and run.remote.target.posts == 0
    frozen = copy.deepcopy(run.state['supplier_hr_submission'])
    hidden[0] = False
    run.restart()
    assert run.commit()['status'] == 'completed'
    assert run.remote.source_posts == run.remote.target.posts == 1
    assert run.state['supplier_hr_submission'] == frozen
    assert run.remote.source_downloads == 0


def test_actual_engine_uncertain_target_post_restarts_and_reconciles_exact_original_files(tmp_path):
    run = Recovery(tmp_path)
    run.attach('original.pdf', b'LOCAL')
    run.remote.target.lost_create = True
    run.remote.target.hidden = True
    for attempt in range(2):
        if attempt:
            run.restart()
        assert run.commit()['status'] == 'submission_failed'
        assert run.remote.source_posts == run.remote.target.posts == 1
    run.remote.target.hidden = False
    run.restart()
    assert run.commit()['status'] == 'completed'
    assert run.remote.source_posts == run.remote.target.posts == 1
    assert run.remote.source_files == run.remote.target.files[101]
    assert run.remote.source_downloads == 0


def test_actual_engine_moved_source_token_cannot_authorize_another_supplier_on_restart(tmp_path):
    run = Recovery(tmp_path)
    run.remote.target.hide_list = True
    assert run.commit()['status'] == 'submission_failed'
    assert run.remote.source_posts == 1 and run.remote.target.posts == 0
    checkpoints = list((tmp_path / 'state').rglob('source-*.json'))
    assert len(checkpoints) == 1
    directory = checkpoints[0].parent
    original = {p.name: p.read_bytes() for p in directory.glob('*.json')}
    assert json.loads(checkpoints[0].read_text())['item_id'] == 7
    assert 'submission-7.json' in original and 'submission-8.json' not in original
    frozen = copy.deepcopy(run.state['supplier_hr_submission'])
    run.remote.target.hide_list = False
    run.remote.source_rows[8] = {**copy.deepcopy(run.remote.source_rows[7]), 'Id': 8}
    run.remote.source_rows[7]['__PowerAppsId__'] = 'TOKEN-MOVED-AWAY'
    request = run.remote.request

    def transport(method, url, **kwargs):
        path = unquote(urlsplit(url).path).casefold()
        if path.endswith("getbytitle('fornecedores')/items(8)"):
            assert method == 'GET'
            return Transport.response(run.remote.source_rows[8])
        if path.endswith("getbytitle('fornecedores')/items(8)/attachmentfiles"):
            assert method == 'GET'
            return Transport.response({'value': []})
        return request(method, url, **kwargs)

    run.remote.request = transport
    for _ in range(2):
        run.restart()
        assert run.commit()['status'] == 'submission_failed'
        assert run.remote.source_posts == 1 and run.remote.target.posts == 0
        assert run.remote.target.rows == {}
        assert {p.name: p.read_bytes() for p in directory.glob('*.json')} == original
        assert run.state['supplier_hr_submission'] == frozen
        assert run.remote.source_downloads == 0


@pytest.mark.parametrize('invalid', ['2026-10-01garbage', '2026-02-31', '2026-10-01T99:00:00Z'])
def test_invalid_restored_admission_routes_to_date_before_any_source_post(tmp_path, invalid):
    run = Recovery(tmp_path)
    run.state['fields']['DATAADMISSAO'] = invalid
    result = run.commit()
    assert result.get('field') == ADMISSION
    assert run.remote.source_posts == run.remote.target.posts == 0
