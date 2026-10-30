"""Exact three-file, two-root rollout. No workflow, connector or financial calls."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen
import uuid

ROOTS = (Path('/opt/energetica-whatsapp'), Path('/home/opc/energetica-build'))
STAGE = Path('/home/opc/provision-partial-settlement-20261030/release')
BACKUPS = Path('/var/backups/energetica-whatsapp')
LOCK = Path('/tmp/energetica-whatsapp-deploy.lock')
FILES = ('worker/workflow.py', 'worker/provision_description_settlement.py',
         'worker/provision_description_review.py')
BEFORE = dict(zip(FILES, (
    'be6b20c07535ff8e7c520e2cfaa750d48b2b23f4182059ef58772700e2258770',
    'fd2ae494480a88b049fd2f45cda7275fcd8c54e7c6ec160da00c5d2e68c28a20',
    'df02b171380dec5dd349e980e49044a1644767b0ac77c1e888f687992182acca')))
CONFIG = 'worker/workflow_config.json'
CONFIG_SHA = 'a951c15f30d78409101b7829bdf9bad3cf118ac7541c3dcaa705663e962bf069'
INPUTS = {'deploy.py', 'deploy.sh', 'package.py', 'source.patch'}
LOCK_BACKEND = None  # Synthetic tests supply a fake flock backend on Windows.
_LOCK_STATE = None


def sha(data):
    return hashlib.sha256(data).hexdigest()


def plain(path):
    if (path.is_symlink() or path.resolve() != path.absolute() or not path.is_file()
            or path.stat().st_nlink != 1):
        raise RuntimeError('File alias or missing source: ' + str(path))


def pinned(path, expected, message='Source drift'):
    plain(path)
    data = path.read_bytes()
    if sha(data) != expected:
        raise RuntimeError(message + ': ' + str(path))
    return data


def validate_manifest(manifest):
    if (set(manifest) != {'version', 'files', 'guards', 'inputs'}
            or type(manifest['version']) is not int or manifest['version'] != 1
            or set(manifest['files']) != set(FILES)):
        raise RuntimeError('Unexpected deployment scope')
    if manifest['guards'] != {CONFIG: CONFIG_SHA}:
        raise RuntimeError('Unexpected config guard')
    if set(manifest['inputs']) != INPUTS:
        raise RuntimeError('Unexpected package scope')
    for name in FILES:
        pins = manifest['files'][name]
        if (set(pins) != {'before', 'after'} or pins['before'] != BEFORE[name]
                or not isinstance(pins['after'], str) or not re.fullmatch('[0-9a-f]{64}', pins['after'])):
            raise RuntimeError('Unexpected source pins')
    for pin in manifest['inputs'].values():
        if not isinstance(pin, str) or not re.fullmatch('[0-9a-f]{64}', pin):
            raise RuntimeError('Unexpected input pin')


def package_guard(manifest):
    validate_manifest(manifest)
    for name, pin in manifest['inputs'].items():
        pinned(STAGE / name, pin, 'Package input drift')


def checked_manifest(expected):
    manifest = json.loads(pinned(STAGE / 'deploy-manifest.json', expected, 'Manifest drift'))
    package_guard(manifest)
    return manifest


def config_guard():
    for root in ROOTS:
        pinned(root / CONFIG, CONFIG_SHA, 'Config guard drift')


def roots_guard(manifest, version='before'):
    config_guard()
    for root in ROOTS:
        if root.resolve() != root.absolute():
            raise RuntimeError('Root alias')
        for name in FILES:
            pinned(root / name, manifest['files'][name][version])


def candidate_guard(manifest):
    result = {}
    for name in FILES:
        result[name] = pinned(STAGE / 'candidate' / name, manifest['files'][name]['after'], 'Candidate drift')
        compile(result[name], name, 'exec')
    return result


@contextmanager
def deployment_lock(*, check_only=False):
    """One flock per process; nested check under deploy is safe, reverse is not."""
    global _LOCK_STATE
    if _LOCK_STATE is not None:
        path, pid, outer_check = _LOCK_STATE
        if path != LOCK.absolute() or pid != os.getpid():
            raise RuntimeError('Unexpected inherited deployment lock')
        if outer_check and not check_only:
            raise RuntimeError('Read-only lock escalation refused')
        yield
        return
    backend = LOCK_BACKEND
    if backend is None:
        import fcntl
        backend = fcntl
    flags = (os.O_RDONLY if check_only else os.O_RDWR) | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
    if LOCK.is_symlink() or LOCK.resolve() != LOCK.absolute():
        raise RuntimeError('Deployment lock alias')
    try:
        fd = os.open(LOCK, flags)
    except FileNotFoundError:
        raise RuntimeError('Existing shared deployment lock required') from None
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                or info.st_uid not in {0, 1000}):
            raise RuntimeError('Unexpected deployment lock ownership')
        backend.flock(fd, backend.LOCK_EX | backend.LOCK_NB)
        _LOCK_STATE = (LOCK.absolute(), os.getpid(), check_only)
        try:
            yield
        finally:
            _LOCK_STATE = None
    finally:
        os.close(fd)


def atomic_copy(data, target, attributes):
    fd, name = tempfile.mkstemp(prefix='.partial-settlement-', dir=target.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchown(stream.fileno(), attributes.st_uid, attributes.st_gid)
            os.fchmod(stream.fileno(), stat.S_IMODE(attributes.st_mode))
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        directory = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


class Runner:
    atomic_copy = staticmethod(atomic_copy)

    @staticmethod
    def command(args, **kwargs):
        kwargs.setdefault('timeout', 15)
        return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs)

    def health(self, deadline=None):
        def budget():
            left = 3 if deadline is None else min(3, deadline - time.monotonic())
            if left <= 0:
                raise RuntimeError('Bridge health deadline exceeded')
            return left
        for service in ('energetica-channel-bridge.service', 'energetica-whatsmeow.service'):
            self.command(['systemctl', 'is-active', '--quiet', service], timeout=budget())
        with urlopen('http://127.0.0.1:8765/health', timeout=budget()) as response:
            if response.status != 200 or json.load(response).get('status') != 'ok':
                raise RuntimeError('Bridge health failed')
        return {'status': 'ok', 'http': 200}

    def wait_health(self):
        deadline = time.monotonic() + 30
        while True:
            try:
                return self.health(deadline)
            except Exception:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.5)

    def restart(self):
        subprocess.run(['systemctl', 'restart', 'energetica-channel-bridge.service'],
                       check=True, capture_output=True, timeout=45)

    @contextmanager
    def ingress(self):
        import pwd
        if pwd.getpwnam('caddy').pw_uid == 0:
            raise RuntimeError('Cannot gate a root-owned proxy')
        unit = 'energetica-partial-settlement-release-' + str(os.getpid())
        rule = ['-o', 'lo', '-d', '127.0.0.1', '-p', 'tcp', '--dport', '8765', '--syn',
                '-m', 'owner', '!', '--uid-owner', '0', '-m', 'comment', '--comment',
                'partial-settlement-' + str(os.getpid()), '-j', 'REJECT', '--reject-with', 'tcp-reset']
        active = False
        try:
            self.command(['iptables', '-I', 'OUTPUT', '1', *rule])
            active = True
            self.command(['systemd-run', '--quiet', '--unit=' + unit, '--on-active=300s',
                          '/usr/sbin/iptables', '-D', 'OUTPUT', *rule])
            deadline = time.monotonic() + 30
            while self.command(['ss', '-Hnt', 'state', 'established', '( sport = :8765 )']).stdout.strip():
                if time.monotonic() >= deadline:
                    raise RuntimeError('Active bridge requests did not drain')
                time.sleep(1)
            yield
        finally:
            if active:
                # If this deletion fails, the already scheduled watchdog remains.
                self.command(['iptables', '-D', 'OUTPUT', *rule])
                self.command(['systemctl', 'stop', unit + '.timer'])


def receipt(backup, value):
    (backup / 'receipt.json').write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


@contextmanager
def tracked_ingress(runner):
    outcome = {}
    try:
        with runner.ingress():
            yield outcome
    except BaseException as error:
        if outcome.get('deployed'):
            result = outcome['deployed']
            result.update(status='deployed_ingress_cleanup_failed', error=str(error))
            receipt(Path(result['backup']), result)
        raise


def rollout(manifest, runner, *, check_only=False):
    with deployment_lock(check_only=check_only):
        package_guard(manifest)
        candidate_guard(manifest)
        roots_guard(manifest)
        initial = runner.health()
        if check_only:
            return {'status': 'checked', 'health': initial, 'roots': 2, 'filesPerRoot': 3,
                    'candidate': {n: manifest['files'][n]['after'] for n in FILES}}
        with tracked_ingress(runner) as gate:
            package_guard(manifest)
            candidate_guard(manifest)
            roots_guard(manifest)
            backup = BACKUPS / ('provision-partial-settlement-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-' + uuid.uuid4().hex)
            backup.mkdir(parents=True, mode=0o700, exist_ok=False)
            saved = {}
            for i, root in enumerate(ROOTS):
                for j, name in enumerate(FILES):
                    target = root / name
                    data = pinned(target, manifest['files'][name]['before'])
                    saved[target] = (data, target.stat(), name)
                    path = backup / (str(i) + '-' + str(j) + '-' + target.name)
                    with path.open('xb') as stream:
                        stream.write(data)
                        stream.flush()
                        os.fsync(stream.fileno())
                    path.chmod(0o600)
                    pinned(path, manifest['files'][name]['before'], 'Backup drift')
            (backup / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
            changed = []
            try:
                for target, (_, attributes, name) in saved.items():
                    package_guard(manifest)
                    data = candidate_guard(manifest)[name]
                    config_guard()
                    pinned(target, manifest['files'][name]['before'])
                    changed.append(target)  # Atomic replace can succeed then raise.
                    runner.atomic_copy(data, target, attributes)
                    pinned(target, manifest['files'][name]['after'], 'Installed source drift')
                roots_guard(manifest, 'after')
                runner.restart()
                current = runner.wait_health()
                roots_guard(manifest, 'after')
            except BaseException as original:
                errors = []
                for target in reversed(changed):
                    data, attributes, name = saved[target]
                    try:
                        plain(target)
                        if sha(target.read_bytes()) not in set(manifest['files'][name].values()):
                            raise RuntimeError('Concurrent writer preserved: ' + str(target))
                        runner.atomic_copy(data, target, attributes)
                        pinned(target, manifest['files'][name]['before'], 'Restore drift')
                    except BaseException as error:
                        errors.append(str(error))
                if changed:
                    try:
                        runner.restart()
                        runner.wait_health()
                    except BaseException as error:
                        errors.append(str(error))
                try:
                    roots_guard(manifest)
                except BaseException as error:
                    errors.append(str(error))
                receipt(backup, {'status': 'rollback_incomplete' if errors else 'rolled_back',
                                 'backup': str(backup), 'cause': str(original), 'errors': errors})
                raise
            result = {'status': 'deployed', 'backup': str(backup), 'health': current,
                      'after': {str(root / n): manifest['files'][n]['after'] for root in ROOTS for n in FILES},
                      'configUnchanged': True}
            receipt(backup, result)
            gate['deployed'] = result
        return result


def interrupted(signum, frame):
    raise RuntimeError('Deployment interrupted by signal ' + str(signum))


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in {'--check', '--deploy'}:
        raise SystemExit('Usage: deploy.py --check|--deploy reviewed_manifest_sha256')
    if Path(__file__).resolve().parent != STAGE or Path(__file__).absolute().parent != STAGE:
        raise RuntimeError('Unexpected release directory')
    check = sys.argv[1] == '--check'
    if not check:
        if os.geteuid() != 0:
            raise RuntimeError('Root required for code deployment')
        for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            signal.signal(signum, interrupted)
    with deployment_lock(check_only=check):
        manifest = checked_manifest(sys.argv[2])
        print(json.dumps(rollout(manifest, Runner(), check_only=check)))


if __name__ == '__main__':
    main()
