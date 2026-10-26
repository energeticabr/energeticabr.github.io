"""Reconcile owned, unpaid RH weeks through a narrow remote adapter."""
from copy import deepcopy
from decimal import Decimal, InvalidOperation
import importlib.util
import json
import os
from pathlib import Path
import tempfile


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


model = _load('swile_reconcile_model', Path(__file__).with_name('model.py'))
_durability = _load('swile_existing_journal', Path(__file__).parents[1] / 'monthly-payroll-taxes' / 'reconcile.py')
JsonJournal = _durability.JsonJournal
ReconciliationError = _durability.ReconciliationError
PARENT, CHILD, LEGACY = model.PARENT, model.CHILD, model.LEGACY


def _id(row):
    if not isinstance(row, dict):
        raise ReconciliationError('Registro não confirmado por leitura')
    return model.identity(row.get('Id', row.get('id')))


def _same(field, actual, expected):
    if actual is None and expected == '':
        return True
    if field in {'VALORTOTAL', 'QTD', 'FRETE'}:
        try:
            return not isinstance(actual, bool) and Decimal(str(actual).replace(',', '.')) == Decimal(str(expected))
        except InvalidOperation:
            return False
    if field in {'DATA', 'DATAPREVISTOPGTO'}:
        return str(actual or '')[:10] == str(expected)[:10]
    return str(actual if actual is not None else '') == str(expected)


def _matches(row, fields):
    return isinstance(row, dict) and all(_same(k, row.get(k), v) for k, v in fields.items())


def _one(adapter, title, key):
    rows = adapter.find(title, 'FOLHAOPERACAO', key)
    if len(rows) > 1:
        raise ReconciliationError('Chave financeira duplicada')
    return rows[0] if rows else None


def _create(adapter, journal, title, fields):
    key = fields['FOLHAOPERACAO']
    existing = _one(adapter, title, key)
    if existing is not None:
        if not _matches(existing, fields):
            raise ReconciliationError('Registro existente diverge da intenção')
        return existing
    journal.bind('create', title, key, fields)
    journal.attempt('create', title, key, fields)
    try:
        adapter.create(title, deepcopy(fields))
    except Exception:
        # An ambiguous response is followed only by an authoritative read.
        pass
    row = _one(adapter, title, key)
    if not _matches(row, fields):
        raise ReconciliationError('Criação sem confirmação exata; não repetir o POST')
    journal.confirm('create', title, key, fields, _id(row))
    return row


def _patch(adapter, title, row, fields):
    etag = row.get('audit_etag')
    if not etag:
        raise ReconciliationError('Versão do registro não disponível')
    try:
        adapter.patch(title, _id(row), deepcopy(fields), etag)
    except Exception:
        after = adapter.read(title, _id(row))
        if not _matches(after, fields):
            raise ReconciliationError('Registro alterado ou atualização não confirmada') from None
    after = adapter.read(title, _id(row))
    if not _matches(after, fields):
        raise ReconciliationError('Atualização sem confirmação exata')
    return after


def _preserve_reason(parent, children, plan):
    if not model.unpaid(parent) or any(not model.unpaid(c) for c in children):
        return 'Pagamento ou agendamento já registrado'
    if any(not model.blank(r.get('FORMAPGTO')) or r.get('OBS') != model.LABEL for r in [parent, *children]):
        return 'Forma de pagamento ou observação alterada manualmente'
    if (parent.get('FORNECEDOR') != 'SWILE'
            or str(parent.get('DATAPREVISTOPGTO', ''))[:10] != plan['dueDate']
            or parent.get('Title') not in (plan['key'], plan['key'] + model.PREPARING)):
        return 'Descritivo alterado manualmente'
    expected = {plan['key'] + ':' + str(r['supplierId']): r for r in plan['rows']}
    keys = set()
    for child in children:
        key = child.get('FOLHAOPERACAO', '')
        if not key.startswith(plan['key'] + ':') or key in keys:
            return 'Vínculo ou linha alterada manualmente'
        keys.add(key)
        if not _matches(child, {'QTD': '5', 'VALORTOTAL': '45', 'FRETE': '0',
                              'PRODUTO': model.LABEL, 'DATAPREVISTOPGTO': plan['dueDate']}):
            return 'Valor ou vencimento alterado manualmente'
        if key in expected:
            row = expected[key]
            if not _matches(child, {'FORNECEDOR': row['name'], 'FILIAL': row['branch'], 'IMOVEL': row['property']}):
                return 'Cadastro ou localização alterados'
    if parent.get('Title') == plan['key'] and not _same('VALORTOTAL', parent.get('VALORTOTAL'), 225 * len(children)):
        return 'Total do descritivo alterado manualmente'
    return ''


