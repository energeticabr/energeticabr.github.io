"""Synthetic legacy schema contract retained solely for the original tests.

No source list discovery, item writes, ACL access, grants or scope changes.
The operational wrapper constructs the existing SharePointClient directly.
"""
import requests

from contractor_employment import (TARGET, JSON_HEADERS, expected_fields, list_fields,
    validate_field, _state_directory, _checkpoint, supplier_lock)


def _metadata(client):
    try:
        payload = client._request('GET', client._list_endpoint(TARGET),
            params={'$select': 'Title,ItemCount,EnableAttachments'})
    except requests.HTTPError as error:
        if error.response is not None and error.response.status_code == 404:
            return None
        raise
    metadata = payload.get('d', payload)
    count = metadata.get('ItemCount')
    if type(count) is not int or count != 0:
        raise RuntimeError('Provisioning requires an empty target; existing records are preserved')
    if metadata.get('EnableAttachments') is not True:
        raise ValueError('Target must support registration attachments')
    return metadata


def _plan(client):
    exists = _metadata(client) is not None
    actual = {f['InternalName']: f for f in list_fields(client)} if exists else {}
    expected = expected_fields()
    for desired in expected:
        if desired['InternalName'] in actual:
            validate_field(actual[desired['InternalName']], desired)
    actions = []
    if not exists:
        actions.append({'action': 'create_list', 'list': TARGET})
    for desired in expected:
        name = desired['InternalName']
        if name not in actual and (exists or name != 'Title'):
            actions.append({'action': 'create_field', 'list': TARGET, 'field': name})
        if name == 'Title' and actual.get(name, {}).get('Title') != 'CADASTRO':
            actions.append({'action': 'display_title', 'list': TARGET, 'field': name})
    return {'applied': False, 'item_count': 0, 'actions': actions}


def provision(client, apply=False, state_store=None):
    """Dry-run is read-only. Apply never creates or modifies business records."""
    if not apply:
        return _plan(client)
    directory = _state_directory(client, state_store)
    with supplier_lock(directory, 'schema-future'):
        plan = _plan(client)  # Complete validation before the first mutation.
        checkpoint = directory / 'schema-future-list.json'
        if any(a['action'] == 'create_list' for a in plan['actions']):
            if checkpoint.exists():
                raise RuntimeError('Target list creation uncertain; refusing another POST')
            _checkpoint(checkpoint, {'phase': 'create_pending', 'list': TARGET})
            try:
                client._request('POST', 'web/lists', json={'Title': TARGET,
                    'BaseTemplate': 100, 'EnableAttachments': True}, headers=JSON_HEADERS)
            except requests.RequestException:
                if _metadata(client) is None:
                    raise RuntimeError('Target list creation uncertain; rerun read-only plan') from None
            if _metadata(client) is None:
                raise RuntimeError('Target list creation not confirmed')
            _checkpoint(checkpoint, {'phase': 'linked', 'list': TARGET})
        desired_fields = {f['InternalName']: f for f in expected_fields()}
        for action in plan['actions']:
            if action['action'] == 'create_list':
                continue
            _metadata(client)  # Do not continue schema changes if records appeared.
            name = action['field']
            desired = desired_fields[name]
            endpoint = client._list_endpoint(TARGET) + '/fields'
            present = {f['InternalName']: f for f in list_fields(client)}
            if action['action'] == 'display_title':
                client._request('POST', endpoint + "/getByInternalNameOrTitle('Title')",
                    json={'Title': 'CADASTRO'}, headers={**JSON_HEADERS,
                        'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE'})
            elif name not in present:
                try:
                    client._request('POST', endpoint + '/createfieldasxml', json={
                        'parameters': {'SchemaXml': desired['SchemaXml'], 'Options': 8}}, headers=JSON_HEADERS)
                except requests.RequestException:
                    after = {f['InternalName']: f for f in list_fields(client)}
                    if name not in after:
                        raise RuntimeError('Target field creation uncertain; rerun read-only plan') from None
                    validate_field(after[name], desired)
            else:
                validate_field(present[name], desired)
        if _plan(client)['actions']:
            raise RuntimeError('Explicit target schema not confirmed')
        return {**plan, 'applied': True}
