"""Pinned single-file attachment replacement rollout. The build mirror is guarded, never synchronized."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import sys
import types

ROOT = Path('/opt/energetica-whatsapp')
MIRROR = Path('/home/opc/energetica-build')
STAGE = Path('/home/opc/attachment-append-pages-20261022/release')
BACKUPS = Path('/var/backups/energetica-whatsapp')
LOCK = Path('/tmp/energetica-whatsapp-deploy.lock')
FILES = ('channel_bridge.py',)
BEFORE = {'channel_bridge.py': '15ad4a8e23a8ee475719463199fe0a6d34e792fff4c3ed21676849596ad46bea'}
MIRROR_PINS = {'channel_bridge.py': 'a5a8244d6525f34f53de781caa399570073df1f55ef8148ed4c1c5f9cdfa5e19'}
SHARED_RUNNER_SHA = '01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2'
INPUTS = {'patch_backend.py', 'deploy.py', 'deploy.sh', 'deployment_gate.sh', 'shared-deploy.py', 'source.patch', 'replacement.py'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def directory(path):
    if path.resolve() != path.absolute() or (path.exists() and not path.is_dir()):
        raise RuntimeError('Unexpected directory alias: ' + str(path))


def plain(path):
    if (path.is_symlink() or path.resolve() != path.absolute() or not path.is_file()
            or path.stat().st_nlink != 1):
        raise RuntimeError('Unexpected file alias: ' + str(path))


def pinned(path, expected, message):
    plain(path)
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise RuntimeError(message + ': ' + str(path))
    return data


def load(name, path, expected_sha):
    # Compile in memory: --check must not create __pycache__ in the package.
    module = types.ModuleType(name)
    module.__file__ = str(path)
    data = pinned(path, expected_sha, 'Package input mismatch')
    exec(compile(data, str(path), 'exec'), module.__dict__)
    return module


def mirror_guard():
    for relative, pin in MIRROR_PINS.items():
        pinned(MIRROR / relative, pin, 'Read-only mirror source drift')


def checked_manifest(expected_sha):
    path = STAGE / 'deploy-manifest.json'
    manifest = json.loads(pinned(path, expected_sha, 'Manifest hash mismatch'))
    if set(manifest) != {'files', 'mirror', 'inputs'} or set(manifest['files']) != set(FILES):
        raise RuntimeError('Unexpected deployment scope')
    for relative, pins in manifest['files'].items():
        if (set(pins) != {'before', 'after'} or pins['before'] != BEFORE[relative]
                or not isinstance(pins['after'], str) or not re.fullmatch('[0-9a-f]{64}', pins['after'])):
            raise RuntimeError('Unexpected source pins')
    if manifest['mirror'] != MIRROR_PINS:
        raise RuntimeError('Unexpected read-only mirror pins')
    if set(manifest['inputs']) != INPUTS:
        raise RuntimeError('Unexpected package inputs')
    for relative, pin in manifest['inputs'].items():
        pinned(STAGE / relative, pin, 'Package input mismatch')
    if manifest['inputs']['shared-deploy.py'] != SHARED_RUNNER_SHA:
        raise RuntimeError('Shared runner drift')
    mirror_guard()
    return manifest


def validate_candidates(manifest, candidate):
    if set(candidate) != set(FILES):
        raise RuntimeError('Candidate scope mismatch')
    for relative in FILES:
        data = candidate[relative]
        if hashlib.sha256(data).hexdigest() != manifest['files'][relative]['after']:
            raise RuntimeError('Candidate hash mismatch: ' + relative)
        compile(data, relative, 'exec')


def assemble(manifest):
    mirror_guard()
    for relative in FILES:
        pinned(ROOT / relative, manifest['files'][relative]['before'], 'Source drift')
    patcher = load('append_pages_patcher', STAGE / 'patch_backend.py',
                   manifest['inputs']['patch_backend.py'])
    candidate = {relative: patcher.patch(relative, pinned(
        ROOT / relative, manifest['files'][relative]['before'], 'Source drift')) for relative in FILES}
    validate_candidates(manifest, candidate)
    return candidate


def candidate_guard(manifest):
    for relative in FILES:
        path = STAGE / 'candidate' / relative
        data = pinned(path, manifest['files'][relative]['after'], 'Candidate drift')
        compile(data, relative, 'exec')


def existing_candidates(manifest):
    base = STAGE / 'candidate'
    directory(base)
    # Check every existing candidate before creating any new file; never rebase.
    for relative in FILES:
        target = base / relative
        directory(target.parent)
        if target.exists() or target.is_symlink():
            pinned(target, manifest['files'][relative]['after'], 'Existing candidate differs')


def materialize(manifest, candidate):
    existing_candidates(manifest)
    base = STAGE / 'candidate'
    for relative in FILES:
        target = base / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        directory(target.parent)
        if not target.exists():
            with target.open('xb') as stream:
                stream.write(candidate[relative])
    candidate_guard(manifest)
    return base


def rollout(manifest, candidate, runner, *, check_only=False):
    validate_candidates(manifest, candidate)
    mirror_guard()
    for relative in FILES:
        pinned(ROOT / relative, manifest['files'][relative]['before'], 'Source drift')
    existing_candidates(manifest)
    health = runner.health()
    if check_only:
        return {'status': 'checked', 'health': health,
                'candidate': {relative: hashlib.sha256(candidate[relative]).hexdigest() for relative in FILES}}
    source = materialize(manifest, candidate)
    directory(BACKUPS)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = BACKUPS / ('attachment-append-pages-' + stamp)
    backup.mkdir(mode=0o700, parents=True, exist_ok=False)
    directory(backup)
    saved, attributes = {}, {}
    for index, relative in enumerate(FILES):
        target = ROOT / relative
        before = manifest['files'][relative]['before']
        pinned(target, before, 'Concurrent source drift before backup')
        attributes[relative] = target.stat()
        saved[relative] = backup / (str(index) + '-' + target.name)
        shutil.copy2(target, saved[relative])
        pinned(saved[relative], before, 'Backup mismatch')
    (backup / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    changed = []
    try:
        candidate_guard(manifest)
        mirror_guard()
        for relative in FILES:
            target = ROOT / relative
            # Recheck source data and exact live CAS immediately before each write.
            pinned(source / relative, manifest['files'][relative]['after'], 'Candidate drift')
            pinned(target, manifest['files'][relative]['before'], 'Concurrent source drift')
            changed.append(relative)  # atomic_copy may replace then raise.
            runner.atomic_copy(source / relative, target, attributes[relative])
            pinned(target, manifest['files'][relative]['after'], 'Installed hash mismatch')
        runner.restart()
        health = runner.wait_health()
        for relative in FILES:
            pinned(ROOT / relative, manifest['files'][relative]['after'], 'Post-restart source drift')
        mirror_guard()
    except BaseException as original:
        errors = []
        for relative in changed:
            target = ROOT / relative
            before, after = (manifest['files'][relative][key] for key in ('before', 'after'))
            try:
                plain(target)
                pinned(saved[relative], before, 'Backup drift')
                if digest(target) not in {before, after}:
                    raise RuntimeError('Concurrent writer preserved: ' + str(target))
                runner.atomic_copy(saved[relative], target, attributes[relative])
                pinned(target, before, 'Restore mismatch')
            except BaseException as error:
                errors.append(str(error))
        if changed:
            try:
                runner.restart()
                runner.wait_health()
            except BaseException as error:
                errors.append(str(error))
        for relative in changed:
            try:
                pinned(ROOT / relative, manifest['files'][relative]['before'], 'Post-rollback source drift')
            except BaseException as error:
                errors.append(str(error))
        try:
            mirror_guard()
        except BaseException as error:
            errors.append(str(error))
        receipt = {'status': 'rollback_incomplete' if errors else 'rolled_back',
                   'backup': str(backup), 'cause': str(original), 'errors': errors}
        (backup / 'receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
        raise
    result = {'status': 'deployed', 'backup': str(backup), 'health': health,
              'after': {str(ROOT / relative): digest(ROOT / relative) for relative in FILES}}
    (backup / 'receipt.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    return result


@contextmanager
def deployment_lock(*, check_only=False):
    import fcntl
    import pwd
    flags = (os.O_RDONLY if check_only else os.O_RDWR) | os.O_NOFOLLOW | os.O_NONBLOCK
    try:
        fd = os.open(LOCK, flags)
    except FileNotFoundError:
        if check_only:
            raise RuntimeError('Shared deployment lock absent; read-only check cannot create it')
        fd = os.open(LOCK, flags | os.O_CREAT | os.O_EXCL, 0o644)
    with os.fdopen(fd, 'r' if check_only else 'r+') as lock:
        info = os.fstat(lock.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                or info.st_uid not in {0, pwd.getpwnam('opc').pw_uid}):
            raise RuntimeError('Unexpected deployment lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def interrupted(signum, frame):
    raise RuntimeError('Deployment interrupted by signal ' + str(signum))


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in {'--check', '--deploy'}:
        raise SystemExit('Usage: deploy.py --check|--deploy reviewed_manifest_sha256')
    if Path(__file__).absolute().parent != STAGE or Path(__file__).resolve().parent != STAGE:
        raise RuntimeError('Unexpected release directory or alias')
    check_only = sys.argv[1] == '--check'
    if not check_only:
        if os.geteuid() != 0 or os.environ.get('APPEND_PAGES_GATE') != str(os.getppid()):
            raise RuntimeError('Use root deploy.sh to gate and drain bridge ingress')
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(signum, interrupted)
    with deployment_lock(check_only=check_only):
        manifest = checked_manifest(sys.argv[2])
        candidate = assemble(manifest)
        runner = load('append_pages_existing_runner', STAGE / 'shared-deploy.py', SHARED_RUNNER_SHA)
        print(json.dumps(rollout(manifest, candidate, runner, check_only=check_only)))


if __name__ == '__main__':
    main()
