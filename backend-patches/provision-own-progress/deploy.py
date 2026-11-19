"""Validate and atomically install the shared settlement race correction."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from urllib.request import urlopen

from patch_backend import PATCHES

STAGE = Path(__file__).resolve().parent
ROOTS = (Path('/opt/energetica-whatsapp'), Path('/home/opc/energetica-build'))


def sha(data): return hashlib.sha256(data).hexdigest()


def atomic(path, data, metadata):
    fd, name = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, metadata.st_mode)
        os.chown(name, metadata.st_uid, metadata.st_gid)
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)


def healthy():
    for port in (8765, 8080):
        with urlopen('http://127.0.0.1:%s/health' % port, timeout=5) as response:
            assert response.status == 200


def restart():
    subprocess.run(['systemctl', 'restart', 'energetica-channel-bridge', 'energetica-whatsapp'], check=True)
    for _ in range(120):
        try: healthy(); return
        except Exception: time.sleep(1)
    raise RuntimeError('Shared backend did not recover')


def main():
    plan = []
    for root in ROOTS:
        for name, patch in PATCHES.items():
            path = root / 'worker' / name
            before = path.read_bytes()
            newline = '\r\n' if b'\r\n' in before else '\n'
            after = patch(before.decode().replace('\r\n', '\n')).replace('\n', newline).encode()
            compile(after, str(path), 'exec')
            plan.append((path, before, after, path.stat()))
        path = root / 'worker' / 'settlement_own_progress.py'
        assert not path.exists(), 'Helper already exists; inspect deployment before retrying'
        data = (STAGE / path.name).read_bytes()
        compile(data, str(path), 'exec')
        plan.append((path, None, data, (root / 'worker' / 'provision_description_settlement.py').stat()))
    with tempfile.TemporaryDirectory(prefix='baixa-own-progress-') as temp:
        candidate = Path(temp)
        (candidate / 'worker').mkdir()
        for path, before, after, metadata in plan[:4]:
            (candidate / 'worker' / path.name).write_bytes(after)
        env = {**os.environ, 'ENERGETICA_BACKEND_TEST_ROOT': str(candidate),
               'PYTHONPATH': ':'.join(map(str, (candidate/'worker', ROOTS[0]/'worker', ROOTS[0])))}
        for name in ('test_own_progress.py', 'test_propagation.py', 'test_paid_refresh.py'):
            subprocess.run([sys.executable, '-B', str(STAGE / name), '-v'], env=env, check=True, cwd=candidate)
    report = {'files': [{'path': str(p), 'before': sha(b) if b is not None else None, 'after': sha(a)}
                        for p, b, a, _ in plan]}
    if '--apply' not in sys.argv:
        print(json.dumps(report)); return
    backup = ROOTS[0] / 'backups' / ('provision-own-progress-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir(mode=0o700)
    installed = []
    try:
        for index, (path, before, after, metadata) in enumerate(plan):
            assert (path.read_bytes() if path.exists() else None) == before, 'Concurrent source drift: ' + str(path)
            if before is not None: shutil.copy2(path, backup / str(index))
            atomic(path, after, metadata)
            installed.append((path, before, after, metadata))
        restart()
    except Exception:
        for path, before, after, metadata in reversed(installed):
            if path.read_bytes() != after: raise RuntimeError('Concurrent edit prevents automatic rollback: ' + str(path))
            if before is None: path.unlink()
            else: atomic(path, before, metadata)
        restart()
        raise
    report.update(installed=True, backup=str(backup), health='ok')
    (backup / 'receipt.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == '__main__': main()
