"""Read-only checks of the existing private publication; prints no credentials."""
import hashlib
import json
from pathlib import Path
import sqlite3
from urllib.parse import urlsplit

from monitor import DB
from sharepoint_sync import client_from_environment


if __name__ == '__main__':
    client = client_from_environment()
    drive = client._request('GET', 'v2.0/drive')
    folder = urlsplit(drive['webUrl']).path.rstrip('/') + '/TRANCID'
    published = DB.parent / 'published'
    files = []
    snapshot = None
    for name in ['posicoes.json', 'consultas.json', 'trancid.sqlite3', 'report_snapshot.json', 'Relatorio_cartoes_Trancid.pdf']:
        local = (published / name).read_bytes()
        remote = client._request('GET', "web/GetFileByServerRelativeUrl('" + folder.replace("'", "''") + '/' + name + "')/$value", _return_response=True).content
        sha256 = hashlib.sha256(remote).hexdigest()
        assert sha256 == hashlib.sha256(local).hexdigest(), 'Published hash mismatch: ' + name
        files.append({'file': name, 'sha256': sha256, 'bytes': len(remote)})
        if name == 'report_snapshot.json':
            snapshot = json.loads(remote)
    assert set(snapshot) == {'schema_version', 'currency', 'money_unit', 'positions', 'runs'}
    assert (snapshot['schema_version'], snapshot['currency'], snapshot['money_unit']) == (1, 'BRL', 'centavos')
    database = sqlite3.connect(DB.as_uri() + '?mode=ro', uri=True)
    database.row_factory = sqlite3.Row
    try:
        database.execute('BEGIN')
        expected = {table: [{key: row[key] for key in row.keys() if key != 'sharepoint_id'}
                            for row in database.execute('SELECT * FROM ' + table + ' ORDER BY id')]
                    for table in ['positions', 'runs']}
        integrity = database.execute('PRAGMA integrity_check').fetchone()[0]
    finally:
        database.close()
    assert snapshot['positions'] == expected['positions'], 'Positions differ from SQLite'
    assert snapshot['runs'] == expected['runs'], 'Runs differ from SQLite'
    assert integrity == 'ok'
    latest = {}
    for position in snapshot['positions']:
        assert 'sharepoint_id' not in position
        assert isinstance(position['balance_cents'], int)
        assert len(position['card']) == 14 and position['card'].isdigit()
        latest[position['card']] = position
    assert len(latest) == 4, 'Expected four tracked cards'
    for run in snapshot['runs']:
        assert 'sharepoint_id' not in run
        if run['status'] == 'ok':
            assert len(json.loads(run['snapshot'])['balances']) == 4
    print(json.dumps({'verified_files': files, 'positions': len(snapshot['positions']),
                      'runs': len(snapshot['runs']), 'card_count': len(latest),
                      'total_cents': sum(row['balance_cents'] for row in latest.values()),
                      'low_count': sum(row['balance_cents'] < 4000 for row in latest.values()),
                      'successful_runs': sum(run['status'] == 'ok' for run in snapshot['runs']),
                      'error_runs': sum(run['status'] == 'error' for run in snapshot['runs']),
                      'sqlite_integrity': integrity, 'matches_sqlite': True,
                      'read_only_verification': True}))
