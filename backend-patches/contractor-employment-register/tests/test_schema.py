"""Empty, explicit target schema; transport forbids source/ACL/item mutations."""
from pathlib import Path
from types import SimpleNamespace

import pytest

from rest_fixture import Transport, client, field, module

schema = module('future_schema_test', Path(__file__).resolve().parents[1] / 'schema.py')


def test_plan_absent_target_has_no_writes_or_source_dependencies(tmp_path):
    remote = Transport(exists=False)
    plan = schema.provision(client(remote), apply=False, state_store=SimpleNamespace(directory=tmp_path))
    assert plan['applied'] is False and plan['item_count'] == 0
    assert plan['actions'][0] == {'action': 'create_list', 'list': 'FUNCIONARIOSRH'}
    assert all(method == 'GET' for method, _, _ in remote.calls)
    assert not list(tmp_path.iterdir())


def test_apply_starts_empty_explicit_schema_and_is_idempotent(tmp_path):
    remote = Transport(exists=False); store = SimpleNamespace(directory=tmp_path)
    result = schema.provision(client(remote), apply=True, state_store=store)
    assert result['applied'] is True and result['item_count'] == 0
    actual = {f['InternalName']: f for f in remote.fields}
    assert len(actual) == 27
    assert actual['Title']['Title'] == 'CADASTRO'
    assert actual['ENDERECO']['TypeAsString'] == 'Note'
    assert actual['IDFORNECEDORORIGEM']['Indexed'] and actual['IDFORNECEDORORIGEM']['EnforceUniqueValues']
    assert actual['DATAADMISSAO']['TypeAsString'] == 'DateTime'
    assert not any(name.startswith('ORIGEM') for name in actual)
    assert schema.provision(client(remote), apply=True, state_store=store)['actions'] == []
    assert remote.list_posts == 1 and remote.rows == {} and remote.posts == 0


@pytest.mark.parametrize('bad', [field('CARGO', 'Number'), field('IDFORNECEDORORIGEM', Indexed=False),
    field('DATAADMISSAO', 'DateTime', SchemaXml='<Field Format="DateTime" />')])
def test_incompatible_existing_schema_fails_before_mutation(tmp_path, bad):
    remote = Transport()
    remote.fields = [bad if f['InternalName'] == bad['InternalName'] else f for f in remote.fields]
    with pytest.raises(ValueError):
        schema.provision(client(remote), apply=True, state_store=SimpleNamespace(directory=tmp_path))
    assert all(method == 'GET' for method, _, _ in remote.calls)


def test_populated_list_is_preserved_and_refused(tmp_path):
    remote = Transport(); remote.rows[1] = {'Id': 1, 'Title': 'PRESERVE'}
    with pytest.raises(RuntimeError):
        schema.provision(client(remote), apply=True, state_store=SimpleNamespace(directory=tmp_path))
    assert remote.rows[1]['Title'] == 'PRESERVE'
    assert all(method == 'GET' for method, _, _ in remote.calls)


def test_lost_list_response_reconciles_without_duplicate_creation(tmp_path):
    remote = Transport(exists=False); remote.lost_list = True
    store = SimpleNamespace(directory=tmp_path)
    assert schema.provision(client(remote), apply=True, state_store=store)['item_count'] == 0
    assert schema.provision(client(remote), apply=True, state_store=store)['actions'] == []
    assert remote.list_posts == 1
