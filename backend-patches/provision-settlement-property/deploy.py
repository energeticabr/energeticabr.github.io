"""Publish the tested patch against the independent production and mirror baselines."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import time
from urllib.request import urlopen

from patch_backend import change


ROOTS = (Path('/opt/energetica-whatsapp'), Path('/home/opc/energetica-build'))
TARGETS = ('worker/workflow.py', 'worker/workflow_config.json')
PINS = (
    ('85b7bf9d13f977f35851b032c9683374720ae9cb55c1b3ce867bc1111beab449',
     'a02925f12853636c4b0f37dc49bb3c693e469532702bf19f16302f0429755c90'),
    ('a0961c11e0348ac540e6d6890a11872680f2b72d148fd58abcef810057893412',
     '74f67766e4f02f827718a1c7d4d15df35406099210788be31e3505e976d9c51b'),
    ('e93759fe462155ed9f983f4064a967a7e0c0a1626e5d1ea1075bebaa12b1910a',
     'b9fffbdfb0408117e3e2333836876704f1d1b996e626f14540b3005f5af0858b'),
    ('445d80894b1eec908d4d0a94da0bdd1b10385ef482ea27e786e2bcc4fb1f81b8',
     '1bf8a248dae32a8a313b68c8cde80b0c07541c2321fbe13aa1bde1e44918a2b4'),
)
SERVICES = ('energetica-channel-bridge', 'energetica-whatsapp')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def prepare():
    plan = []
    targets = ((root, relative) for root in ROOTS for relative in TARGETS)
    for (root, relative), (before_sha, after_sha) in zip(targets, PINS):
        path = root / relative
        if path.resolve() != path or not path.is_file() or path.stat().st_nlink != 1:
            raise RuntimeError(f'Unexpected target file {path}')
        before = path.read_bytes()
        if digest(before) != before_sha:
            raise RuntimeError(f'Source drift in {path}')
        after = change(relative, before)
        if digest(after) != after_sha:
            raise RuntimeError(f'Candidate drift in {path}')
        if path.suffix == '.json':
            json.loads(after)
        plan.append((path, before, after, path.stat()))
    return plan


def install(path, data, attributes):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(data)
            os.fchown(stream.fileno(), attributes.st_uid, attributes.st_gid)
            os.fchmod(stream.fileno(), stat.S_IMODE(attributes.st_mode))
            stream.flush()
            os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def health():
    for service in SERVICES:
        if subprocess.run(['systemctl', 'is-active', '--quiet', service], timeout=5).returncode:
            return False
    with urlopen('http://127.0.0.1:8765/health', timeout=2) as response:
        bridge_healthy = json.load(response).get('status') == 'ok'
    with urlopen('http://127.0.0.1:8080/health', timeout=2) as response:
        worker_healthy = response.read().strip() == b'ok'
    return bridge_healthy and worker_healthy


def wait_for_health():
    for _ in range(12):
        try:
            if health():
                return
        except OSError:
            pass
        time.sleep(1)
    raise RuntimeError('Workflow services did not become healthy')


def restart():
    subprocess.run(['systemctl', 'restart', *SERVICES], check=True, timeout=30)
    wait_for_health()


def deploy(plan, receipt):
    wait_for_health()
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = Path('/var/backups/energetica-whatsapp') / f'provision-settlement-property-{timestamp}'
    backup.mkdir(mode=0o700)
    installed = []
    try:
        for index, (path, before, after, attributes) in enumerate(plan):
            if path.read_bytes() != before:
                raise RuntimeError(f'Concurrent source drift in {path}')
            (backup / str(index)).write_bytes(before)
            installed.append((path, before, after, attributes))
            install(path, after, attributes)
        restart()
        if any(path.read_bytes() != after for path, _, after, _ in plan):
            raise RuntimeError('Installed workflow differs from the candidate')
    except BaseException:
        for path, before, after, attributes in reversed(installed):
            if path.read_bytes() == after:
                install(path, before, attributes)
        if installed:
            restart()
        raise
    receipt.update(status='deployed', health='ok', backup=str(backup))
    (backup / 'receipt.json').write_text(json.dumps(receipt, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if args.apply and not os.environ.get('ENERGETICA_SETTLEMENT_PROPERTY_GATED'):
        parser.error('Use deploy.sh to apply under the shared lock and ingress gate')
    plan = prepare()
    receipt = {'status': 'checked', 'files': {str(path): {'before': digest(before), 'after': digest(after)}
                                            for path, before, after, _ in plan}}
    if args.apply:
        deploy(plan, receipt)
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()
