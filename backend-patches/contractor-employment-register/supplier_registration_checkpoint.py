"""Single-POST supplier registration, durable even if its response is lost."""
import hashlib
import json
import re
import secrets

try:
    from .contractor_employment import SOURCE, JSON_HEADERS, collection, _positive_id, _state_directory, _checkpoint, supplier_lock
except ImportError:
    from contractor_employment import SOURCE, JSON_HEADERS, collection, _positive_id, _state_directory, _checkpoint, supplier_lock


def start_future_flow(client, token, *, state_store=None):
    """Called only when opening a genuinely NEW registration, never migration."""
    if not isinstance(token, str) or not token or len(token) > 255:
        raise ValueError('Invalid supplier submission identity')
    directory = _state_directory(client, state_store)
    flow_id = secrets.token_hex(16)
    _checkpoint(directory / f'flow-{flow_id}.json', {'version': 1, 'flow_id': flow_id,
        'token_hash': hashlib.sha256(token.encode('utf-8')).hexdigest()})
    return flow_id


def _flow_marker(directory, flow_id, token):
    if not isinstance(flow_id, str) or not re.fullmatch('[0-9a-f]{32}', flow_id):
        return None
    path = directory / f'flow-{flow_id}.json'
    marker = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    if marker == {'version': 1, 'flow_id': flow_id,
                  'token_hash': hashlib.sha256(token.encode('utf-8')).hexdigest()}:
        return marker
    return None


def future_receipt(client, supplier_id, flow_id, *, state_store=None):
    if not flow_id:
        return None
    try:
        from .contractor_employment import submission_proof
    except ImportError:
        from contractor_employment import submission_proof
    return submission_proof(client, supplier_id, state_store=state_store, flow_id=flow_id)


def ensure_supplier(client, token, fields, *, state_store=None, future_flow_id=None):
    if not isinstance(token, str) or not token or len(token) > 255:
        raise ValueError('Invalid supplier submission identity')
    directory = _state_directory(client, state_store)
    identity = 'source-' + hashlib.sha256(token.encode('utf-8')).hexdigest()
    with supplier_lock(directory, identity):
        path = directory / (identity + '.json')
        checkpoint = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
        if checkpoint and (checkpoint.get('token') != token or checkpoint.get('phase') not in {'create_pending', 'linked'}):
            raise RuntimeError('Invalid supplier creation checkpoint')
        internal = client._internal_field(SOURCE, '__PowerAppsId__')
        endpoint = client._list_endpoint(SOURCE) + '/items'
        def lookup():
            rows = collection(client, endpoint, {'$select': 'Id,' + internal,
                '$filter': internal + " eq '" + token.replace("'", "''") + "'", '$top': '2'})
            if len(rows) > 1:
                raise RuntimeError('Duplicate supplier submission identity requires reconciliation')
            return _positive_id(rows[0]['Id']) if rows else None
        item_id = lookup()
        if item_id is None and checkpoint.get('item_id') is not None:
            item_id = _positive_id(checkpoint['item_id'])
            row = client._request('GET', endpoint + '(' + str(item_id) + ')')
            row = row.get('d', row)
            if _positive_id(row.get('Id')) != item_id or row.get(internal) != token:
                raise RuntimeError('Supplier creation receipt was not confirmed')
        if item_id is None and checkpoint:
            raise RuntimeError('Supplier creation outcome unknown; reconcile before retrying')
        if item_id is None:
            payload = {**client._target_payload(fields, SOURCE), internal: token}
            marker = _flow_marker(directory, future_flow_id, token)
            checkpoint = {'phase': 'create_pending', 'token': token}
            if marker:
                checkpoint['future_flow_id'] = marker['flow_id']
            _checkpoint(path, checkpoint)
            try:
                created = client._request('POST', endpoint, json=payload, headers=JSON_HEADERS)
                item_id = _positive_id(created.get('d', created)['Id'])
            except Exception:
                # The POST may have been accepted; an empty GET cannot authorize
                # another POST, including when a new worker handles the retry.
                item_id = lookup()
                if item_id is None:
                    raise RuntimeError('Supplier creation outcome unknown; reconcile before retrying') from None
        # Only the marker frozen BEFORE the FIRST new POST is authoritative.
        # A token lookup or old uncertain checkpoint never gains this flag.
        marker = _flow_marker(directory, checkpoint.get('future_flow_id'), token)
        linked = {**checkpoint, 'phase': 'linked', 'token': token, 'item_id': item_id}
        _checkpoint(path, linked)
        if marker:
            _checkpoint(directory / f'submission-{item_id}.json', {
                **marker, 'supplier_id': item_id})
        return item_id
