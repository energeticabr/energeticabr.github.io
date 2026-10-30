"""Owner-scoped durable requests for the fixed three-source fiscal collector."""
import contextlib
import copy
import json
import os
import re
import secrets
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/var/lib/energetica-whatsapp/sefaz-sync')
SOURCES = ('NFE', 'CTE', 'NFSE')
TERMINAL = {'succeeded', 'partial', 'failed'}
SOURCE_TERMINAL = {'succeeded', 'failed'}
CODES = {'COOLDOWN', 'WORKER_UNAVAILABLE', 'SYNC_FAILED', 'DELIVERY_PENDING', 'BUSY', 'INCOMPLETE'}
LEASE_SECONDS = 1200
MAX_REQUEST_SECONDS = 86400


def utc(stamp):
    return datetime.fromtimestamp(stamp, timezone.utc).isoformat()


def timestamp(value):
    if not isinstance(value, str) or len(value) > 40:
        raise ValueError('Invalid timestamp')
    match = re.fullmatch(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})', value)
    if not match: raise ValueError('Invalid ISO timestamp')
    # Python 3.9 accepts only 3/6 fraction digits; .NET emits seven. Truncate
    # the sub-microsecond digit, and pad other valid precisions to six digits.
    fraction = '.' + match[2][:6].ljust(6, '0') if match[2] else ''
    zone = '+00:00' if match[3] == 'Z' else match[3]
    parsed = datetime.fromisoformat(match[1] + fraction + zone)
    return parsed.timestamp()


