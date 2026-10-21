"""Read-only schema plan by default; --apply explicitly provisions additive fields."""
import argparse
import json
import os
from pathlib import Path
import sys
from xml.etree import ElementTree as ET

import requests

if os.getenv('ENERGETICA_BACKEND_TEST_ROOT'):
    sys.path.insert(0, str(Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT']) / 'worker'))
from contractor_employment import (SOURCE, TARGET, DATES, JSON_HEADERS, additional_fields,
    business_fields, list_fields, validate_field, _state_directory, supplier_lock, _checkpoint)
from contractor_permissions import read_acl, acl_hash, equivalent, mirror_permissions


def _exists(client, title):
    try:
        client._request('GET', client._list_endpoint(title), params={'$select': 'Title,EnableAttachments'})
        return True
    except requests.HTTPError as error:
        if error.response is not None and error.response.status_code == 404:
            return False
        raise


def _clone_xml(field):
    node = ET.fromstring(field['SchemaXml'])
    # Preserve field semantics (choices, dates, precision etc), not storage identity.
    for attr in ['ID', 'SourceID', 'ColName', 'RowOrdinal', 'Version', 'FromBaseType',
                 'Sealed', 'ReadOnly', 'Hidden']:
        node.attrib.pop(attr, None)
    node.set('Name', field['InternalName'])
    node.set('StaticName', field['InternalName'])
    node.set('DisplayName', field['Title'])
    return ET.tostring(node, encoding='unicode')


def provision(client, *, apply=False, state_store=None):
    if not apply:
        return _provision(client, apply=False)
    directory = _state_directory(client, state_store)
    with supplier_lock(directory, 'schema'):
        return _provision(client, apply=True, directory=directory)


def _provision(client, *, apply, directory=None):
    source_acl = read_acl(client, SOURCE)
    source = business_fields(list_fields(client, SOURCE))
    source_map = {f['InternalName']: f for f in source}
    additions = additional_fields()
    dates = [f for f in additions if f['InternalName'] in DATES]
    for date in dates:
        if date['InternalName'] in source_map:
            validate_field(source_map[date['InternalName']], date)
        else:
            source.append(date)
    exists = _exists(client, TARGET)
    target_acl = read_acl(client, TARGET) if exists else None
    target = {f['InternalName']: f for f in list_fields(client, TARGET)} if exists else {}
    expected = {f['InternalName']: f for f in [*source, *additions]}
    # Complete validation before the first mutation, even under --apply.
    for name, field in expected.items():
        if name in target:
            validate_field(target[name], field)
    actions = []
    if not exists:
        actions.append({'action': 'create_list', 'list': TARGET})
    if target_acl is None or not equivalent(source_acl, target_acl):
        actions.append({'action': 'mirror_permissions', 'list': TARGET})
    for field in dates:
        if field['InternalName'] not in source_map:
            actions.append({'action': 'create_field', 'list': SOURCE, 'field': field['InternalName']})
    for name, field in expected.items():
        if name not in target:
            # Standard Title exists on a newly created list.
            if name != 'Title' or exists:
                actions.append({'action': 'create_field', 'list': TARGET, 'field': name})
        if name == 'Title' and (not exists or target.get(name, {}).get('Title') != field['Title']):
            actions.append({'action': 'display_title', 'list': TARGET, 'field': name})
    if not apply:
        return {'applied': False, 'actions': actions, 'permissions_hash': acl_hash(source_acl)}
    checkpoint = directory / 'schema-list.json'
    if not exists and checkpoint.exists():
        raise RuntimeError('List identity unresolved; refusing another create')
    for action in actions:
        title = action['list']
        if action['action'] == 'create_list':
            if not _exists(client, TARGET):
                _checkpoint(checkpoint, {'phase': 'create_pending', 'list': TARGET})
                try:
                    client._request('POST', 'web/lists', json={'Title': TARGET,
                        'BaseTemplate': 100, 'EnableAttachments': True}, headers=JSON_HEADERS)
                except requests.RequestException:
                    if not _exists(client, TARGET):
                        raise RuntimeError('List creation uncertain; rerun plan before applying') from None
            continue
        if action['action'] == 'mirror_permissions':
            mirror_permissions(client, source=source_acl)
            continue
        name = action['field']
        desired = expected[name]
        endpoint = client._list_endpoint(title) + '/fields'
        # Re-read before each creation so retries never duplicate a field.
        present = {f['InternalName']: f for f in list_fields(client, title)}
        if action['action'] == 'display_title':
            client._request('POST', endpoint + "/getByInternalNameOrTitle('Title')",
                json={'Title': desired['Title']}, headers={**JSON_HEADERS,
                    'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE'})
        elif name not in present:
            try:
                client._request('POST', endpoint + '/createfieldasxml', json={
                    'parameters': {'SchemaXml': _clone_xml(desired), 'Options': 8}}, headers=JSON_HEADERS)
            except requests.RequestException:
                after = {f['InternalName']: f for f in list_fields(client, title)}
                if name not in after:
                    raise RuntimeError('Field creation uncertain; rerun plan before applying') from None
                validate_field(after[name], desired)
        else:
            validate_field(present[name], desired)
    remaining = provision(client)
    if remaining['actions']:
        raise RuntimeError('Provisioning not confirmed; rerun read-only plan')
    if read_acl(client, SOURCE) != source_acl:
        raise PermissionError('Source permission boundary changed during provisioning')
    return {'applied': True, 'actions': actions, 'permissions_hash': acl_hash(source_acl)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--dry-run', '--plan', action='store_true')
    args = parser.parse_args(argv)
    from sync_contractors import client_from_environment
    try:
        print(json.dumps(provision(client_from_environment(), apply=args.apply)))
    except Exception as error:
        print(json.dumps({'status': 'error', 'type': type(error).__name__}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
