"""Install the DDA scheduling route with independently pinned bridge sources."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import tempfile
import time
from urllib.request import urlopen

LIVE = Path('/opt/energetica-whatsapp')
MIRROR = Path('/home/opc/energetica-build')
SOURCE = Path(__file__).resolve().parent
BRIDGE = 'energetica-channel-bridge.service'
FILES = ('dda_payment_scheduling.py', 'Invoke-DdaPaymentScheduling.ps1')
ANCHOR = '                if action == "dda_payment_confirm":\n'
ROUTE = '''                if action in {"dda_schedule_list", "dda_schedule_quote", "dda_schedule_confirm", "dda_schedule_status"}:
                    from dda_payment_scheduling import handle_portal as schedule_dda_payment
                    return self._send_json(200, schedule_dda_payment(identity, body, bridge_client=self.bridge.engine.sharepoint), cors_origin=origin)
'''


def digest(value):
    return hashlib.sha256(value).hexdigest()


def patch_bridge(source):
    if source.count(ANCHOR) != 1 or 'dda_schedule_confirm' in source:
        raise ValueError('Unexpected bridge routing')
    candidate = source.replace(ANCHOR, ROUTE + ANCHOR)
    compile(candidate, 'channel_bridge.py', 'exec')
    return candidate.encode()


def atomic(path, data, owner, mode):
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name + '-')
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
            os.fchown(output.fileno(), owner.st_uid, owner.st_gid)
            os.fchmod(output.fileno(), mode)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def health():
    for _ in range(20):
        try:
            with urlopen('http://127.0.0.1:8765/health', timeout=2) as response:
                if json.load(response).get('status') == 'ok':
                    return
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise RuntimeError('Portal bridge health check failed')


def restart():
    subprocess.run(['systemctl', 'restart', BRIDGE], check=True)
    health()


def prepare_state():
    state = Path('/var/lib/energetica-whatsapp/dda-payment-scheduling')
    owner = pwd.getpwnam('energetica-whatsapp')
    if not state.exists():
        state.mkdir(mode=0o700)
        os.chown(state, owner.pw_uid, owner.pw_gid)
    stat = state.stat()
    if state.is_symlink() or not state.is_dir() or stat.st_uid != owner.pw_uid or stat.st_mode & 0o777 != 0o700:
        raise RuntimeError('Unexpected scheduling state ownership or permissions')


def deploy(options):
    release = {name: (SOURCE / name).read_bytes() for name in FILES}
    if digest(b''.join(release.values())) != options.package_sha:
        raise RuntimeError('Package checksum mismatch')
    subprocess.run(['python3', '-B', '-m', 'unittest', 'discover', '-s', str(SOURCE)], check=True)
    compile(release['dda_payment_scheduling.py'], FILES[0], 'exec')
    with Path('/tmp/energetica-whatsapp-deploy.lock').open('a+b') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        updates = {}
        for root, expected in ((LIVE, options.live_base), (MIRROR, options.mirror_base)):
            bridge = root / 'channel_bridge.py'
            base = bridge.read_bytes()
            if digest(base) != expected or any((root / name).exists() for name in FILES):
                raise RuntimeError(f'Unexpected deployment baseline for {root}')
            updates[bridge] = (base, bridge.stat(), patch_bridge(base.decode()))
        health()
        if options.check:
            print('Deployment preflight passed.')
            return
        prepare_state()
        backup = Path('/var/backups/energetica-whatsapp/dda-payment-scheduling') / str(time.time_ns())
        backup.mkdir(parents=True, mode=0o700)
        written, additions = [], []
        try:
            for index, (bridge, (base, owner, candidate)) in enumerate(updates.items()):
                shutil.copy2(bridge, backup / f'channel_bridge.{index}.py')
                for name, content in release.items():
                    target = bridge.parent / name
                    atomic(target, content, owner, 0o640)
                    additions.append(target)
                atomic(bridge, candidate, owner, owner.st_mode & 0o777)
                written.append(bridge)
            restart()
        except BaseException:
            for bridge in reversed(written):
                base, owner, _ = updates[bridge]
                atomic(bridge, base, owner, owner.st_mode & 0o777)
            for target in additions:
                target.unlink(missing_ok=True)
            if written:
                restart()
            raise
        print(json.dumps({'backup': str(backup), 'files': {name: digest(data) for name, data in release.items()},
                         'bridges': {str(path): digest(data[2]) for path, data in updates.items()}}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--live-base', required=True)
    parser.add_argument('--mirror-base', required=True)
    parser.add_argument('--package-sha', required=True)
    parser.add_argument('--check', action='store_true')
    deploy(parser.parse_args())
