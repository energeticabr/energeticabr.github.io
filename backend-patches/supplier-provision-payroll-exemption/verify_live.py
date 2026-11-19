"""Read-only catalog verification. Never changes state or financial records."""
import argparse
import json
import os
from pathlib import Path
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--root', type=Path, default=Path('/opt/energetica-whatsapp'))
parser.add_argument('--provision-ids', nargs='+', type=int, required=True)
args = parser.parse_args()
sys.path[:0] = [str(args.root / 'worker'), str(args.root)]
from local_app import load_env
from clients import SharePointClient
from workflow import WorkflowEngine

load_env(Path('/etc/energetica-whatsapp.env'))
client = SharePointClient(
    os.environ['SHAREPOINT_HOST'], os.environ['SHAREPOINT_SITE_PATH'],
    os.environ['ENTRA_TENANT_ID'], os.environ['ENTRA_CLIENT_ID'],
    private_key_pem=Path(os.environ['ENTRA_PRIVATE_KEY_FILE']).read_text(),
    certificate_pem=Path(os.environ['ENTRA_CERTIFICATE_FILE']).read_text(),
    target_list='PROVISÃO PGTOS',
)
request = client._request


def read_only(method, endpoint, **kwargs):
    if method != 'GET':
        raise RuntimeError('Read-only verification rejected a mutation')
    return request(method, endpoint, **kwargs)


client._request = read_only
engine = WorkflowEngine.__new__(WorkflowEngine)
engine.sharepoint = client
results = []
for provision_id in args.provision_ids:
    fields = client.get_item_fields(provision_id, ['FORNECEDOR'], target_list='PROVISÃO PGTOS')
    supplier = fields.get('FORNECEDOR')
    if not supplier:
        raise RuntimeError('Provision has no supplier')
    state = {'fields': {'FORNECEDOR': supplier}}
    has_payroll = engine._supplier_has_payroll(state)
    if has_payroll:
        assert engine._supplier_pending_provision_ids(state, {}) == []
    results.append({'provision_id': provision_id, 'has_payroll': has_payroll,
                    'warning_exempt': has_payroll})
assert not engine._supplier_has_payroll({'fields': {'FORNECEDOR': '__QA_NONEXISTENT_SUPPLIER_20261119__'}})
print(json.dumps({'read_only': True, 'nonexistent_supplier_exempt': False, 'results': results}))
