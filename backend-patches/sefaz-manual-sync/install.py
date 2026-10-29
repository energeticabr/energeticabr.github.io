"""Reviewed bridge-hash installation. Run --check, then --deploy on the VM."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen

BASE = 'b091659f2aa0c8b22faa73921dd6af81ed9e89b869b4ef2db0e90c8dfb3d1d6a'
ROOTS = (Path('/opt/energetica-whatsapp'), Path('/home/opc/energetica-build'))
QUEUE = Path('/var/lib/energetica-whatsapp/sefaz-sync')
ANCHOR = '                if action == "operation_progress":\n'
HOOK = '''                if action in {"sefaz_refresh", "sefaz_refresh_status"}:
                    from sefaz_sync import handle_portal as handle_fiscal_refresh
                    return self._send_json(200, handle_fiscal_refresh(identity, body), cors_origin=origin)
'''


def candidate(source, expected=BASE):
    if hashlib.sha256(source).hexdigest() != expected:
        raise RuntimeError('Bridge source drift; review current source before changing hash')
    text = source.decode('utf-8')
    if text.count(ANCHOR) != 1 or 'handle_fiscal_refresh' in text or '"sefaz_refresh"' in text:
        raise RuntimeError('Bridge anchor missing, ambiguous or already installed')
    position = text.index(ANCHOR)
    portal = text.rfind('if path == "/portal/chat":', 0, position)
    if portal < 0 or 'identity = self._portal_identity()' not in text[portal:position]:
        raise RuntimeError('Authenticated portal boundary missing before fiscal hook')
    updated = text.replace(ANCHOR, HOOK + ANCHOR)
    compile(updated, 'channel_bridge.py', 'exec')
    return updated.encode('utf-8')


def atomic(path, content, uid, gid, mode):
    temporary = path.with_name(path.name + '.sefaz-install-tmp')
    with temporary.open('xb') as stream:
        os.chown(temporary, uid, gid)
        os.chmod(temporary, mode)
        stream.write(content); stream.flush(); os.fsync(stream.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY)
    try: os.fsync(directory)
    finally: os.close(directory)


def health():
    for _ in range(20):
        try:
            with urlopen('http://127.0.0.1:8765/health', timeout=2) as response:
                if json.load(response).get('status') == 'ok': return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError('Bridge health failed')


def restart():
    subprocess.run(['systemctl', 'restart', 'energetica-channel-bridge'], check=True, timeout=45)


def main():
    import fcntl
    import pwd
    if sys.argv[1:] not in (['--check'], ['--deploy']):
        raise RuntimeError('Expected --check or --deploy')
    owner = pwd.getpwnam('energetica-whatsapp')
    module = Path(__file__).with_name('sefaz_sync.py').read_bytes()
    compile(module, 'sefaz_sync.py', 'exec')
    with open('/tmp/energetica-whatsapp-deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        sources = []
        for root in ROOTS:
            target = root / 'channel_bridge.py'
            if target.is_symlink() or (root / 'sefaz_sync.py').exists():
                raise RuntimeError('Unexpected source target or existing fiscal module')
            source = target.read_bytes()
            sources.append((root, source, candidate(source), target.stat()))
        if QUEUE.exists():
            metadata = QUEUE.stat()
            if QUEUE.is_symlink() or metadata.st_uid != owner.pw_uid or metadata.st_mode & 0o777 != 0o700:
                raise RuntimeError('Unexpected fiscal queue ownership or permissions')
        health()
        report = {'roots': 2, 'authorization': 'existing_verified_portal_identity', 'moduleSha256': hashlib.sha256(module).hexdigest(),
                  'bridgeSha256': hashlib.sha256(sources[0][2]).hexdigest()}
        if sys.argv[1] == '--check':
            print(json.dumps({'status': 'checked', **report})); return
        backup = Path('/var/backups/energetica-whatsapp/sefaz-manual-sync') / str(time.time_ns())
        backup.mkdir(parents=True, mode=0o700)
        if not QUEUE.exists():
            QUEUE.mkdir(mode=0o700)
            os.chown(QUEUE, owner.pw_uid, owner.pw_gid)
        changed = []
        try:
            for index, (root, source, updated, metadata) in enumerate(sources):
                shutil.copy2(root / 'channel_bridge.py', backup / ('bridge-' + str(index) + '.py'))
                changed.append((root, source, metadata))
                atomic(root / 'sefaz_sync.py', module, metadata.st_uid, metadata.st_gid, 0o640)
                atomic(root / 'channel_bridge.py', updated, metadata.st_uid, metadata.st_gid, metadata.st_mode & 0o777)
            restart(); health()
            print(json.dumps({'status': 'deployed', 'backup': str(backup), **report}))
        except Exception:
            for root, source, metadata in reversed(changed):
                atomic(root / 'channel_bridge.py', source, metadata.st_uid, metadata.st_gid, metadata.st_mode & 0o777)
                (root / 'sefaz_sync.py').unlink(missing_ok=True)
            restart(); health()
            raise


if __name__ == '__main__':
    main()
