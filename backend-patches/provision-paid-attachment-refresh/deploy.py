"""Verify and install the reviewed attachment patch on the shared backend."""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen

from patch_backend import update_fanout, update_settlement


PACKAGE = Path(__file__).resolve().parent
ROOT = Path('/opt/energetica-whatsapp')
SOURCES = {
    'payroll_row_attachments.py': update_fanout,
    'provision_description_settlement.py': update_settlement,
}
SERVICES = ('energetica-channel-bridge', 'energetica-whatsapp')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(candidate):
    worker = candidate / 'worker'
    env = {**os.environ, 'PYTHONPATH': os.pathsep.join(map(str, (worker, ROOT / 'worker', ROOT)))}
    for path in (worker / name for name in SOURCES):
        compile(path.read_bytes(), str(path), 'exec')
    subprocess.run([sys.executable, '-B', str(PACKAGE / 'test_paid_refresh.py'), '-v'],
                   env=env, check=True)


def install(source, destination):
    fd, temp = tempfile.mkstemp(dir=destination.parent, prefix=f'.{destination.name}.')
    path = Path(temp)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(source.read_bytes())
        metadata = destination.stat()
        os.chown(path, metadata.st_uid, metadata.st_gid)
        shutil.copystat(destination, path)
        os.replace(path, destination)
    finally:
        path.unlink(missing_ok=True)


def restart():
    subprocess.run(['systemctl', 'restart', *SERVICES], check=True)
    for attempt in range(15):
        try:
            for port in (8765, 8080):
                with urlopen(f'http://127.0.0.1:{port}/health', timeout=3) as response:
                    if response.status != 200:
                        raise RuntimeError(f'Health endpoint {port} failed')
        except (OSError, RuntimeError):
            time.sleep(1)
        else:
            return
    raise RuntimeError('Shared backend health check failed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='provision-paid-refresh-') as temp:
        candidate = Path(temp)
        (candidate / 'worker').mkdir()
        plan = []
        for name, patch in SOURCES.items():
            destination = ROOT / 'worker' / name
            source = candidate / 'worker' / name
            original = destination.read_bytes()
            source.write_text(patch(original.decode('utf-8')), encoding='utf-8')
            plan.append((source, destination, hashlib.sha256(original).hexdigest()))
        verify(candidate)
        for source, destination, before in plan:
            print(f'{destination} {before} -> {digest(source)}', flush=True)
        if not args.apply:
            return
        backup = Path(tempfile.mkdtemp(prefix='provision-paid-refresh-', dir=ROOT / 'backups'))
        originals = []
        try:
            for index, (source, destination, before) in enumerate(plan):
                if digest(destination) != before:
                    raise RuntimeError(f'Backend source changed before deployment: {destination}')
                original = backup / f'{index}-{destination.name}'
                shutil.copy2(destination, original)
                install(source, destination)
                originals.append((original, destination))
                if digest(destination) != digest(source):
                    raise RuntimeError(f'Backend source changed during deployment: {destination}')
            restart()
        except BaseException:
            for original, destination in reversed(originals):
                install(original, destination)
            if originals:
                restart()
            raise
        print(f'Both backend services healthy. Originals saved under {backup}')


if __name__ == '__main__':
    main()
