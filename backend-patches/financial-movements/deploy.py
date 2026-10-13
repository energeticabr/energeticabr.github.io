"""Exact-hash deployment with atomic files, backups, health and rollback."""
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

STAGE = Path('/home/opc/financial-movements-20261013')
ROOTS = (Path('/opt/energetica-whatsapp'), Path('/home/opc/energetica-build'))
ORIGINAL_WORKFLOW = '70558a64d50da382e28825486716f952c7c0c2f7725596c4e9552bd3d6dda135'
ORIGINAL_CONFIG = '838eeb162202def424ca5dfb2bd5883f2dcba55c884cb5800d8a8de683746740'
FILES = {'worker/workflow_config.json': ORIGINAL_CONFIG, 'worker/financial_catalog_registration.py': 'c0df0401f95833c9a4d73f09b014a6e0592c4073c9967c8fab664f0dcfbd64eb'}
BUILD_CONFIG = 'f4e3b69daa5be081eef4eee174d26f402e7987617876dad08745b88b7e252526'
PYTHON = '/opt/energetica-whatsapp/.venv/bin/python'

def baseline(target, relative):
    # Build mirror was behind production's published registrations. Synchronize
    # it to the same verified candidate, with its own exact backup and rollback.
    return BUILD_CONFIG if target == ROOTS[1] / 'worker/workflow_config.json' else FILES[relative]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def atomic_copy(source, target, attributes):
    info = attributes or target.parent.stat()
    fd, name = tempfile.mkstemp(prefix='.financial-catalog-', dir=target.parent)
    temp = Path(name)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(source.read_bytes()); stream.flush(); os.fsync(stream.fileno())
        os.chmod(temp, stat.S_IMODE(info.st_mode) if attributes else 0o640)
        os.chown(temp, info.st_uid, info.st_gid)
        os.replace(temp, target)
    finally:
        if temp.exists(): temp.unlink()


def health():
    subprocess.run(['systemctl', 'is-active', '--quiet', 'energetica-channel-bridge.service'], check=True)
    with urlopen('http://127.0.0.1:8765/health', timeout=5) as response:
        result = json.load(response)
        assert response.status == 200 and result.get('status') == 'ok', 'Health failed'
    return result


def restart_and_check():
    subprocess.run(['systemctl', 'restart', 'energetica-channel-bridge.service'], check=True)
    for attempt in range(15):
        try: return health()
        except Exception:
            if attempt == 14: raise
            time.sleep(1)


def deploy(check=False):
    manifest_file = STAGE / 'manifest.json'
    assert digest(manifest_file) == sys.argv[2], 'Manifest digest mismatch'
    manifest = json.loads(manifest_file.read_text())
    assert set(manifest) == set(FILES), 'Unexpected files'
    config = ROOTS[0] / 'worker/workflow_config.json'
    assert digest(config) == ORIGINAL_CONFIG, 'Live config changed'
    assert digest(ROOTS[0] / 'worker/workflow.py') == ORIGINAL_WORKFLOW, 'Live engine changed'
    targets = [(root / relative, relative) for root in ROOTS for relative in FILES]
    for relative, before in FILES.items():
        assert manifest[relative]['before'] == before, 'Unexpected baseline'
        source = STAGE / 'candidate' / relative
        assert digest(source) == manifest[relative]['after'], 'Candidate changed'
        if source.suffix == '.py': py_compile.compile(str(source), doraise=True)
    for target, relative in targets:
        assert not target.is_symlink() and digest(target) == baseline(target, relative), 'Live source drift: ' + str(target)
    env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1',
           'FINANCIAL_CANDIDATE': str(STAGE / 'candidate/worker'), 'MOVEMENTS_CONFIG': str(STAGE / 'candidate/worker/workflow_config.json')}
    subprocess.run([PYTHON, str(STAGE / 'run_tests.py')], env=env, check=True)
    initial_health = health()
    if check:
        return {'status': 'checked', 'health': initial_health}
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = ROOTS[0] / '.deploy-backups' / ('financial-movements-' + stamp)
    backup.mkdir(mode=0o700, parents=True)
    saved, attributes = {}, {}
    for index, (target, relative) in enumerate(targets):
        if target.exists():
            attributes[target] = target.stat()
            saved[target] = backup / (str(index) + '-' + target.name)
            shutil.copy2(target, saved[target])
            assert digest(saved[target]) == baseline(target, relative), 'Backup mismatch'
        else:
            # New helpers must inherit the readable worker file's group,
            # not the root-owned directory's group.
            attributes[target] = target.with_name('workflow.py').stat()
    changed = []
    try:
        for target, relative in targets:
            assert digest(target) == baseline(target, relative), 'Concurrent source drift'
            changed.append((target, relative))
            atomic_copy(STAGE / 'candidate' / relative, target, attributes.get(target))
        result = restart_and_check()
        assert digest(ROOTS[0] / 'worker/workflow.py') == ORIGINAL_WORKFLOW, 'Engine unexpectedly changed'
        for target, relative in targets:
            assert digest(target) == manifest[relative]['after'], 'Deployed digest mismatch'
    except Exception:
        for target, relative in reversed(changed):
            if target in saved: atomic_copy(saved[target], target, attributes[target])
            elif target.exists(): target.unlink()
        restart_and_check()
        raise
    return {'status': 'published', 'backup': str(backup), 'health': result,
            'deployed': {str(target): digest(target) for target, relative in targets}}


if __name__ == '__main__':
    assert len(sys.argv) == 3 and sys.argv[1] in {'--check', '--deploy'}
    print(json.dumps(deploy(check=sys.argv[1] == '--check'), ensure_ascii=False))
