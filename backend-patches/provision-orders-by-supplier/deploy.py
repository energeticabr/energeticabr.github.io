"""Exact-file VM rollout with per-root drift pins and recoverable backups.

No workflow state, attachment, financial record or credential file is modified.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import py_compile
import shutil
import stat
import tarfile
import sys
from datetime import datetime, timezone

ROOTS = (Path('/opt/energetica-whatsapp'), Path('/home/opc/energetica-build'))
STAGE = Path('/home/opc/provision-post-confirmation-20261025')
BACKUPS = Path('/var/backups/energetica-whatsapp')
SHARED_RUNNER_SHA = '01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2'
FILES = ('worker/provision_description_settlement.py', 'worker/provision_parent_fanout.py')
NEW_HELPERS = ()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def checked_manifest(expected_hash):
    manifest_path = STAGE / 'deploy-manifest.json'
    if digest(manifest_path) != expected_hash:
        raise RuntimeError('Manifest hash mismatch')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if set(manifest) != {'files', 'patch', 'archive'} or set(manifest['files']) != set(FILES):
        raise RuntimeError('Unexpected manifest scope')
    if digest(STAGE / 'source.patch') != manifest['patch']:
        raise RuntimeError('Source patch mismatch')
    if digest(STAGE / 'source-files.tar') != manifest['archive']:
        raise RuntimeError('Private source bundle mismatch')
    for index, root in enumerate(ROOTS):
        if root.resolve() != root:
            raise RuntimeError('Unexpected root alias')
        for relative in FILES:
            target = root / relative
            before = manifest['files'][relative]['before' if not index else 'mirrorBefore']
            if target.is_symlink() or target.parent.resolve() != target.parent or digest(target) != before:
                raise RuntimeError('Source drift: ' + str(target))
            if relative not in NEW_HELPERS and before is None:
                raise RuntimeError('Unexpected missing baseline')
    return manifest


def assemble(manifest):
    candidate = STAGE / 'candidate'
    if candidate.exists():
        for relative in FILES:
            if digest(candidate / relative) != manifest['files'][relative]['after']:
                raise RuntimeError('Existing assembled candidate differs')
            py_compile.compile(str(candidate / relative), doraise=True)
        return candidate
    with tarfile.open(STAGE / 'source-files.tar') as archive:
        members = archive.getmembers()
        if len(members) != len(FILES) or {member.name for member in members} != set(FILES):
            raise RuntimeError('Private source bundle scope mismatch')
        payloads = {}
        for member in members:
            if not member.isfile() or member.size > 20_000_000:
                raise RuntimeError('Unexpected private source bundle member')
            data = archive.extractfile(member).read()
            if hashlib.sha256(data).hexdigest() != manifest['files'][member.name]['after']:
                raise RuntimeError('Private source bundle file mismatch')
            payloads[member.name] = data
    candidate.mkdir()
    for relative, data in payloads.items():
        target = candidate / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    for relative in FILES:
        if digest(candidate / relative) != manifest['files'][relative]['after']:
            raise RuntimeError('Assembled hash mismatch: ' + relative)
        py_compile.compile(str(candidate / relative), doraise=True)
    return candidate


def rollout(manifest, candidate, runner, *, check_only=False):
    initial_health = runner.health()
    if check_only:
        return {'status': 'checked', 'health': initial_health,
                'candidate': {relative: digest(candidate / relative) for relative in FILES}}
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = BACKUPS / ('provision-orders-by-supplier-' + stamp)
    backup.mkdir(parents=True, exist_ok=False)
    targets = [(root / relative, relative, manifest['files'][relative]['before' if index == 0 else 'mirrorBefore'])
               for index, root in enumerate(ROOTS) for relative in FILES]
    saved, attributes = {}, {}
    for index, (target, relative, before) in enumerate(targets):
        if digest(target) != before:
            raise RuntimeError('Concurrent drift before backup')
        if target.exists():
            saved[target] = backup / (str(index) + '-' + target.name)
            attributes[target] = target.stat()
            shutil.copy2(target, saved[target])
            if digest(saved[target]) != before:
                raise RuntimeError('Backup mismatch')
    (backup / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    changed = []
    try:
        for target, relative, before in targets:
            if digest(target) != before:
                raise RuntimeError('Concurrent source drift')
            changed.append((target, relative, before))
            runner.atomic_copy(candidate / relative, target, attributes.get(target))
            if digest(target) != manifest['files'][relative]['after']:
                raise RuntimeError('Installed hash mismatch')
        runner.restart()
        current_health = runner.wait_health()
        after = {str(target): digest(target) for target, relative, before in targets}
        if any(after[str(target)] != manifest['files'][relative]['after'] for target, relative, before in targets):
            raise RuntimeError('Post-restart drift')
    except Exception:
        errors = []
        for target, relative, before in changed:
            try:
                if target in saved:
                    if digest(target) not in {before, manifest['files'][relative]['after']}:
                        raise RuntimeError('Concurrent source change preserved: ' + str(target))
                    runner.atomic_copy(saved[target], target, attributes[target])
                    if digest(target) != before:
                        raise RuntimeError('Restored hash mismatch')
                elif relative in NEW_HELPERS and digest(target) == manifest['files'][relative]['after']:
                    target.unlink()
                elif target.exists():
                    raise RuntimeError('Unexpected helper change preserved')
            except Exception as error:
                errors.append(str(error))
        try:
            runner.restart()
            runner.wait_health()
        except Exception as error:
            errors.append(str(error))
        (backup / 'receipt.json').write_text(json.dumps({'status': 'rollback_incomplete' if errors else 'rolled_back',
                                                        'errors': errors}, indent=2), encoding='utf-8')
        raise
    result = {'status': 'deployed', 'backup': str(backup), 'health': current_health,
              'after': after, 'deployedAt': stamp}
    (backup / 'receipt.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    return result


def main():
    import fcntl
    import pwd
    if len(sys.argv) != 3 or sys.argv[1] not in {'--check', '--deploy'}:
        raise SystemExit('Usage: deploy.py --check|--deploy manifest_sha256')
    shared = STAGE / 'shared-deploy.py'
    if digest(shared) != SHARED_RUNNER_SHA:
        raise RuntimeError('Shared installer drift')
    spec = importlib.util.spec_from_file_location('shared_group_rollout', shared)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
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
        manifest = checked_manifest(sys.argv[2])
        candidate = assemble(manifest)
        print(json.dumps(rollout(manifest, candidate, runner, check_only=sys.argv[1] == '--check')))


if __name__ == '__main__':
    main()
