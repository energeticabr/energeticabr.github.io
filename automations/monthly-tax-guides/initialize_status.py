"""One-time initialization of empty tax guide statuses; never changes other fields."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re

from run import SharePointStore, existing_client


def initialize_status(store, backup_root):
    store.schema()
    rows, actions = [], []
    for listed in store.pages(store.base + '/items', {'$top': 1000}):
        ident = listed.get('Id')
        if not isinstance(ident, int) or isinstance(ident, bool) or ident < 1:
            raise ValueError('ID da guia não confirmado')
        response = store.client._request('GET', store.base + f'/items({ident})', _return_response=True)
        row = response.json()
        if row.get('Id') != ident or not re.fullmatch(r'GUIA:\d{4}-(?:0[1-9]|1[0-2]):5:(?:INSS|FGTS)', str(row.get('CHAVE') or '')):
            raise ValueError('Identidade da guia fora do escopo')
        etag = response.headers.get('ETag')
        if not isinstance(etag, str) or etag.strip() in {'', '*'}:
            raise ValueError('ETag exato da guia não confirmado')
        rows.append({**row, 'eTag': etag})
        if not str(row.get('STATUS') or '').strip():
            actions.append({'id': ident, 'eTag': etag})
    if not actions:
        return {'initialized': 0, 'preserved': len(rows), 'backup': None}
    backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup = backup_root / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.json')
    with backup.open('x', encoding='utf-8') as handle:
        json.dump({'rows': rows, 'actions': actions}, handle, ensure_ascii=False, indent=2)
    for action in actions:
        endpoint = store.base + f"/items({action['id']})"
        store.client._request('POST', endpoint, json={'STATUS': 'PENDENTE'},
                              headers={'IF-MATCH': action['eTag'], 'X-HTTP-Method': 'MERGE'}, _return_response=True)
        current = store.client._request('GET', endpoint, _return_response=True).json()
        if current.get('STATUS') != 'PENDENTE':
            raise ValueError('Status inicial não confirmado após gravação')
    return {'initialized': len(actions), 'preserved': len(rows) - len(actions), 'backup': str(backup)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup-root', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(initialize_status(SharePointStore(existing_client()), args.backup_root)))
