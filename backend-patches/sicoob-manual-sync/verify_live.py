"""Authorized internal smoke, not an HTTP bearer-token authentication test.

Reuses trusted server access and an existing request owner. No identity claims,
credentials, bank payloads or financial field values are printed or persisted.
The fixed verification request ID makes rerunning this command idempotent.
"""
import json
from pathlib import Path
import sys
import time
import uuid

sys.path.insert(0, '/opt/energetica-whatsapp')
from sicoob_sync import Queue, handle_portal


def trusted_identity(source, allowed):
    owners = {job.get('owner') for job in source['jobs'].values()}
    emails = {str(email).strip().lower() for email in allowed}
    if (len(owners) != 1 or len(emails) != 1
            or any(not isinstance(owner, str) or not owner.strip() for owner in owners)
            or not next(iter(emails), '')):
        raise RuntimeError('Unambiguous existing owner and allowlist required; no identity mapping guessed')
    return {'oid': next(iter(owners)), 'email': next(iter(emails))}


def main():
    queue = Queue()
    source = json.loads((queue.root.parent / 'dda-sync/state.json').read_text())
    allowed = json.loads((queue.root / 'access.json').read_text())['emails']
    identity = trusted_identity(source, allowed)
    print(json.dumps({'phase': 'trusted-access', 'distinctExistingOwners': 1, 'distinctAllowedEmails': 1}), flush=True)
    marker = queue.root / 'deployment-verification-20261111.json'
    if marker.exists():
        request_id = json.loads(marker.read_text())['requestId']
    else:
        request_id = uuid.uuid4().hex
        marker.write_text(json.dumps({'requestId': request_id}))
        marker.chmod(0o600)
    start_body = {'action': 'sicoob_refresh', 'requestId': request_id}
    first = handle_portal(identity, start_body, queue)['sicoobRefresh']
    print(json.dumps({'phase': 'start', **first}), flush=True)
    deadline = time.monotonic() + 1200
    previous = None
    while time.monotonic() < deadline:
        result = handle_portal(identity, {'action': 'sicoob_refresh_status', 'requestId': request_id}, queue)['sicoobRefresh']
        if result['status'] != previous:
            print(json.dumps({'phase': 'status', **result}), flush=True)
            previous = result['status']
        if result['status'] in ('succeeded', 'failed'):
            break
        time.sleep(3)
    else:
        raise RuntimeError('Verification timed out; request remains durable')
    with queue.locked() as state:
        before_count = len(state['jobs'])
        before_completed = state['jobs'][result['requestId']]['completedAt']
    repeated = handle_portal(identity, start_body, queue)['sicoobRefresh']
    assert repeated == result, 'Same-ID repeat changed the terminal receipt'
    with queue.locked() as state:
        assert len(state['jobs']) == before_count
        assert state['jobs'][result['requestId']]['completedAt'] == before_completed
    pending = handle_portal(identity, {'action': 'sicoob_refresh_status', 'mode': 'pending'}, queue)['sicoobRefresh']
    assert result in pending['requests'] or first['status'] in ('succeeded', 'failed')
    handle_portal(identity, {'action': 'sicoob_refresh_status', 'requestId': request_id, 'acknowledge': True}, queue)
    assert handle_portal(identity, start_body, queue)['sicoobRefresh'] == result
    print(json.dumps({'phase': 'verified', 'sameIdNoDuplicate': True, 'acknowledged': True, **result}), flush=True)
    return 0 if result['status'] == 'succeeded' else 1


if __name__ == '__main__':
    sys.exit(main())
