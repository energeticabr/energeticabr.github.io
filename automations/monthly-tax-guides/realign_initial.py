"""One-time, conditional alignment of the eight original October guide requests."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re

from run import SharePointStore, existing_client

BRANCHES = {1: '000 - ESCRITÓRIO CENTRAL', 2: '001 - OURO PRETO',
            3: '002 - OURO PRETO', 5: '004 - EDIFÍCIO XAVANTE'}
ORIGINAL = {index + 1: (branch, tax) for index, (branch, tax) in enumerate(
    (branch, tax) for branch in BRANCHES for tax in ('INSS', 'FGTS'))}
ORIGINAL_KEYS = {f'GUIA:2026-10:{branch}:{tax}' for branch, tax in ORIGINAL.values()}


def plan_alignment(rows):
    actions, seen = [], set()
    for row in rows:
        ident = row.get('Id')
        if ident not in ORIGINAL:
            if row.get('CHAVE') in ORIGINAL_KEYS: raise ValueError('ID de solicitação original alterado')
            continue
        if ident in seen: raise ValueError('ID original duplicado')
        seen.add(ident)
        branch, tax = ORIGINAL[ident]
        if (row.get('CHAVE') != f'GUIA:2026-10:{branch}:{tax}' or row.get('TIPO') != tax
                or row.get('FILIAL') != BRANCHES[branch]
                or row.get('Title') != f'Solicitar guia {tax} — 2026-10 — {BRANCHES[branch]}'):
            raise ValueError('Identidade de solicitação original alterada')
        tag = row.get('eTag')
        if not isinstance(tag, str) or not re.fullmatch(r'(?:W/)?"[^"*\r\n]+"', tag):
            raise ValueError('ETag exato obrigatório')
        if branch != 5:
            if (row.get('VALOR') is not None or row.get('VENCIMENTO') is not None
                    or row.get('Attachments') is not False
                    or row.get('COMPETENCIA') != '2026-10-01T12:00:00Z'
                    or not str(row.get('Created') or '').startswith('2026-11-19T19:15:')
                    or row.get('Created') != row.get('Modified')):
                raise ValueError('Solicitação de outra filial contém alteração; preservar')
            actions.append({'operation': 'delete', 'id': ident, 'eTag': tag})
        else:
            competence = str(row.get('COMPETENCIA') or '')[:10]
            if competence not in {'2026-10-01', '2026-10-20'}:
                raise ValueError('Competência original inesperada; preservar')
            fields = {}
            if competence == '2026-10-01': fields['COMPETENCIA'] = '2026-10-20T12:00:00Z'
            if row.get('VENCIMENTO') is None: fields['VENCIMENTO'] = '2026-11-20T12:00:00Z'
            if fields: actions.append({'operation': 'patch', 'id': ident, 'eTag': tag, 'fields': fields})
    return actions


def read(store, ident):
    response = store.client._request('GET', store.base + f'/items({int(ident)})', _return_response=True)
    row = response.json()
    row['eTag'] = response.headers.get('ETag')
    return row


def apply_alignment(store, backup_root):
    store.schema()
    # Read exact versions before planning the complete migration. A concurrent
    # edit causes IF-MATCH to fail; it never grants permission to delete newer data.
    rows = [read(store, row['Id']) for row in store.pages(store.base + '/items', {'$top': 1000})]
    actions = plan_alignment(rows)
    backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup = backup_root / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.json')
    with backup.open('x', encoding='utf-8') as handle:
        json.dump({'rows': rows, 'actions': actions}, handle, ensure_ascii=False, indent=2)
    for action in actions:
        endpoint = store.base + f"/items({action['id']})"
        headers = {'IF-MATCH': action['eTag'], 'X-HTTP-Method': 'DELETE' if action['operation'] == 'delete' else 'MERGE'}
        kwargs = {'json': action['fields']} if action['operation'] == 'patch' else {}
        store.client._request('POST', endpoint, headers=headers, _return_response=True, **kwargs)
    remaining = [read(store, row['Id']) for row in store.pages(store.base + '/items', {'$top': 1000})]
    if plan_alignment(remaining): raise ValueError('Alinhamento inicial incompleto')
    by_id = {row['Id']: row for row in remaining}
    for action in actions:
        if action['operation'] == 'delete' and action['id'] in by_id:
            raise ValueError('Remoção não confirmada')
        if action['operation'] == 'patch':
            current = by_id.get(action['id'], {})
            if any(current.get(name) != value for name, value in action['fields'].items()):
                raise ValueError('Datas não confirmadas')
            original = next(row for row in rows if row['Id'] == action['id'])
            if any(current.get(name) != original.get(name) for name in ('VALOR', 'Attachments')):
                raise ValueError('Valor ou anexos foram alterados durante o alinhamento')
    return {'removed': sum(a['operation'] == 'delete' for a in actions),
            'updated': sum(a['operation'] == 'patch' for a in actions),
            'remaining': len(remaining), 'backup': str(backup)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup-root', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(apply_alignment(SharePointStore(existing_client()), args.backup_root)))
