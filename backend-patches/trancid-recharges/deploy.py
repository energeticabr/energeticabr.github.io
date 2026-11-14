"""Install the Trancid recharge route in the OCI bridge and its build mirror."""

import argparse
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import pwd
import secrets
import shutil
import subprocess
import tempfile
import time
from urllib.request import urlopen

SOURCE = Path(__file__).resolve().parent
ROOTS = (Path('/opt/energetica-whatsapp'), Path('/home/opc/energetica-build'))
UNIT = 'energetica-channel-bridge.service'
ACCOUNT = 'energetica-whatsapp'
CONFIG = Path('/etc/energetica-trancid-recharges.json')
STATE = Path('/var/lib/energetica-whatsapp/trancid-recharges')
ANCHOR = '                if action in {"swile_directory", "swile_preview", "swile_confirm", "swile_orders"}:\n'
ROUTE = '''                if action in {
                    "trancid_recharge_directory", "trancid_recharge_preview",
                    "trancid_recharge_confirm", "trancid_recharge_history",
                }:
                    from trancid_recharges import handle_portal as handle_trancid_recharges
                    status, result = handle_trancid_recharges(identity, body)
                    return self._send_json(status, result, cors_origin=origin)
'''
MODULES = ('trancid_recharges.py', 'trancid_portal_adapter.py')


def patch_bridge(data):
    source = data.decode('utf-8')
    if ROUTE + ANCHOR in source:
        return data
    if source.count(ANCHOR) != 1 or 'handle_trancid_recharges' in source:
        raise ValueError('Unexpected portal routing. Review the active bridge.')
    source = source.replace(ANCHOR, ROUTE + ANCHOR, 1)
    compile(source, 'channel_bridge.py', 'exec')
    return source.encode('utf-8')


def install(path, data, uid, gid, mode):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(data)
            os.fchown(stream.fileno(), uid, gid)
            os.fchmod(stream.fileno(), mode)
            stream.flush()
            os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def snapshot(path):
    info = path.stat()
    return path.read_bytes(), info.st_uid, info.st_gid, info.st_mode & 0o777


def restart():
    subprocess.run(['systemctl', 'restart', UNIT], check=True, timeout=20)
    for _ in range(20):
        try:
            with urlopen('http://127.0.0.1:8765/health', timeout=2) as response:
                if json.load(response).get('status') == 'ok':
                    return
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise RuntimeError('Bridge health did not recover.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--expected-bridge', required=True)
    parser.add_argument('--expected-module', action='append', default=[], metavar='NAME=SHA256')
    parser.add_argument('--allow-email', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    expected_modules = dict(entry.split('=', 1) for entry in args.expected_module)
    account = pwd.getpwnam(ACCOUNT)
    group = grp.getgrnam(ACCOUNT).gr_gid
    modules = {name: (SOURCE / name).read_bytes() for name in MODULES}
    for name, module in modules.items():
        compile(module, name, 'exec')
    with Path('/tmp/energetica-whatsapp-deploy.lock').open('a+b') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        originals, updates = {}, {}
        for root in ROOTS:
            bridge = root / 'channel_bridge.py'
            originals[bridge] = snapshot(bridge)
            if hashlib.sha256(originals[bridge][0]).hexdigest() != args.expected_bridge:
                raise RuntimeError(f'Bridge changed at {bridge}.')
            patched = patch_bridge(originals[bridge][0])
            if patched != originals[bridge][0]:
                updates[bridge] = (patched, *originals[bridge][1:])
            for name, data in modules.items():
                target = root / name
                originals[target] = snapshot(target) if target.exists() else None
                original = originals[target]
                if name in expected_modules and (not original or hashlib.sha256(original[0]).hexdigest() != expected_modules[name]):
                    raise RuntimeError(f'Module changed at {target}.')
                if not original or original[0] != data:
                    updates[target] = (data, 0, group, 0o640)
        if not CONFIG.exists():
            originals[CONFIG] = None
            data = json.dumps({'allowedEmails': [args.allow_email.strip().casefold()], 'cardIdKey': secrets.token_hex(32)})
            updates[CONFIG] = (data.encode(), 0, group, 0o640)
        if not args.apply:
            print('Trancid deployment check passed.')
            return
        STATE.mkdir(mode=0o700, exist_ok=True)
        os.chown(STATE, account.pw_uid, group)
        STATE.chmod(0o700)
        backup = Path(tempfile.mkdtemp(prefix='energetica-trancid-', dir='/var/backups'))
        for index, (path, original) in enumerate(originals.items()):
            if original:
                shutil.copy2(path, backup / f'{index}-{path.name}')
        installed = []
        try:
            for path in sorted(updates, key=lambda path: path.name == 'channel_bridge.py'):
                if originals[path] and snapshot(path) != originals[path]:
                    raise RuntimeError(f'File changed during install at {path}.')
                install(path, *updates[path])
                installed.append(path)
            subprocess.run(['runuser', '-u', ACCOUNT, '--', str(ROOTS[0] / '.venv/bin/python'), '-B', '-c',
                            'import trancid_recharges; import trancid_portal_adapter'],
                           cwd=ROOTS[0], check=True, timeout=15)
            restart()
        except BaseException:
            for path in reversed(installed):
                if original := originals[path]:
                    install(path, *original)
                else:
                    path.unlink(missing_ok=True)
            if installed:
                restart()
            raise
    print(f'Trancid route deployed. Backup: {backup}')


if __name__ == '__main__':
    main()
