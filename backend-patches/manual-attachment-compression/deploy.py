"""One-file rollout using the existing pinned runner's atomic copy/health API."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import sys
from datetime import datetime, timezone

ROOTS = (Path('/opt/energetica-whatsapp'), Path('/home/opc/energetica-build'))
STAGE = Path(__file__).resolve().parent
BACKUPS = Path('/var/backups/energetica-whatsapp')
BEFORE = 'e4b5af06230e8b761f13d98a19cec4e3e97237ea1674fc80c3a186dfe63d55ef'
AFTER = 'aac994185f7b6b540f32497ba79a87bb692509eb087db7c7e4598413d2a3aefd'
SHARED_RUNNER_SHA = '01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2'
BRIDGE_PINS = ('41cff91d025485cbe13cf73fbc8228598ce74e9b8510593f1b776e13802642aa',
               'a5a8244d6525f34f53de781caa399570073df1f55ef8148ed4c1c5f9cdfa5e19')
COMPRESSOR_PINS = ('138515fe0004e304f990f1eb90d4623214538c14c26de27767819264b78af517',
                   'e3fef6adf8f0dc147f39c6268de46eb830ae55171713c4cd01af9f8dd1280b40')
FILES = ('worker/workflow.py',)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def plain(path):
    if path.is_symlink() or path.resolve() != path.absolute() or not path.is_file():
        raise RuntimeError('Unexpected file alias: ' + str(path))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def bridge_guard():
    for index, root in enumerate(ROOTS):
        for relative, pins in (('channel_bridge.py', BRIDGE_PINS),
                               ('worker/compression.py', COMPRESSOR_PINS)):
            plain(root / relative)
            if digest(root / relative) != pins[index]:
                raise RuntimeError('Read-only compression source drift: ' + str(root / relative))


def checked_manifest(expected_sha):
    path = STAGE / 'deploy-manifest.json'
    plain(path)
    if digest(path) != expected_sha:
        raise RuntimeError('Manifest hash mismatch')
    manifest = json.loads(path.read_text(encoding='utf-8'))
    expected = {'worker/workflow.py': {'before': BEFORE, 'mirrorBefore': BEFORE, 'after': AFTER}}
    if set(manifest) != {'files', 'inputs'} or manifest['files'] != expected:
        raise RuntimeError('Unexpected deployment scope or source pins')
    if set(manifest['inputs']) != {'patch_workflow.py', 'deploy.py', 'deploy.sh',
                                  'shared-deploy.py', 'deployment_gate.sh'}:
        raise RuntimeError('Unexpected package inputs')
    for relative, pin in manifest['inputs'].items():
        plain(STAGE / relative)
        if digest(STAGE / relative) != pin:
            raise RuntimeError('Package input mismatch: ' + relative)
    if manifest['inputs']['shared-deploy.py'] != SHARED_RUNNER_SHA:
        raise RuntimeError('Shared runner drift')
    bridge_guard()
    return manifest


def assemble(manifest):
    for root in ROOTS:
        target = root / FILES[0]
        plain(target)
        if digest(target) != BEFORE:
            raise RuntimeError('Source drift: ' + str(target))
    patcher = load('manual_attachment_patcher', STAGE / 'patch_workflow.py')
    data = patcher.patch((ROOTS[0] / FILES[0]).read_bytes())
    if hashlib.sha256(data).hexdigest() != AFTER:
        raise RuntimeError('Candidate hash mismatch')
    compile(data, FILES[0], 'exec')
    candidate = STAGE / 'candidate'
    target = candidate / FILES[0]
    if target.exists():
        plain(target)
        if target.read_bytes() != data:
            raise RuntimeError('Existing candidate differs')
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.parent.resolve() != target.parent:
            raise RuntimeError('Candidate directory alias')
        target.write_bytes(data)
    return candidate


def rollout(manifest, candidate, runner, *, check_only=False):
    targets = [(root / relative, relative, manifest['files'][relative]['before' if index == 0 else 'mirrorBefore'])
               for index, root in enumerate(ROOTS) for relative in FILES]
    for relative in FILES:
        plain(candidate / relative)
        if digest(candidate / relative) != manifest['files'][relative]['after']:
            raise RuntimeError('Candidate drift')
        compile((candidate / relative).read_bytes(), relative, 'exec')
    for target, _, before in targets:
        plain(target)
        if digest(target) != before:
            raise RuntimeError('Source drift: ' + str(target))
    health = runner.health()
    if check_only:
        return {'status': 'checked', 'health': health,
                'candidate': {relative: digest(candidate / relative) for relative in FILES}}
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = BACKUPS / ('manual-attachment-compression-' + stamp)
    backup.mkdir(parents=True, exist_ok=False)
    saved, attributes = {}, {}
    for index, (target, _, before) in enumerate(targets):
        if digest(target) != before:
            raise RuntimeError('Concurrent source drift before backup')
        attributes[target] = target.stat()
        saved[target] = backup / (str(index) + '-workflow.py')
        shutil.copy2(target, saved[target])
        if digest(saved[target]) != before:
            raise RuntimeError('Backup mismatch')
    (backup / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    changed = []
    try:
        for target, relative, before in targets:
            plain(target)
            if digest(target) != before:
                raise RuntimeError('Concurrent source drift')
            changed.append((target, relative, before))
            runner.atomic_copy(candidate / relative, target, attributes[target])
            if digest(target) != manifest['files'][relative]['after']:
                raise RuntimeError('Installed hash mismatch')
        runner.restart()
        health = runner.wait_health()
        for target, relative, _ in targets:
            if digest(target) != manifest['files'][relative]['after']:
                raise RuntimeError('Post-restart source drift')
    except Exception:
        errors = []
        for target, relative, before in changed:
            try:
                plain(target)
                if digest(target) not in {before, manifest['files'][relative]['after']}:
                    raise RuntimeError('Concurrent writer preserved: ' + str(target))
                if digest(saved[target]) != before:
                    raise RuntimeError('Backup drift')
                runner.atomic_copy(saved[target], target, attributes[target])
                if digest(target) != before:
                    raise RuntimeError('Restore mismatch')
            except Exception as error:
                errors.append(str(error))
        try:
            runner.restart()
            runner.wait_health()
        except Exception as error:
            errors.append(str(error))
        (backup / 'receipt.json').write_text(json.dumps({
            'status': 'rollback_incomplete' if errors else 'rolled_back', 'errors': errors,
        }, indent=2), encoding='utf-8')
        raise
    result = {'status': 'deployed', 'backup': str(backup), 'health': health,
              'after': {str(target): digest(target) for target, _, _ in targets}}
    (backup / 'receipt.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    return result


def main():
    import fcntl
    import pwd
    if len(sys.argv) != 3 or sys.argv[1] not in {'--check', '--deploy'}:
        raise SystemExit('Usage: deploy.py --check|--deploy reviewed_manifest_sha256')
    if STAGE != Path('/home/opc/manual-compression-qa-20261022/release'):
        raise RuntimeError('Unexpected release directory')
    if sys.argv[1] == '--deploy' and os.environ.get('MANUAL_COMPRESSION_GATE') != str(os.getppid()):
        raise RuntimeError('Use deploy.sh to gate and drain bridge ingress')
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
        runner = load('manual_attachment_existing_runner', STAGE / 'shared-deploy.py')
        bridge_guard()
        result = rollout(manifest, candidate, runner, check_only=sys.argv[1] == '--check')
        print(json.dumps(result))


if __name__ == '__main__':
    main()
