"""Read-only live contract check; prints counts/schema, never record values."""
import json
import os
from pathlib import Path
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

PRODUCTION = Path('/opt/energetica-whatsapp')
STAGE = Path('/home/opc/grouped-provision-settlement-20261011-v5')


def main():
    source = PRODUCTION if '--production' in sys.argv else STAGE / 'candidate'
    for path in reversed((source / 'worker', PRODUCTION / 'worker', PRODUCTION)):
        sys.path.insert(0, str(path))
    # Same loader semantics as the service; no credentials are emitted.
    for raw in Path('/etc/energetica-whatsapp.env').read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if line and not line.startswith('#') and '=' in line:
            name, value = line.split('=', 1)
            os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))
    from clients import SharePointClient
    from provision_description_settlement import group_snapshot, PARENT_FIELDS
    client = SharePointClient(os.environ['SHAREPOINT_HOST'], os.environ['SHAREPOINT_SITE_PATH'],
        os.environ['ENTRA_TENANT_ID'], os.environ['ENTRA_CLIENT_ID'],
        Path(os.environ['ENTRA_PRIVATE_KEY_FILE']).read_text(encoding='utf-8'),
        Path(os.environ['ENTRA_CERTIFICATE_FILE']).read_text(encoding='utf-8'), 'DESCRITIVOPROVISAO')
    request = client._request
    def read_only(method, endpoint, **kwargs):
        if method != 'GET':
            raise RuntimeError('Read-only verification refused a SharePoint write')
        return request(method, endpoint, **kwargs)
    client._request = read_only
    groups = client.get_pending_provision_descriptions()
    snapshot = group_snapshot(groups, datetime.now(ZoneInfo('America/Sao_Paulo')).date())
    valid = [group for group in groups if not group.get('settlementBlocked')]
    etag_confirmed = False
    fresh_confirmed = False
    if valid:
        parent = valid[0]
        fields, etag = client.get_item_fields_with_etag(parent['Id'], PARENT_FIELDS, target_list='DESCRITIVOPROVISAO')
        etag_confirmed = bool(etag and etag != '*' and len(fields) == len(PARENT_FIELDS))
        fresh = client.get_provision_description(parent['Id'])
        fresh_confirmed = (fresh['VALOR TOTAL DESCRITIVO'] == parent['VALOR TOTAL DESCRITIVO']
            and [item['Id'] for item in fresh['CHILDREN']] == [item['Id'] for item in parent['CHILDREN']])
    schema = client._request('GET', client._list_endpoint('DESCRITIVOPROVISAO') + '/fields',
        params={'$select':'Title,InternalName,TypeAsString', '$top':'5000'})
    payment_types = {row['InternalName']: row['TypeAsString'] for row in client._values(schema)
        if row.get('InternalName') in {'PGTOAGENDADO', 'DATAPGTOEFETUADO', 'DATAPREVISTOPGTO', 'STATUS'}}
    print(json.dumps({'status':'verified-read-only', 'sourceKind':snapshot['sourceKind'],
        'pendingGroups':len(groups), 'validGroups':len(valid), 'blockedGroups':len(groups)-len(valid),
        'dueGroups':len(snapshot['rows']), 'canonicalParentReadWithETag':etag_confirmed,
        'freshGroupReadMatches':fresh_confirmed, 'parentFieldTypes':payment_types,
        'financialWrites':0}, ensure_ascii=False))
    if valid and not (etag_confirmed and fresh_confirmed):
        raise RuntimeError('Live contract changed during read-only verification')


if __name__ == '__main__':
    main()
