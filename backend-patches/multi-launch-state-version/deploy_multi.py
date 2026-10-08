"""Hash-pinned exact-file rollout; checkpoints and financial records are untouched."""
import hashlib
import json
import os
from pathlib import Path
import py_compile
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from urllib.request import urlopen

ROOTS = (Path('/opt/energetica-whatsapp'), Path('/home/opc/energetica-build'))
STAGE = Path('/home/opc/multi-launch-state-version-20261008/candidate')
BACKUPS = Path('/var/backups/energetica-whatsapp')
FILES = ('worker/workflow.py',)
NEW_HELPERS = ()

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None

def set_owner(path, uid, gid):
    os.chown(path, uid, gid)

def atomic_copy(source, target, attributes=None):
    info = attributes or target.parent.stat()
    mode = stat.S_IMODE(attributes.st_mode) if attributes else 0o644
    fd, name = tempfile.mkstemp(prefix='.multi-launch-', dir=target.parent)
    temp = Path(name)
    try:
        with os.fdopen(fd,'wb') as stream:
            stream.write(source.read_bytes()); stream.flush(); os.fsync(stream.fileno())
        os.chmod(temp,mode); set_owner(temp,info.st_uid,info.st_gid)
        os.replace(temp,target)
    finally:
        if temp.exists(): temp.unlink()

def restart():
    subprocess.run(['systemctl','restart','energetica-channel-bridge.service'],check=True,capture_output=True)

def health():
    for service in ('energetica-channel-bridge.service','energetica-whatsmeow.service'):
        subprocess.run(['systemctl','is-active','--quiet',service],check=True,capture_output=True)
    with urlopen('http://127.0.0.1:8765/health',timeout=5) as response:
        result = json.load(response)
        if response.status != 200 or result.get('status') != 'ok':
            raise RuntimeError('Bridge health failed')
    return result

def wait_health():
    for attempt in range(15):
        try: return health()
        except Exception:
            if attempt == 14: raise
            time.sleep(1)

def execute(manifest, check_only=False):
    if set(manifest) != set(FILES): raise RuntimeError('Unexpected file manifest')
    targets = [(root / relative, relative) for root in ROOTS for relative in FILES]
    for relative in FILES:
        if digest(STAGE / relative) != manifest[relative]['after']:
            raise RuntimeError('Candidate hash mismatch: '+relative)
        py_compile.compile(str(STAGE / relative),doraise=True)
    before = {}
    for target, relative in targets:
        if target.is_symlink() or digest(target) != manifest[relative]['before']:
            raise RuntimeError('Live source drift: '+str(target))
        before[str(target)] = digest(target)
    initial_health = health()
    if check_only: return {'status':'checked','before':before,'health':initial_health}
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = BACKUPS / ('multi-launch-state-version-'+stamp)
    backup.mkdir(parents=True,exist_ok=False)
    saved, attributes = {}, {}
    for index,(target,relative) in enumerate(targets):
        if target.exists():
            attributes[target] = target.stat()
            saved[target] = backup / (str(index)+'-'+target.name)
            shutil.copy2(target,saved[target])
            if digest(saved[target]) != before[str(target)]: raise RuntimeError('Backup hash mismatch')
    (backup / 'before.json').write_text(json.dumps(before,indent=2))
    changed = []
    try:
        for target,relative in targets:
            if digest(target) != before[str(target)]: raise RuntimeError('Concurrent source drift')
            changed.append((target,relative))
            atomic_copy(STAGE / relative,target,attributes.get(target))
            if digest(target) != manifest[relative]['after']: raise RuntimeError('Installed hash mismatch')
        restart()
        current_health = wait_health()
        after = {str(target):digest(target) for target,relative in targets}
        if any(after[str(target)] != manifest[relative]['after'] for target,relative in targets):
            raise RuntimeError('Post-restart source drift')
    except Exception:
        errors = []
        # Production first, and every restore/restart is attempted independently.
        for target,relative in changed:
            try:
                if target in saved:
                    atomic_copy(saved[target],target,attributes[target])
                    if digest(target) != before[str(target)]: raise RuntimeError('Restored hash mismatch')
                elif relative in NEW_HELPERS:
                    if digest(target) == manifest[relative]['after']: target.unlink()
                    elif target.exists(): raise RuntimeError('Concurrent helper change preserved')
                else: raise RuntimeError('Unexpected absent baseline')
            except Exception as error: errors.append(str(error))
        try: restart(); wait_health()
        except Exception as error: errors.append(str(error))
        result = {'status':'rollback_incomplete' if errors else 'rolled_back','backup':str(backup),'errors':errors}
        (backup / 'receipt.json').write_text(json.dumps(result,indent=2))
        print(json.dumps(result))
        raise
    result = {'status':'deployed','backup':str(backup),'before':before,'after':after,'health':current_health,'deployed_at':stamp}
    (backup / 'receipt.json').write_text(json.dumps(result,indent=2))
    return result

def main():
    import fcntl
    import pwd
    if len(sys.argv) != 3 or sys.argv[1] not in ('--check','--deploy'):
        raise SystemExit('Usage: deploy_multi.py --check|--deploy expected_manifest_sha256')
    manifest_path = STAGE.parent / 'deploy-manifest.json'
    if digest(manifest_path) != sys.argv[2]: raise RuntimeError('Manifest hash mismatch')
    for root in ROOTS:
        if root.resolve() != root: raise RuntimeError('Unexpected target alias')
    flags = os.O_RDWR | os.O_NOFOLLOW
    try: fd = os.open('/tmp/energetica-whatsapp-deploy.lock',flags)
    except FileNotFoundError:
        fd = os.open('/tmp/energetica-whatsapp-deploy.lock',flags | os.O_CREAT | os.O_EXCL,0o644)
    with os.fdopen(fd,'r+') as lock:
        info = os.fstat(lock.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid not in (0,pwd.getpwnam('opc').pw_uid):
            raise RuntimeError('Unexpected deployment lock')
        fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(execute(json.loads(manifest_path.read_text()),sys.argv[1]=='--check')))

if __name__ == '__main__': main()
