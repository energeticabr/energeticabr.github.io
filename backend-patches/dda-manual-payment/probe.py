"""Read-only SharePoint schema and fixed-list access preflight; never prints rows."""
import json
import os
import sys
from pathlib import Path


def main():
    sys.path.insert(0, '/opt/energetica-whatsapp')
    from local_app import load_env
    from clients import SharePointClient
    from dda_manual_payment import load_scope, SharePointRepository
    scope = load_scope(Path(__file__).parent / 'scope.json')
    load_env(Path('/etc/energetica-whatsapp.env'))
    client = SharePointClient(scope['siteHost'], scope['sitePath'], os.environ['ENTRA_TENANT_ID'],
        os.environ['ENTRA_CLIENT_ID'], Path(os.environ['ENTRA_PRIVATE_KEY_FILE']).read_text(),
        Path(os.environ['ENTRA_CERTIFICATE_FILE']).read_text(), 'DDAS SICOOB')
    base = f"web/lists(guid'{scope['listId']}')"
    required = {'PGTO_CONFIRMADO': 'Boolean', 'PGTO_CONFIRMADO_EM': 'DateTime', 'PGTO_CONFIRMADO_POR': 'Text'}
    for name, kind in required.items():
        field = client._request('GET', base + f"/fields/getbyinternalnameortitle('{name}')",
            params={'$select': 'InternalName,TypeAsString,DefaultValue'})
        if field.get('InternalName') != name or field.get('TypeAsString') != kind:
            raise RuntimeError('DDA schema mismatch')
        if kind == 'Boolean' and str(field.get('DefaultValue')) != '0':
            raise RuntimeError('DDA default mismatch')
    sample = client._request('GET', base + '/items', params={'$top': 1, '$select': 'Id'})
    values = sample.get('value', [])
    if values:
        row = SharePointRepository(client, scope).read(values[0]['Id'])
        if not row.get('_etag') or row['_etag'] == '*':
            raise RuntimeError('DDA ETag unavailable')
    print(json.dumps({'schemaVerified': True, 'readAccessVerified': True, 'etagVerified': bool(values), 'itemsModified': 0}))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'status': 'failed', 'errorType': type(exc).__name__,
            'httpStatus': getattr(getattr(exc, 'response', None), 'status_code', None)}))
        sys.exit(1)
