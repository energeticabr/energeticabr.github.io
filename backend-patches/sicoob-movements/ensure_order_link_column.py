"""Provision the optional order ID without modifying any payment records."""
import argparse
import json
from xml.etree import ElementTree

from sync_movements import LIST, LIST_ID, sharepoint_client

FIELD = 'IDPEDIDO'


def ensure_order_link_column(client, apply=False):
    if client._list_id(LIST).lower() != LIST_ID:
        raise RuntimeError('Unexpected financial movement list')
    endpoint = client._list_endpoint(LIST) + '/fields'

    def columns():
        payload = client._request('GET', endpoint, params={
            '$select': 'InternalName,Title,TypeAsString,ReadOnlyField,Required,SchemaXml',
            '$filter': "InternalName eq 'IDPEDIDO'", '$top': '2',
        })
        return client._values(payload)

    existing = columns()
    created = False
    if not existing:
        if not apply:
            return {'field': FIELD, 'status': 'missing', 'applied': False}
        schema = ElementTree.Element('Field', {
            'Type': 'Number', 'Name': FIELD, 'StaticName': FIELD,
            'DisplayName': 'Pedido vinculado', 'Decimals': '0', 'Min': '1',
            'Required': 'FALSE',
        })
        client._request('POST', endpoint + '/createfieldasxml', json={
            'parameters': {
                'SchemaXml': ElementTree.tostring(schema, encoding='unicode'),
                'Options': 8,  # AddFieldInternalNameHint preserves IDPEDIDO.
            },
        })
        created = True
        existing = columns()
    if len(existing) != 1:
        raise RuntimeError('Order link column was not confirmed')
    field = existing[0]
    schema = ElementTree.fromstring(field.get('SchemaXml') or '<Field/>')
    if (field.get('InternalName') != FIELD or field.get('TypeAsString') != 'Number'
            or field.get('ReadOnlyField') or field.get('Required')
            or schema.get('Decimals') != '0'):
        raise RuntimeError('Incompatible order link column; no existing field was changed')
    return {'field': FIELD, 'status': 'created' if created else 'ready',
            'type': 'Number', 'decimals': 0, 'required': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(json.dumps(ensure_order_link_column(sharepoint_client(), args.apply)))