class Queue:
    def __init__(self, root=ROOT, clock=time.time):
        self.root, self.clock = Path(root), clock

    @contextlib.contextmanager
    def locked(self):
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        with (self.root / 'lock').open('a+b') as lock:
            if os.name == 'nt':
                import msvcrt
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                path = self.root / 'state.json'
                state = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {
                    'version': 1, 'heartbeat': 0, 'jobs': {}, 'aliases': {}}
                if state.get('version') != 1 or not isinstance(state.get('jobs'), dict) or not isinstance(state.get('aliases'), dict):
                    raise ValueError('Invalid fiscal queue state')
                self.recover(state)
                yield state
                temporary = self.root / 'state.tmp'
                with temporary.open('w', encoding='utf-8') as output:
                    os.chmod(temporary, 0o600)
                    json.dump(state, output, ensure_ascii=True, allow_nan=False)
                    output.flush(); os.fsync(output.fileno())
                os.replace(temporary, path)
                if os.name != 'nt':
                    directory = os.open(self.root, os.O_RDONLY)
                    try: os.fsync(directory)
                    finally: os.close(directory)
            finally:
                if os.name == 'nt':
                    lock.seek(0); msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(lock, fcntl.LOCK_UN)

    def recover(self, state):
        now = self.clock()
        for job in state['jobs'].values():
            if job['status'] in TERMINAL:
                continue
            if now - job['createdAt'] >= MAX_REQUEST_SECONDS:
                for source in SOURCES:
                    if job['sources'][source]['status'] not in SOURCE_TERMINAL:
                        job['sources'][source].update(status='failed', code='INCOMPLETE')
                        job['sources'][source].pop('nextAllowedAt', None)
                        if job['sources'][source].get('createdItemIds') == []:
                            job['sources'][source].pop('createdItemIds')
                job['leaseUntil'] = 0
            elif job.get('leaseUntil', 0) <= now:
                job['leaseUntil'] = 0
                for result in job['sources'].values():
                    if result['status'] == 'running':
                        result.update(status='waiting', code='INCOMPLETE')
                        if result.get('createdItemIds') == []:
                            result.pop('createdItemIds')
                    if now - state['heartbeat'] > 180 and result['status'] == 'queued':
                        result.update(status='waiting', code='WORKER_UNAVAILABLE')
            self.derive(job)

    def derive(self, job):
        statuses = [job['sources'][source]['status'] for source in SOURCES]
        if all(status in SOURCE_TERMINAL for status in statuses):
            job['status'] = 'succeeded' if all(x == 'succeeded' for x in statuses) else (
                'partial' if 'succeeded' in statuses else 'failed')
            job.setdefault('completedUtc', utc(self.clock()))
        elif job.get('leaseUntil', 0) > self.clock():
            job['status'] = 'running'
        elif 'waiting' in statuses:
            job['status'] = 'waiting'
        else:
            job['status'] = 'queued'

    def authorize(self, identity):
        # Only the authenticated /portal/chat hook calls this boundary. Graph
        # authentication and the portal's Member/domain policy already ran.
        # Do not add a separate owner allowlist or accept identity from body.
        if not isinstance(identity, dict):
            raise PermissionError('Consulta fiscal não autorizada para este usuário.')
        oid, email = identity.get('oid'), identity.get('email')
        if (not isinstance(oid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', oid)
                or not isinstance(email, str) or len(email) > 320
                or not re.fullmatch(r'[^\s@*\x00-\x1f\x7f]+@[^\s@*\x00-\x1f\x7f]+\.[^\s@*\x00-\x1f\x7f]+', email)):
            raise PermissionError('Consulta fiscal não autorizada para este usuário.')
        return identity['oid']

    @staticmethod
    def validate_id(request_id):
        if not isinstance(request_id, str) or not re.fullmatch('[a-f0-9]{32}', request_id):
            raise ValueError('Pedido fiscal inválido.')

    @staticmethod
    def public(job):
        return copy.deepcopy({key: job[key] for key in ('requestId', 'status', 'startedUtc', 'completedUtc', 'sources') if key in job})

    @staticmethod
    def find(state, owner, request_id):
        canonical = state['aliases'].get(request_id, request_id)
        job = state['jobs'].get(canonical)
        if job and job['owner'] != owner:
            raise PermissionError('Pedido fiscal indisponível para esta sessão.')
        return job

    def start(self, identity, request_id):
        owner = self.authorize(identity)
        self.validate_id(request_id)
        with self.locked() as state:
            previous = self.find(state, owner, request_id)
            if previous:
                return self.public(previous)
            for job in state['jobs'].values():
                if job['owner'] == owner and job['status'] not in TERMINAL:
                    state['aliases'][request_id] = job['requestId']
                    return self.public(job)
            offline = self.clock() - state['heartbeat'] > 180
            source = {'status': 'waiting', 'code': 'WORKER_UNAVAILABLE', 'documents': 0} if offline else {'status': 'queued', 'documents': 0}
            job = {'requestId': request_id, 'owner': owner, 'createdAt': self.clock(),
                   'startedUtc': utc(self.clock()), 'status': 'waiting' if offline else 'queued',
                   'sources': {name: dict(source) for name in SOURCES}}
            state['jobs'][request_id] = job
            return self.public(job)

    def status(self, identity, request_id):
        owner = self.authorize(identity)
        self.validate_id(request_id)
        with self.locked() as state:
            job = self.find(state, owner, request_id)
            if not job:
                raise PermissionError('Pedido fiscal indisponível para esta sessão.')
            return self.public(job)

    def pending(self, identity):
        owner = self.authorize(identity)
        with self.locked() as state:
            return {'status': 'pending', 'requests': [self.public(job) for job in sorted(
                state['jobs'].values(), key=lambda item: item['createdAt'])
                if job['owner'] == owner and not job.get('acknowledgedAt')]}

    def acknowledge(self, identity, request_id):
        owner = self.authorize(identity)
        self.validate_id(request_id)
        with self.locked() as state:
            job = self.find(state, owner, request_id)
            if not job:
                raise PermissionError('Pedido fiscal indisponível para esta sessão.')
            if job['status'] not in TERMINAL:
                raise ValueError('Pedido fiscal ainda não concluído.')
            job.setdefault('acknowledgedAt', self.clock())
            return {'status': 'acknowledged', 'requestId': job['requestId']}

    @staticmethod
    def result(value):
        if not isinstance(value, dict) or not {'status'} <= set(value) <= {'status', 'documents', 'code', 'nextAllowedAt', 'createdItemIds'}:
            raise ValueError('Invalid source result')
        if value['status'] not in {'queued', 'running', 'waiting', 'succeeded', 'failed'}:
            raise ValueError('Invalid source status')
        if 'documents' in value and (type(value['documents']) is not int or not 0 <= value['documents'] <= 1000000):
            raise ValueError('Invalid document count')
        if 'code' in value and value['code'] not in CODES:
            raise ValueError('Invalid source code')
        if 'nextAllowedAt' in value:
            timestamp(value['nextAllowedAt'])
            if value['status'] != 'waiting':
                raise ValueError('Only waiting sources may specify retry time')
        if value['status'] == 'succeeded' and ('code' in value or 'nextAllowedAt' in value):
            raise ValueError('Success cannot include failure or cooldown')
        result = copy.deepcopy(value)
        if 'createdItemIds' in result:
            ids = result['createdItemIds']
            if not isinstance(ids, list) or any(type(item) is not int or not 0 < item <= 9007199254740991 for item in ids):
                raise ValueError('Invalid created SharePoint item IDs')
            result['createdItemIds'] = list(dict.fromkeys(ids))
        return result

    def worker(self, operation, payload=None):
        payload = {} if payload is None else payload
        expected = {'requestId', 'leaseToken'}
        if operation == 'progress': expected = expected | {'source', 'result'}
        if operation in {'heartbeat', 'claim'}: expected = set()
        if operation not in {'heartbeat', 'claim', 'renew', 'progress', 'complete'} or not isinstance(payload, dict) or set(payload) != expected:
            raise ValueError('Invalid fiscal worker operation')
        if expected:
            self.validate_id(payload['requestId'])
            if not isinstance(payload['leaseToken'], str) or not re.fullmatch('[a-f0-9]{64}', payload['leaseToken']):
                raise ValueError('Invalid worker lease')
        if operation == 'progress':
            if payload['source'] not in SOURCES: raise ValueError('Invalid fiscal source')
            result = self.result(payload['result'])
        with self.locked() as state:
            now = self.clock()
            state['heartbeat'] = now
            if operation == 'heartbeat': return {'ok': True}
            if operation == 'claim':
                if any(job.get('leaseUntil', 0) > now and job['status'] not in TERMINAL for job in state['jobs'].values()):
                    return {'job': None}
                for job in sorted(state['jobs'].values(), key=lambda item: item['createdAt']):
                    if job['status'] in TERMINAL: continue
                    eligible = [value for value in job['sources'].values() if value['status'] not in SOURCE_TERMINAL
                                and ('nextAllowedAt' not in value or timestamp(value['nextAllowedAt']) <= now)]
                    if not eligible: continue
                    job.update(leaseToken=secrets.token_hex(32), leaseUntil=now + LEASE_SECONDS)
                    job.pop('releasedToken', None)
                    for value in eligible:
                        if value.get('code') == 'WORKER_UNAVAILABLE':
                            value.pop('code', None); value['status'] = 'queued'
                    self.derive(job)
                    return {'job': {**self.public(job), 'leaseToken': job['leaseToken'], 'leaseUntil': utc(job['leaseUntil'])}}
                return {'job': None}
            job = state['jobs'].get(payload['requestId'])
            if not job or not secrets.compare_digest(job.get('leaseToken', ''), payload['leaseToken']):
                raise ValueError('Stale fiscal worker lease')
            if operation == 'progress':
                previous = job['sources'][payload['source']]
                if previous.get('createdItemIds') or ('createdItemIds' in previous and 'createdItemIds' in result):
                    result['createdItemIds'] = list(dict.fromkeys(previous['createdItemIds'] + result.get('createdItemIds', [])))
            duplicate_complete = operation == 'complete' and job.get('releasedToken') == payload['leaseToken']
            duplicate_progress = operation == 'progress' and job['sources'][payload['source']] == result
            if job.get('leaseUntil', 0) <= now and not duplicate_complete and not duplicate_progress:
                raise ValueError('Expired fiscal worker lease')
            if operation == 'renew':
                if job['status'] in TERMINAL: raise ValueError('Fiscal request already completed')
                job['leaseUntil'] = now + LEASE_SECONDS
                return {'ok': True, 'leaseUntil': utc(job['leaseUntil'])}
            if operation == 'progress':
                previous = job['sources'][payload['source']]
                if previous['status'] in SOURCE_TERMINAL and previous != result:
                    raise ValueError('Completed source cannot change')
                job['sources'][payload['source']] = result
            else:
                job['releasedToken'] = payload['leaseToken']
                job['leaseUntil'] = 0
                for value in job['sources'].values():
                    if value['status'] == 'running': value.update(status='waiting', code='INCOMPLETE')
            self.derive(job)
            return {'ok': True, 'job': self.public(job)}


def handle_portal(identity, body, queue=None):
    queue = queue or Queue()
    if not isinstance(body, dict): raise ValueError('Pedido fiscal inválido.')
    action = body.get('action')
    if action == 'sefaz_refresh' and set(body) == {'action', 'requestId'}:
        result = queue.start(identity, body['requestId'])
    elif action == 'sefaz_refresh_status' and set(body) == {'action', 'requestId'}:
        result = queue.status(identity, body['requestId'])
    elif action == 'sefaz_refresh_status' and set(body) == {'action', 'mode'} and body['mode'] == 'pending':
        result = queue.pending(identity)
    elif action == 'sefaz_refresh_status' and set(body) == {'action', 'requestId', 'acknowledge'} and body['acknowledge'] is True:
        result = queue.acknowledge(identity, body['requestId'])
    else:
        raise ValueError('Pedido fiscal inválido.')
    return {'status': 'processed', 'messages': [], 'sefazRefresh': result}


def main():
    try:
        operation = sys.argv[1] if len(sys.argv) == 2 else ''
        raw = sys.stdin.buffer.read(65537) if operation in {'renew', 'progress', 'complete'} else b''
        if len(raw) > 65536: raise ValueError('Worker payload too large')
        payload = json.loads(raw) if raw else None
        print(json.dumps(Queue().worker(operation, payload)))
    except Exception:
        print('{"ok":false,"code":"WORKER_COMMAND_FAILED"}')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
