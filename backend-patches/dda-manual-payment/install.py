"""Hash-pinned manual confirmation bridge hook. --check never changes production."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen

ROOTS = [Path('/opt/energetica-whatsapp'), Path('/home/opc/energetica-build')]
PYTHON = '/opt/energetica-whatsapp/.venv/bin/python'
ANCHOR = '                if action in {"dda_refresh", "dda_refresh_status"}:\n'
HOOK = '''                if action == "dda_payment_confirm":
                    from dda_manual_payment import SharePointRepository, handle_portal as confirm_dda_payment
                    repository = SharePointRepository.from_bridge(self.bridge.engine.sharepoint)
                    return self._send_json(200, confirm_dda_payment(identity, body, repository), cors_origin=origin)
'''


def sha(content):
    return hashlib.sha256(content).hexdigest()


def candidate(source):
    if source.count(ANCHOR) != 1 or 'confirm_dda_payment' in source:
        raise RuntimeError('Bridge anchor mismatch')
    result = source.replace(ANCHOR, HOOK + ANCHOR)
    compile(result, 'channel_bridge.py', 'exec')
    return result.encode()


def atomic(path, content, stat, mode=None):
    temp = path.with_name(path.name + '.manual-payment-tmp')
    temp.write_bytes(content)
    os.chown(temp, stat.st_uid, stat.st_gid)
    os.chmod(temp, mode if mode is not None else stat.st_mode & 0o777)
    os.replace(temp, path)


def health():
    for _ in range(25):
        try:
            with urlopen('http://127.0.0.1:8765/health', timeout=3) as response:
                if json.load(response).get('status') == 'ok':
                    return
        except Exception:
            time.sleep(1)
    raise RuntimeError('Bridge health failed')


def main():
    import fcntl
    if sys.argv[1:] not in (['--check'], ['--deploy']):
        raise RuntimeError('Expected --check or --deploy')
    stage = Path(__file__).resolve().parent
    manifest = json.loads((stage / 'manifest.json').read_text())
    if set(manifest['files']) != {'dda_manual_payment.py', 'install.py', 'probe.py', 'test_manual_payment.py', 'test_install.py'}:
        raise RuntimeError('Unexpected package files')
    for name, digest in manifest['files'].items():
        if Path(name).name != name or sha((stage / name).read_bytes()) != digest:
            raise RuntimeError('Package hash mismatch')
    module = (stage / 'dda_manual_payment.py').read_bytes()
    scope_content = (stage / 'scope.json').read_bytes()
    if sha(scope_content) != manifest['scopeSha256']:
        raise RuntimeError('Private scope hash mismatch')
    from dda_manual_payment import load_scope, SCOPE_PATH
    load_scope(stage / 'scope.json')
    compile(module, 'dda_manual_payment.py', 'exec')
    subprocess.run([PYTHON, '-m', 'unittest', 'discover', '-s', str(stage), '-q'], check=True)
    with open('/tmp/energetica-whatsapp-deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        sources = {}
        for root in ROOTS:
            for name, digest in manifest['baseFiles'].items():
                path = root / ('worker/clients.py' if root == ROOTS[0] and name == 'clients.py' else name)
                if root == ROOTS[0] and name == 'clients.py':
                    digest = manifest['productionClientsSha256']
                if sha(path.read_bytes()) != digest:
                    raise RuntimeError('Source drift: ' + name)
            if (root / 'dda_manual_payment.py').exists():
                raise RuntimeError('Module exists; inspect before replacing')
            source = (root / 'channel_bridge.py').read_bytes()
            updated = candidate(source.decode())
            if sha(updated) != manifest['candidateBridgeSha256']:
                raise RuntimeError('Candidate hash mismatch')
            sources[root] = (source, updated)
        access = json.loads(Path('/var/lib/energetica-whatsapp/dda-sync/access.json').read_text())
        if len(access.get('emails', [])) != 1:
            raise RuntimeError('Explicit DDA owner required')
        if SCOPE_PATH.exists() and (SCOPE_PATH.is_symlink() or SCOPE_PATH.read_bytes() != scope_content):
            raise RuntimeError('Existing private scope mismatch')
        subprocess.run([PYTHON, str(stage / 'probe.py')], check=True)
        health()
        receipt = {'moduleSha256': sha(module), 'bridgeSha256': manifest['candidateBridgeSha256'],
                   'manifestSha256': sha((stage / 'manifest.json').read_bytes()), 'roots': len(ROOTS)}
        if sys.argv[1] == '--check':
            print(json.dumps({'status': 'checked', **receipt}))
            return
        backup = Path('/var/backups/energetica-whatsapp/dda-manual-payment') / str(time.time_ns())
        backup.mkdir(parents=True, mode=0o700)
        changed = []
        scope_created = False
        try:
            if not SCOPE_PATH.exists():
                stat = Path('/var/lib/energetica-whatsapp/dda-sync/access.json').stat()
                atomic(SCOPE_PATH, scope_content, stat, 0o600)
                scope_created = True
            for index, (root, (source, updated)) in enumerate(sources.items()):
                target = root / 'channel_bridge.py'
                stat = target.stat()
                shutil.copy2(target, backup / ('bridge-' + str(index) + '.py'))
                changed.append((root, source, stat))
                atomic(root / 'dda_manual_payment.py', module, stat, 0o640)
                atomic(target, updated, stat)
            subprocess.run(['systemctl', 'restart', 'energetica-channel-bridge'], check=True)
            health()
            for root, (_, updated) in sources.items():
                if (root / 'channel_bridge.py').read_bytes() != updated or (root / 'dda_manual_payment.py').read_bytes() != module:
                    raise RuntimeError('Deployment readback mismatch')
            print(json.dumps({'status': 'deployed', 'backup': str(backup), **receipt}))
        except Exception:
            for root, source, stat in reversed(changed):
                atomic(root / 'channel_bridge.py', source, stat)
                (root / 'dda_manual_payment.py').unlink(missing_ok=True)
            if scope_created:
                SCOPE_PATH.unlink(missing_ok=True)
            subprocess.run(['systemctl', 'restart', 'energetica-channel-bridge'], check=True)
            health()
            raise


if __name__ == '__main__':
    main()
