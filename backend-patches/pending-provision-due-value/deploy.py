"""Pinned, locked rollout; each source root retains its independent baseline."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen

PACKAGE = Path(__file__).resolve().parent
RELATIVES = ('worker/provision_description_settlement.py',)
ROOTS = (Path('/opt/energetica-whatsapp'), Path('/home/opc/energetica-build'))
BACKUPS = Path('/var/backups/energetica-whatsapp')
INPUTS = {'deploy.py', 'patch_backend.py', 'source.patch', 'deploy.sh', 'deployment_gate.sh'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def prepare(expected):
    raw = (PACKAGE/'deploy-manifest.json').read_bytes()
    if digest(raw) != expected:
        raise RuntimeError('Manifest hash mismatch')
    manifest = json.loads(raw)
    if set(manifest) != {'files', 'inputs'} or set(manifest['inputs']) != INPUTS:
        raise RuntimeError('Unexpected manifest scope')
    if set(manifest['files']) != {str(root/relative) for root in ROOTS for relative in RELATIVES}:
        raise RuntimeError('Unexpected target scope')
    payloads = {}
    for name, pin in manifest['inputs'].items():
        path = PACKAGE/name
        if path.is_symlink() or digest(path.read_bytes()) != pin:
            raise RuntimeError('Package input mismatch: '+name)
        payloads[name] = path.read_bytes()
    namespace = {}
    exec(compile(payloads['patch_backend.py'], 'patch_backend.py', 'exec'), namespace)
    plan = []
    for root in ROOTS:
        for relative in RELATIVES:
            path = root/relative
            if path.resolve() != path or not path.is_file() or path.stat().st_nlink != 1:
                raise RuntimeError('Unexpected target alias')
            before = path.read_bytes()
            pins = manifest['files'][str(path)]
            if set(pins) != {'before', 'after'} or digest(before) != pins['before']:
                raise RuntimeError('Source drift: '+str(path))
            after = namespace['patch'](relative, before)
            compile(after, str(path), 'exec')
            if digest(after) != pins['after']:
                raise RuntimeError('Candidate hash mismatch')
            plan.append((path, before, after))
    return plan


def atomic(path, data, attributes):
    descriptor, name = tempfile.mkstemp(prefix='.due-value-', dir=str(path.parent))
    try:
        with os.fdopen(descriptor, 'wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(name, stat.S_IMODE(attributes.st_mode))
        os.chown(name, attributes.st_uid, attributes.st_gid)
        os.replace(name, path)
        directory = os.open(str(path.parent), os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def health():
    for service in ('energetica-channel-bridge', 'energetica-whatsapp'):
        subprocess.run(['systemctl', 'is-active', '--quiet', service], check=True)
    with urlopen('http://127.0.0.1:8765/health', timeout=5) as response:
        if json.load(response).get('status') != 'ok':
            raise RuntimeError('Unhealthy bridge')
    return 'ok'


def restart():
    subprocess.run(['systemctl', 'restart', 'energetica-channel-bridge', 'energetica-whatsapp'], check=True)
    for attempt in range(20):
        try:
            return health()
        except Exception:
            time.sleep(1)
    raise RuntimeError('Services did not recover')


def rollout(plan):
    health()
    backup = BACKUPS/('pending-provision-due-value-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(mode=0o700, parents=True, exist_ok=False)
    originals = []
    try:
        for index, (path, before, after) in enumerate(plan):
            if path.read_bytes() != before:
                raise RuntimeError('Concurrent source drift')
            attributes = path.stat()
            (backup/str(index)).write_bytes(before)
            originals.append((path, before, after, attributes))
            atomic(path, after, attributes)
            if path.read_bytes() != after:
                raise RuntimeError('Installed source mismatch')
        restart()
        if any(path.read_bytes() != after for path, before, after in plan):
            raise RuntimeError('Post-restart source drift')
    except BaseException:
        conflicts = []
        for path, before, after, attributes in reversed(originals):
            if path.read_bytes() not in (before, after):
                conflicts.append(str(path))
                continue
            atomic(path, before, attributes)
        restart()
        if conflicts:
            raise RuntimeError('Concurrent source changes preserved during rollback: '+', '.join(conflicts))
        raise
    receipt = {'status': 'deployed', 'health': health(), 'backup': str(backup),
        'files': {str(path): {'before': digest(before), 'after': digest(after)}
                  for path, before, after in plan}}
    (backup/'receipt.json').write_text(json.dumps(receipt, indent=2))
    return receipt


def main():
    import fcntl
    mode, expected = sys.argv[1:]
    if mode not in {'--check', '--deploy'} or os.geteuid() != 0:
        raise RuntimeError('Expected root and explicit deployment mode')
    with open('/tmp/energetica-whatsapp-deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        plan = prepare(expected)
        if mode == '--deploy':
            if not os.getenv('PROVISION_DUE_VALUE_GATE'):
                raise RuntimeError('Deployment requires the drained ingress gate')
            print(json.dumps(rollout(plan)))
        else:
            print(json.dumps({'status': 'checked', 'health': health(),
                'files': {str(path): {'before': digest(before), 'after': digest(after)}
                          for path, before, after in plan}}))


if __name__ == '__main__':
    main()
