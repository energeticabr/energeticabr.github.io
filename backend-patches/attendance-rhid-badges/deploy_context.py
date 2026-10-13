"""Install only choice context, with shared locks and non-clobbering recovery."""
from __future__ import annotations
import argparse
from contextlib import contextmanager, ExitStack
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import time
from urllib.request import urlopen
from uuid import uuid4
from patch_presence_context import patch_bridge

LIVE = Path('/opt/energetica-whatsapp')
MIRROR = Path('/home/opc/energetica-build')

@contextmanager
def deployment_locks(paths):
    """Hold both existing deployment lock conventions throughout the rollout."""
    import fcntl
    import pwd
    allowed_owners = {0, os.geteuid()}
    try: allowed_owners.add(pwd.getpwnam('opc').pw_uid)
    except KeyError: pass
    with ExitStack() as stack:
        for path in paths:
            flags = os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC
            try: fd = os.open(path, flags)
            except FileNotFoundError:
                try: fd = os.open(path, flags | os.O_CREAT | os.O_EXCL, 0o644)
                except FileExistsError: fd = os.open(path, flags)
            stream = stack.enter_context(os.fdopen(fd, 'r+'))
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid not in allowed_owners:
                raise RuntimeError('Unexpected deployment lock')
            try: fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: raise RuntimeError('Deployment locked by another writer') from None
        yield

