"""Fixed Sicoob pipeline, shared by the schedule and authenticated manual queue."""
import contextlib
from datetime import date
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path('/var/lib/energetica-sicoob-movements')
CODE = Path('/opt/energetica-whatsapp/sicoob-movements')
PYTHON = '/opt/energetica-whatsapp/.venv/bin/python'
STAGES = (
    ('movements', (PYTHON, str(CODE / 'sync_movements.py'), 'scheduled')),
    ('boleto', (PYTHON, str(CODE / 'sync_boleto_receipts.py'))),
    ('pix', (PYTHON, str(CODE / 'sync_pix_receivers.py'))),
)


def parse_stage(stage, text, exit_code):
    """Require one complete collector result; never infer success from exit 0 alone."""
    if exit_code:
        raise ValueError('COLLECTOR_FAILED')
    try:
        value = json.loads(text)
    except (ValueError, TypeError):
        raise ValueError('INVALID_RECEIPT') from None
    if not isinstance(value, dict):
        raise ValueError('INVALID_RECEIPT')
    counts = {key: count for key, count in value.items() if key not in ('status', 'from', 'through')}
    if any(type(count) is not int or not 0 <= count <= 1000000 for count in counts.values()):
        raise ValueError('INVALID_COUNT')
    if stage == 'movements':
        if (set(value) != {'status', 'from', 'through', 'debits', 'excludedDebits', 'inserted', 'existing', 'unidentified'}
                or value['status'] != 'ok' or value['debits'] != value['inserted'] + value['existing']
                or value['unidentified'] > value['debits']):
            raise ValueError('INCOMPLETE_STATEMENT')
        if date.fromisoformat(value['from']) > date.fromisoformat(value['through']):
            raise ValueError('INVALID_PERIOD')
        return {'created': value['inserted'], 'updated': 0, 'verified': value['debits'], 'pendingDetails': 0}
    if stage == 'boleto':
        allowed = {'ambiguous_reference', 'already_attached', 'unverified_200', 'unverified_400', 'unverified_404', 'verified', 'names_recovered', 'attached'}
        if (set(value) - allowed or value.get('attached', 0) != value.get('verified', 0)
                or value.get('names_recovered', 0) > value.get('attached', 0)):
            raise ValueError('INCOMPLETE_RECEIPTS')
        pending = sum(value.get(key, 0) for key in ('ambiguous_reference', 'unverified_200', 'unverified_400', 'unverified_404'))
        return {'created': 0, 'updated': value.get('attached', 0), 'verified': 0, 'pendingDetails': pending}
    if stage == 'pix':
        allowed = {'pendentes', 'http_200', 'http_404', 'verificados', 'nomes_gravados'}
        if (set(value) - allowed or 'pendentes' not in value
                or value.get('nomes_gravados', 0) > value.get('verificados', 0)
                or value.get('verificados', 0) > value['pendentes']):
            raise ValueError('INCOMPLETE_PIX')
        return {'created': 0, 'updated': value.get('nomes_gravados', 0), 'verified': 0,
                'pendingDetails': value['pendentes'] - value.get('nomes_gravados', 0)}
    raise ValueError('INVALID_STAGE')


@contextlib.contextmanager
def pipeline_lock(root, heartbeat, timeout=2700, interval=5):
    import fcntl
    with (root / 'pipeline.lock').open('a+b') as lock:
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                heartbeat()
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('PIPELINE_BUSY') from None
                time.sleep(min(interval, remaining))
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def stop_process_group(process):
    if os.name == 'nt':
        process.kill()
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait()


def execute_stage(command, root, heartbeat, timeout=2400, interval=15):
    """Capture private output without pipe deadlock; reap the whole timed-out group."""
    env = {**os.environ, 'STATE_DIRECTORY': str(root), 'POWERSHELL_TELEMETRY_OPTOUT': '1'}
    with tempfile.TemporaryFile(dir=root) as out, tempfile.TemporaryFile(dir=root) as err:
        process = subprocess.Popen(command, stdout=out, stderr=err, env=env, start_new_session=True)
        deadline = time.monotonic() + timeout
        try:
            while process.poll() is None:
                heartbeat()
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('COLLECTOR_TIMEOUT')
                try:
                    process.wait(timeout=min(interval, remaining))
                except subprocess.TimeoutExpired:
                    pass
            if process.returncode:
                # A failed parent must not leave a banking subprocess running.
                stop_process_group(process)
            out.seek(0)
            raw = out.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise ValueError('OVERSIZED_RECEIPT')
            return raw.decode('utf-8', errors='strict'), process.returncode
        except BaseException:
            stop_process_group(process)
            raise


def collect(origin, heartbeat=lambda: None):
    result = {'status': 'succeeded', 'failed': 0, 'created': 0, 'updated': 0, 'verified': 0, 'pendingDetails': 0}
    try:
        with pipeline_lock(ROOT, heartbeat):
            deadline = time.monotonic() + 2400
            for stage, command in STAGES:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('PIPELINE_TIMEOUT')
                try:
                    text, code = execute_stage(command, ROOT, heartbeat, timeout=remaining)
                    counts = parse_stage(stage, text, code)
                    for key in ('created', 'updated', 'verified', 'pendingDetails'):
                        result[key] += counts[key]
                    print(json.dumps({'origin': origin, 'stage': stage, 'status': 'succeeded', **counts}), flush=True)
                except Exception as error:
                    result.update(status='failed', failed=1)
                    print(json.dumps({'origin': origin, 'stage': stage, 'status': 'failed', 'errorType': type(error).__name__}), flush=True)
    except Exception as error:
        # Errors and banking output can contain confidential data. Log safe classes only.
        result = {'status': 'failed', 'failed': 1}
        print(json.dumps({'origin': origin, **result, 'errorType': type(error).__name__}), flush=True)
    return result


def serve():
    import fcntl
    sys.path.insert(0, '/opt/energetica-whatsapp')
    from sicoob_sync import Queue
    queue = Queue()
    with (ROOT / 'request-worker.lock').open('a+b') as singleton:
        fcntl.flock(singleton, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with queue.locked() as state:
            for job in state['jobs'].values():
                if job['status'] == 'running':
                    job.update(status='failed', code='SYNC_INTERRUPTED', completedAt=time.time())
        queue.worker('heartbeat')
        next_heartbeat = time.monotonic() + 30
        while True:
            state = json.loads((queue.root / 'state.json').read_text())
            if any(job['status'] == 'queued' for job in state['jobs'].values()):
                claim = queue.worker('claim')
                if claim['job']:
                    receipt = collect('Manual', lambda: queue.worker('heartbeat'))
                    queue.worker('complete', {'requestId': claim['job']['requestId'], **receipt})
                continue
            if time.monotonic() >= next_heartbeat:
                queue.worker('heartbeat')
                next_heartbeat = time.monotonic() + 30
            time.sleep(2)


if __name__ == '__main__':
    if sys.argv[1:] == ['daemon']:
        serve()
    elif sys.argv[1:] == ['scheduled']:
        sys.exit(0 if collect('Scheduled')['status'] == 'succeeded' else 1)
    else:
        raise SystemExit('Fixed mode required')
