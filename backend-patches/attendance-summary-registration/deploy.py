"""Exact independent app/build CAS deployment with rollback and service health gates."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from urllib.request import urlopen

ROOTS = {'app': Path('/opt/energetica-whatsapp'), 'build': Path('/home/opc/energetica-build')}
STAGE = Path(__file__).resolve().parent / 'candidate'
BACKUPS = Path('/var/backups/energetica-whatsapp')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def atomic_copy(source, target, attributes):
    fd, name = tempfile.mkstemp(prefix='.attendance-summary-registration-', dir=target.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(source.read_bytes())
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, stat.S_IMODE(attributes.st_mode))
        os.chown(temporary, attributes.st_uid, attributes.st_gid)
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()


def restart():
    subprocess.run(['systemctl', 'restart', 'energetica-channel-bridge.service'], check=True, capture_output=True)


def health():
    for service in ('energetica-channel-bridge.service', 'energetica-whatsmeow.service'):
        subprocess.run(['systemctl', 'is-active', '--quiet', service], check=True, capture_output=True)
    with urlopen('http://127.0.0.1:8765/health', timeout=5) as response:
        result = json.load(response)
        if response.status != 200 or result.get('status') != 'ok':
            raise RuntimeError('Bridge health failed')
    return result


def wait_health():
    for attempt in range(15):
        try:
            return health()
        except Exception:
            if attempt == 14:
                raise
            time.sleep(1)


def execute(manifest, check_only=False):
    if set(manifest) != set(ROOTS):
        raise RuntimeError('Unexpected roots manifest')
    targets = []
    for name, root in ROOTS.items():
        entry = manifest[name]
        if set(entry) != {'relative', 'before', 'after'} or entry['relative'] != 'worker/workflow.py':
            raise RuntimeError('Unexpected file manifest')
        target = root / entry['relative']
        candidate = STAGE / name / entry['relative']
        if target.is_symlink() or root.resolve() != root or (root/'worker').is_symlink():
            raise RuntimeError('Unexpected source alias')
        if digest(candidate) != entry['after']:
            raise RuntimeError('Candidate hash mismatch: '+name)
        compile(candidate.read_bytes(), str(candidate), 'exec')
        if digest(target) != entry['before']:
            raise RuntimeError('Live source drift: '+name)
        targets.append((name, target, candidate, entry))
    initial = health()
    if check_only:
        return {'status': 'checked', 'health': initial, 'before': {name:digest(target) for name,target,_,_ in targets}}
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = BACKUPS / ('attendance-summary-registration-'+stamp)
    backup.mkdir(parents=True, exist_ok=False)
    attributes, saved = {}, {}
    for name, target, candidate, entry in targets:
        attributes[name] = target.stat()
        saved[name] = backup / (name+'-workflow.py')
        shutil.copy2(target, saved[name])
        if digest(saved[name]) != entry['before']:
            raise RuntimeError('Backup hash mismatch')
    (backup/'manifest.json').write_text(json.dumps(manifest, indent=2))
    changed = []
    try:
        for name, target, candidate, entry in targets:
            if digest(target) != entry['before'] or digest(candidate) != entry['after']:
                raise RuntimeError('Concurrent source/candidate drift: '+name)
            atomic_copy(candidate, target, attributes[name])
            changed.append((name, target, candidate, entry))
            if digest(target) != entry['after']:
                raise RuntimeError('Installed hash mismatch: '+name)
        restart()
        current_health = wait_health()
        if any(digest(target) != entry['after'] for _,target,_,entry in targets):
            raise RuntimeError('Post-restart source drift')
    except Exception:
        errors = []
        for name, target, candidate, entry in changed:
            try:
                if digest(target) != entry['after']:
                    raise RuntimeError('Concurrent change preserved during rollback: '+name)
                atomic_copy(saved[name], target, attributes[name])
                if digest(target) != entry['before']:
                    raise RuntimeError('Restored hash mismatch: '+name)
            except Exception as exc:
                errors.append(str(exc))
        try:
            restart()
            wait_health()
        except Exception as exc:
            errors.append(str(exc))
        receipt = {'status':'rollback_incomplete' if errors else 'rolled_back', 'backup':str(backup), 'errors':errors}
        (backup/'receipt.json').write_text(json.dumps(receipt, indent=2))
        print(json.dumps(receipt))
        raise
    receipt = {'status':'deployed', 'backup':str(backup), 'health':current_health,
               'after': {name:digest(target) for name,target,_,_ in targets}}
    (backup/'receipt.json').write_text(json.dumps(receipt, indent=2))
    return receipt


def main():
    import fcntl
    import pwd
    import sys
    if len(sys.argv) != 3 or sys.argv[1] not in ('--check', '--deploy'):
        raise SystemExit('Usage: deploy.py --check|--deploy manifest_sha256')
    path = STAGE.parent/'deploy-manifest.json'
    if digest(path) != sys.argv[2]:
        raise RuntimeError('Manifest hash mismatch')
    flags = os.O_RDWR | os.O_NOFOLLOW
    try:
        fd = os.open('/tmp/energetica-whatsapp-deploy.lock', flags)
    except FileNotFoundError:
        fd = os.open('/tmp/energetica-whatsapp-deploy.lock', flags | os.O_CREAT | os.O_EXCL, 0o644)
    with os.fdopen(fd, 'r+') as lock:
        info = os.fstat(lock.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid not in (0, pwd.getpwnam('opc').pw_uid):
            raise RuntimeError('Unexpected deployment lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(execute(json.loads(path.read_text()), sys.argv[1]=='--check')))

if __name__ == '__main__':
    main()

