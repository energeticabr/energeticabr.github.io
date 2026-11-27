"""Validate and install the SharePoint decimal readback patch on both backend roots."""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen

ROOTS = (Path('/opt/energetica-whatsapp'), Path('/home/opc/energetica-build'))
SOURCE = Path('worker/clients.py')
BASELINE = '00e1fc61d6ae396e8f02d1bdcde52ce8b4179a296c167661516a4e17f55b119b'
LOCK = Path('/tmp/energetica-whatsapp-deploy.lock')
SERVICES = ('energetica-channel-bridge', 'energetica-whatsapp')
PATCH_DIR = Path(__file__).resolve().parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def candidate(data):
    anchor = b'def _localized_decimal(value) -> Decimal | None:\n'
    addition = (
        b'    # JSON numbers may use scientific notation after decoding to float.\n'
        b'    # Keep the localized parser below for user-entered strings.\n'
        b'    if isinstance(value, (float, Decimal)):\n'
        b'        number = Decimal(str(value))\n'
        b'        return number if number.is_finite() else None\n'
    )
    if data.count(anchor) != 1:
        raise RuntimeError('SharePoint decimal parser anchor changed')
    return data.replace(anchor, anchor + addition)


def replace(path, data, metadata):
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.' + path.name + '.', delete=False) as temp:
        staged = Path(temp.name)
    try:
        with staged.open('wb') as output:
            output.write(data)
            os.fchown(output.fileno(), metadata.st_uid, metadata.st_gid)
            os.fchmod(output.fileno(), stat.S_IMODE(metadata.st_mode))
            output.flush()
            os.fsync(output.fileno())
        staged.replace(path)
    finally:
        staged.unlink(missing_ok=True)


def restart():
    subprocess.run(['systemctl', 'restart', *SERVICES], check=True)
    for attempt in range(60):
        try:
            with urlopen('http://127.0.0.1:8765/health', timeout=2) as response:
                if json.load(response).get('status') != 'ok':
                    raise RuntimeError('Unhealthy channel bridge')
            with urlopen('http://127.0.0.1:8080/health', timeout=2) as response:
                if response.read().strip() != b'ok':
                    raise RuntimeError('Unhealthy WhatsApp worker')
            active = subprocess.check_output(['systemctl', 'is-active', *SERVICES], text=True)
            if active.splitlines() != ['active'] * len(SERVICES):
                raise RuntimeError('Some backend services are inactive')
            return
        except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError):
            time.sleep(1)
    raise RuntimeError('Backend health did not recover')


def deploy(apply):
    files = [root / SOURCE for root in ROOTS]
    originals = {path: path.read_bytes() for path in files}
    for path, contents in originals.items():
        if digest(contents) != BASELINE:
            raise RuntimeError(f'Unexpected baseline at {path}')
    updated = candidate(originals[files[0]])
    compile(updated, str(SOURCE), 'exec')
    with tempfile.TemporaryDirectory(prefix='decimal-readback-candidate-') as directory:
        proposed = Path(directory) / SOURCE.name
        proposed.write_bytes(updated)
        env = {**os.environ, 'CLIENT_SOURCE': str(proposed)}
        for test in ('test_decimal_readback.py', 'test_dates.py'):
            subprocess.run([sys.executable, '-B', str(PATCH_DIR / test), '-v'], env=env, check=True)
    report = {'status': 'checked', 'paths': [str(path) for path in files],
              'before': BASELINE, 'after': digest(updated)}
    if not apply:
        return report

    backup = ROOTS[0] / 'backups' / datetime.now(timezone.utc).strftime('decimal-readback-%Y%m%dT%H%M%SZ')
    backup.mkdir(mode=0o700)
    installed = {}
    try:
        for index, path in enumerate(files):
            if path.read_bytes() != originals[path]:
                raise RuntimeError(f'Concurrent source change at {path}')
            metadata = path.stat()
            (backup / f'clients-{index}.py').write_bytes(originals[path])
            replace(path, updated, metadata)
            installed[path] = metadata
        restart()
    except BaseException:
        for path, metadata in reversed(list(installed.items())):
            if path.read_bytes() != updated:
                raise RuntimeError(f'Concurrent source change prevents rollback at {path}')
            replace(path, originals[path], metadata)
        if installed:
            restart()
        raise

    report.update(status='deployed', backup=str(backup), health='ok')
    (backup / 'receipt.json').write_text(json.dumps(report, indent=2))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    operation = parser.add_mutually_exclusive_group(required=True)
    operation.add_argument('--check', action='store_true')
    operation.add_argument('--apply', action='store_true')
    options = parser.parse_args()
    fd = os.open(LOCK, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as lock:
        metadata = os.fstat(lock.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_uid != 0:
            raise RuntimeError('Unexpected shared backend deployment lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(deploy(options.apply)))