def reconcile(adapter, plans, journal):
    for title in (PARENT, CHILD):
        adapter.require_unique(title, 'FOLHAOPERACAO')
    results = []
    for plan in plans:
        parent = _one(adapter, PARENT, plan['key'])
        if parent is None:
            parent = _create(adapter, journal, PARENT, model.parent_payload(plan))
        pid = _id(parent)
        children = adapter.find(CHILD, 'DESCRITIVOPROVISAO', str(pid))
        reason = _preserve_reason(parent, children, plan)
        if reason:
            results.append({'status': 'preserved', 'parentId': pid, 'dueDate': plan['dueDate'], 'reason': reason})
            continue
        keys = {c['FOLHAOPERACAO'] for c in children}
        missing = [r for r in plan['rows'] if plan['key'] + ':' + str(r['supplierId']) not in keys]
        if missing and parent['Title'] == plan['key']:
            parent = _patch(adapter, PARENT, parent, {'Title': plan['key'] + model.PREPARING})
        for row in missing:
            current = adapter.read(PARENT, pid)
            if _preserve_reason(current, [], plan) or current.get('Title') != plan['key'] + model.PREPARING:
                raise ReconciliationError('Descritivo mudou durante a preparação')
            _create(adapter, journal, CHILD, model.child_payload(plan, row, pid))
        children = adapter.find(CHILD, 'DESCRITIVOPROVISAO', str(pid))
        parent = adapter.read(PARENT, pid)
        reason = _preserve_reason(parent, children, plan)
        if reason:
            raise ReconciliationError('Grupo mudou antes da confirmação: ' + reason)
        if not {plan['key'] + ':' + str(r['supplierId']) for r in plan['rows']}.issubset({c['FOLHAOPERACAO'] for c in children}):
            raise ReconciliationError('Nem todos os fornecedores foram confirmados')
        total = str(225 * len(children))
        if parent.get('Title') != plan['key'] or not _same('VALORTOTAL', parent.get('VALORTOTAL'), total):
            parent = _patch(adapter, PARENT, parent, {'Title': plan['key'], 'VALORTOTAL': total})
        results.append({'status': 'confirmed', 'parentId': pid, 'dueDate': plan['dueDate'],
                        'provisionIds': sorted(_id(c) for c in children), 'total': total,
                        'createdChildren': len(missing)})
    return results


def _save_backup(path, data):
    path = Path(path)
    if path.exists():
        original = json.loads(path.read_text(encoding='utf-8'))
        if _id(original['recurrence']) != _id(data['recurrence']):
            raise ReconciliationError('Backup pertence a outra recorrência')
        if not set(data['candidates']['provisionIds']).issubset(original['candidates']['provisionIds']):
            raise ReconciliationError('Novos candidatos exigem um novo backup')
        for field, ids in [('provisions', data['candidates']['provisionIds']),
                           ('parents', data['candidates']['parentIds'])]:
            before = {_id(r): r for r in original[field]}
            current = {_id(r): r for r in data[field]}
            if any(before.get(item_id) != current.get(item_id) for item_id in ids):
                raise ReconciliationError('Versão editada exige novo backup imutável')
        return original
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
        temporary = stream.name
    os.replace(temporary, path)
    return data


def retire_legacy(adapter, recurrence_id, backup_path):
    rid = model.identity(recurrence_id)
    recurrence = adapter.read(LEGACY, rid)
    if not recurrence or recurrence.get('FORNECEDOR') != 'SWILE' or recurrence.get('EQUIPAMENTO') != model.LABEL:
        raise ReconciliationError('Recorrência selecionada não corresponde ao SWILE')
    children, parents = adapter.all_rows(CHILD), adapter.all_rows(PARENT)
    candidates = model.legacy_targets(children, parents, rid)
    backup = _save_backup(backup_path, {'recurrence': recurrence, 'provisions': children,
                                      'parents': parents, 'candidates': candidates})
    if recurrence.get('STATUS') != 'INATIVO':
        if recurrence != backup['recurrence']:
            raise ReconciliationError('Versão da recorrência exige novo backup imutável')
        _patch(adapter, LEGACY, recurrence, {'STATUS': 'INATIVO'})
    deleted_children, deleted_parents, preserved = [], [], []
    by_child = {_id(x): x for x in children}
    by_parent = {_id(x): x for x in backup['parents']}
    for cid in candidates['provisionIds']:
        current = adapter.read(CHILD, cid)
        if current is None:
            continue
        if not model.unpaid(current):
            preserved.append(cid)
            continue
        if current.get('audit_etag') != by_child[cid].get('audit_etag'):
            raise ReconciliationError('Provisão alterada após a prévia da limpeza')
        try:
            adapter.delete(CHILD, cid, current['audit_etag'])
        except Exception:
            after = adapter.read(CHILD, cid)
            if after is not None:
                if not model.unpaid(after):
                    preserved.append(cid)
                    continue
                raise ReconciliationError('Exclusão não confirmada; não repetir') from None
        if adapter.read(CHILD, cid) is not None:
            raise ReconciliationError('Provisão ainda presente após exclusão')
        deleted_children.append(cid)
    for pid in backup['candidates']['parentIds']:
        if adapter.find(CHILD, 'DESCRITIVOPROVISAO', str(pid)):
            continue
        current = adapter.read(PARENT, pid)
        if current is None:
            continue
        if not model.unpaid(current, allow_blank_status=True) or current.get('Attachments'):
            continue
        if current != by_parent[pid]:
            raise ReconciliationError('Descritivo mudou após a prévia da limpeza')
        try:
            adapter.delete(PARENT, pid, current['audit_etag'])
        except Exception:
            if adapter.read(PARENT, pid) is not None:
                raise ReconciliationError('Exclusão de descritivo não confirmada') from None
        if adapter.read(PARENT, pid) is not None:
            raise ReconciliationError('Descritivo ainda presente após exclusão')
        deleted_parents.append(pid)
    if adapter.read(LEGACY, rid).get('STATUS') != 'INATIVO':
        raise ReconciliationError('Inativação da recorrência não confirmada')
    remaining = model.legacy_targets(adapter.all_rows(CHILD), adapter.all_rows(PARENT), rid)
    if remaining['provisionIds']:
        raise ReconciliationError('Ainda há provisões antigas pendentes')
    return {'inactiveRecurrenceId': rid, 'deletedProvisionIds': deleted_children,
            'deletedParentIds': deleted_parents, 'preservedProvisionIds': preserved}
