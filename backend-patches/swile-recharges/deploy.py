"""Install the Swile portal route and its server module on OCI."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from urllib.request import urlopen

SOURCE = Path(__file__).resolve().parent
ROOTS = (Path('/opt/energetica-whatsapp'), Path('/home/opc/energetica-build'))
UNIT = 'energetica-channel-bridge.service'
ANCHOR = '                if action in {"sicoob_refresh", "sicoob_refresh_status"}:\n'
LEGACY_ROUTE = '''                if action in {"swile_directory", "swile_preview", "swile_confirm", "swile_orders"}:
                    from swile_recharges import handle_portal as handle_swile
                    status, result = handle_swile(identity, body)
                    return self._send_json(status, result, cors_origin=origin)
'''
ROUTE = LEGACY_ROUTE.replace('"swile_orders"}', '"swile_orders", "swile_provision"}')


def patch_bridge(data):
    source = data.decode('utf-8')
    if ROUTE in source:
        return data
    if source.count(LEGACY_ROUTE) == 1:
        source = source.replace(LEGACY_ROUTE, ROUTE, 1)
    elif source.count(ANCHOR) == 1 and 'handle_swile' not in source:
        source = source.replace(ANCHOR, ROUTE + ANCHOR, 1)
    else:
        raise ValueError('Unexpected portal routing. Review the active bridge.')
    compile(source, 'channel_bridge.py', 'exec')
    return source.encode('utf-8')


def install(path, data, metadata):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(data)
            os.fchown(stream.fileno(), metadata.st_uid, metadata.st_gid)
            os.fchmod(stream.fileno(), metadata.st_mode & 0o777)
            stream.flush()
            os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


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
    parser.add_argument('--expected-module', required=True)
    parser.add_argument('--expected-provisions', default='absent')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    modules = {name: ((SOURCE / name).read_bytes(), expected) for name, expected in
               [('swile_recharges.py', args.expected_module), ('swile_provisions.py', args.expected_provisions)]}
    for name, (module, _) in modules.items():
        compile(module, name, 'exec')
    with Path('/tmp/energetica-whatsapp-deploy.lock').open('a+b') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        originals, updates = {}, {}
        for root in ROOTS:
            bridge = root / 'channel_bridge.py'
            before = bridge.read_bytes()
            if hashlib.sha256(before).hexdigest() != args.expected_bridge:
                raise RuntimeError(f'Bridge changed at {bridge}.')
            originals[bridge] = (before, bridge.stat())
            patched = patch_bridge(before)
            if patched != before:
                updates[bridge] = patched
            for name, (module, expected) in modules.items():
                target = root / name
                current = originals[target] = (target.read_bytes(), target.stat()) if target.exists() else None
                actual = hashlib.sha256(current[0]).hexdigest() if current else 'absent'
                if actual != expected:
                    raise RuntimeError(f'Swile module changed at {target}.')
                updates[target] = module
        if not args.apply:
            print('Swile deployment check passed.')
            return
        backup = Path(tempfile.mkdtemp(prefix='energetica-swile-', dir='/var/backups'))
        for index, (path, original) in enumerate(originals.items()):
            if original:
                shutil.copy2(path, backup / f'{index}-{path.name}')
        installed = []
        try:
            # Install both module copies before publishing either route.
            for path in sorted(updates, key=lambda path: path.name == 'channel_bridge.py'):
                original = originals[path]
                if original and path.read_bytes() != original[0]:
                    raise RuntimeError(f'File changed during install at {path}.')
                install(path, updates[path], original[1] if original else (path.parent / 'channel_bridge.py').stat())
                installed.append(path)
            restart()
        except BaseException:
            for path in reversed(installed):
                original = originals[path]
                if original:
                    install(path, *original)
                else:
                    path.unlink(missing_ok=True)
            if installed:
                restart()
            raise
    print(f'Swile route deployed. Backup: {backup}')


if __name__ == '__main__':
    main()