def digest(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def checked(path, expected):
    if path.is_symlink() or path.parent.resolve() != path.parent or not path.is_file():
        raise RuntimeError('Unexpected code target or path alias')
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != expected:
        raise RuntimeError('Source changed; refusing replacement: ' + str(path))
    return content

def install(content, target, info, expected):
    checked(target, expected)
    fd, name = tempfile.mkstemp(prefix='.rhid-context-', dir=str(target.parent))
    staged = Path(name)
    displaced = None
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        if hasattr(os, 'chown'): os.chown(staged, info.st_uid, info.st_gid)
        os.chmod(staged, stat.S_IMODE(info.st_mode))
        checked(target, expected)
        # A hash check plus replace has a clobber window. Capture the actual
        # displaced inode, then publish create-only: an uncooperative writer's
        # target is never overwritten. Keep displaced bytes for recovery.
        recovery = Path(tempfile.mkdtemp(prefix='.rhid-context-recovery-', dir=str(target.parent)))
        displaced = recovery / target.name
        os.rename(target, displaced)
        try:
            checked(displaced, expected)
            os.link(staged, target)
        except Exception as failure:
            try: os.link(displaced, target, follow_symlinks=False)
            except FileExistsError: pass  # Preserve both the newer target and displaced source.
            raise RuntimeError('Concurrent source change preserved; recovery: ' + str(displaced)) from failure
    finally:
        staged.unlink(missing_ok=True)

class SystemRunner:
    def restart(self): subprocess.run(['systemctl', 'restart', 'energetica-whatsapp'], check=True)
    def wait_health(self):
        for _ in range(20):
            try:
                with urlopen('http://127.0.0.1:8080/health', timeout=1) as response:
                    if response.status == 200: return True
            except OSError: pass
            time.sleep(0.5)
        return False

def deploy_context(*, expected_bridge_hash, expected_module_hash, source_module, stage,
                   live=LIVE, mirror=MIRROR, apply=False, runner=None, credential_config=None):
    if any(not re.fullmatch(r'[a-f0-9]{64}', value) for value in (expected_bridge_hash, expected_module_hash)):
        raise ValueError('Expected lowercase SHA-256 hashes for both sources')
    roots = tuple(Path(root).absolute() for root in (live, mirror))
    if roots[0].resolve() == roots[1].resolve(): raise ValueError('Code roots must be distinct')
    module = Path(source_module).read_bytes()
    compile(module, 'rhid_badge_source.py', 'exec')
    original, expected, candidate, attributes = {}, {}, {}, {}
    for root in roots:
        for filename, before in [('rhid_badge_source.py', expected_module_hash), ('channel_bridge.py', expected_bridge_hash)]:
            target = root / filename
            original[target] = checked(target, before)
            expected[target], attributes[target] = before, target.stat()
            candidate[target] = module if filename == 'rhid_badge_source.py' else patch_bridge(original[target].decode('utf-8')).encode('utf-8')
            compile(candidate[target], str(target), 'exec')
    config_paths = [root / relative for root in roots for relative in ('worker/workflow_config.json', 'workflow_config.json')]
    if credential_config is not None: config_paths.append(Path(credential_config))
    configs = {path: (digest(path), stat.S_IMODE(path.stat().st_mode), path.stat().st_uid, path.stat().st_gid) if path.exists() else None for path in config_paths}
    def check_configs():
        for path, before in configs.items():
            after = (digest(path), stat.S_IMODE(path.stat().st_mode), path.stat().st_uid, path.stat().st_gid) if path.exists() else None
            if after != before: raise RuntimeError('Configuration changed; refusing deployment: ' + str(path))
    after_hashes = {path: hashlib.sha256(content).hexdigest() for path, content in candidate.items()}
    result = {'dryRun': not apply, 'sourceCasVerified': True, 'workflowConfigPreserved': True,
              'codeHashes': {str(path): value for path, value in after_hashes.items()}}
    if not apply: return result
    stage = Path(stage).resolve()
    if any(stage.is_relative_to(root.resolve()) for root in roots): raise ValueError('Backup stage must be outside code roots')
    backup = stage / 'backups' / ('rhid-context-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-' + uuid4().hex[:8])
    backup.mkdir(parents=True, mode=0o700, exist_ok=False)
    saved = {}
    for path, before in expected.items():
        checked(path, before)
        saved[path] = backup / (('live-' if path.parent == roots[0] else 'mirror-') + path.name)
        shutil.copy2(path, saved[path])
        if digest(saved[path]) != before: raise RuntimeError('Backup verification failed')
    for path, before in expected.items(): checked(path, before)
    check_configs()
    runner = runner or SystemRunner()
    attempted = []
    try:
        for path, before in expected.items():
            checked(path, before)
            attempted.append(path)
            install(candidate[path], path, attributes[path], before)
            if digest(path) != after_hashes[path]: raise RuntimeError('Installed source hash differs')
        check_configs()
        runner.restart()
        if not runner.wait_health(): raise RuntimeError('Service health failed')
        for path, after in after_hashes.items(): checked(path, after)
        check_configs()
        result.update({'status': 'deployed', 'serviceHealth': True, 'backup': str(backup)})
        (backup / 'receipt.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        return result
    except Exception as failure:
        errors = []
        for path in reversed(attempted):
            try:
                current = digest(path)
                if current == expected[path]: continue
                if current != after_hashes[path]: raise RuntimeError('Concurrent source change preserved: ' + str(path))
                content = checked(saved[path], expected[path])
                install(content, path, attributes[path], after_hashes[path])
            except Exception as error: errors.append(str(error))
        if attempted:
            try:
                runner.restart()
                if not runner.wait_health(): errors.append('Restored service health failed')
            except Exception as error: errors.append(str(error))
        (backup / 'receipt.json').write_text(json.dumps({'status': 'rollback_incomplete' if errors else 'rolled_back', 'errors': errors}) + '\n')
        if errors: raise RuntimeError('; '.join(errors)) from failure
        raise

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-bridge-hash', required=True)
    parser.add_argument('--expected-module-hash', required=True)
    parser.add_argument('--stage', required=True, type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    with deployment_locks([Path('/tmp/energetica-whatsapp-deploy.lock'), Path('/home/opc/.energetica-deploy.lock')]):
        print(json.dumps(deploy_context(expected_bridge_hash=args.expected_bridge_hash, expected_module_hash=args.expected_module_hash,
            source_module=Path(__file__).with_name('rhid_badge_source.py'), stage=args.stage, apply=args.apply,
            credential_config=Path('/etc/energetica-rhid-directory.json'))))

if __name__ == '__main__': main()
