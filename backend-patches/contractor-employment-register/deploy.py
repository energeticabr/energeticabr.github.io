"""Eight independent CAS/create-only targets; shared locks and safe rollback."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen
from uuid import uuid4

HERE = Path(__file__).resolve().parent
HELPERS = HERE.parent / 'attendance-rhid-badges'
if not HELPERS.is_dir():
    HELPERS = HERE / 'deployment_helpers'
for name, expected in {
    'deploy_context.py': 'cbf8f8434b00e7aaa5c148dec2c8c09f3b4aef734d0ea711e8fcce42370bca51',
    'patch_presence_context.py': 'e7ba490d03e70171d12afcd8f76713ccbaab65b7ec77b2f9464cf753b6d5aaa6',
}.items():
    if hashlib.sha256((HELPERS / name).read_text(encoding='utf-8').encode('utf-8')).hexdigest() != expected:
        raise RuntimeError('Deployment helper differs from reviewed source: ' + name)
sys.path.insert(0, str(HELPERS))
import deploy_context as safe

FILES = ('worker/workflow.py', 'worker/workflow_config.json',
         'worker/contractor_employment.py', 'worker/supplier_registration_checkpoint.py')
NEW_HELPERS = set(FILES[2:])
ALLOWED = {root + '/' + relative: scope + '/' + relative
           for scope, root in [('app', '/opt/energetica-whatsapp'), ('build', '/home/opc/energetica-build')]
           for relative in FILES}
LOCKS = (Path('/tmp/energetica-whatsapp-deploy.lock'), Path('/home/opc/.energetica-deploy.lock'))
SERVICES = ('energetica-whatsapp.service', 'energetica-channel-bridge.service')


def validate_manifest(manifest):
    entries = manifest.get('files', [])
    if (manifest.get('version') != 2 or not isinstance(entries, list) or len(entries) != 8
            or any(not isinstance(entry, dict) for entry in entries)
            or {entry.get('destination') for entry in entries} != set(ALLOWED)):
        raise ValueError('Manifest scope must be exactly the eight reviewed targets')
    for entry in entries:
        if set(entry) != {'destination', 'candidate', 'before_sha256', 'after_sha256'}:
            raise ValueError('Manifest scope requires four explicit target properties')
        if entry.get('candidate') != ALLOWED[entry['destination']]:
            raise ValueError('Candidate path differs from reviewed scope')
        new = '/'.join(entry['candidate'].split('/')[1:]) in NEW_HELPERS
        if new != (entry.get('before_sha256') is None):
            raise ValueError('New helpers require pinned absent state; existing targets require CAS')
        hashes = ['after_sha256'] if new else ['before_sha256', 'after_sha256']
        if any(not re.fullmatch('[a-f0-9]{64}', str(entry.get(key, ''))) for key in hashes):
            raise ValueError('Expected lowercase SHA-256 hashes')
    if not re.fullmatch('[a-f0-9]{64}', str(manifest.get('patch_sha256', ''))):
        raise ValueError('Expected source patch hash')
    return entries


def absent(path):
    if path.parent.resolve() != path.parent or path.is_symlink() or os.path.lexists(path):
        raise RuntimeError('New helper is not absent or path is aliased: ' + str(path))
    if not path.parent.is_dir():
        raise RuntimeError('Missing existing worker directory')


def create_only(content, path, info):
    """Atomic link publication cannot replace another writer's newly made file."""
    absent(path)
    fd, name = tempfile.mkstemp(prefix='.contractor-employment-', dir=path.parent)
    staged = Path(name)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        if hasattr(os, 'chown'):
            os.chown(staged, info.st_uid, info.st_gid)
        os.chmod(staged, stat.S_IMODE(info.st_mode))
        absent(path)
        try:
            os.link(staged, path, follow_symlinks=False)
        except FileExistsError as error:
            raise RuntimeError('Concurrent helper publication preserved: ' + str(path)) from error
        if os.name != 'nt':
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        staged.unlink(missing_ok=True)


class SystemRunner:
    def health(self):
        subprocess.run(['systemctl', 'is-active', '--quiet', *SERVICES], check=True, timeout=5)
        for port in (8080, 8765):
            with urlopen('http://127.0.0.1:' + str(port) + '/health', timeout=3) as response:
                body = response.read()
                healthy = body.strip() == b'ok' if port == 8080 else json.loads(body).get('status') == 'ok'
                if response.status != 200 or not healthy:
                    raise RuntimeError('Backend health failed')
        return True

    def restart(self):
        subprocess.run(['systemctl', 'restart', *SERVICES], check=True, timeout=45)
        for attempt in range(20):
            try:
                self.health()
                return
            except Exception:
                if attempt == 19:
                    raise
                time.sleep(.5)


def deploy(stage, apply=False, *, expected_manifest_hash, runner=None):
    """The caller pins the reviewed manifest; the installer always holds both locks."""
    stage = Path(stage).absolute()
    if stage.resolve() != stage or stage.is_symlink():
        raise ValueError('Unexpected candidate stage alias')
    runner = runner or SystemRunner()
    with safe.deployment_locks(LOCKS):
        if not re.fullmatch('[a-f0-9]{64}', str(expected_manifest_hash)):
            raise RuntimeError('Manifest hash required')
        try:
            manifest = json.loads(safe.checked(stage / 'deploy-manifest.json', expected_manifest_hash))
        except RuntimeError as error:
            raise RuntimeError('Manifest hash mismatch or unsafe path') from error
        entries = validate_manifest(manifest)
        try:
            safe.checked(stage / 'source.patch', manifest['patch_sha256'])
        except RuntimeError as error:
            raise RuntimeError('Source patch mismatch or unsafe path') from error
        originals, candidates, attributes = {}, {}, {}
        for entry in entries:
            target = Path(entry['destination'])
            if stage == target.parent.parent or stage.is_relative_to(target.parent.parent):
                raise ValueError('Backup and candidate stage must be outside live code roots')
            if entry['before_sha256'] is None:
                absent(target)
                attributes[target] = (target.parent / 'workflow.py').stat()
            else:
                originals[target] = safe.checked(target, entry['before_sha256'])
                attributes[target] = target.stat()
            candidates[target] = safe.checked(stage / entry['candidate'], entry['after_sha256'])
            if target.suffix == '.py':
                compile(candidates[target], str(target), 'exec')
            else:
                json.loads(candidates[target])
        if runner.health() is False:
            raise RuntimeError('Backend health failed')
        receipt = {'status': 'checked', 'codeHashes': {e['destination']: e['after_sha256'] for e in entries}}
        if not apply:
            return receipt
        backup = stage.parent / ('contractor-employment-backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-' + uuid4().hex[:8])
        backup.mkdir(mode=0o700)
        for number, entry in enumerate(entries):
            target = Path(entry['destination'])
            if entry['before_sha256'] is None:
                absent(target)
            else:
                safe.checked(target, entry['before_sha256'])
                shutil.copy2(target, backup / str(number))
                safe.checked(backup / str(number), entry['before_sha256'])
        attempted = []
        try:
            # Publish helpers first so no installed workflow depends on absent code.
            for entry in sorted(entries, key=lambda e: e['before_sha256'] is not None):
                target = Path(entry['destination'])
                attempted.append(entry)
                if entry['before_sha256'] is None:
                    create_only(candidates[target], target, attributes[target])
                else:
                    safe.install(candidates[target], target, attributes[target], entry['before_sha256'])
                safe.checked(target, entry['after_sha256'])
            runner.restart()
            if runner.health() is False:
                raise RuntimeError('Backend health failed')
            for entry in entries:
                safe.checked(Path(entry['destination']), entry['after_sha256'])
        except BaseException as failure:
            errors, retained = [], []
            for entry in reversed(attempted):
                target = Path(entry['destination'])
                if entry['before_sha256'] is None:
                    # Unlink has no portable CAS. Retain inactive helpers instead.
                    if os.path.lexists(target):
                        try:
                            content = safe.checked(target, safe.digest(target))
                            retained.append({'path': str(target), 'sha256': hashlib.sha256(content).hexdigest(),
                                'matchesCandidate': hashlib.sha256(content).hexdigest() == entry['after_sha256']})
                        except Exception as error:
                            errors.append(str(error))
                    continue
                try:
                    if safe.digest(target) != entry['before_sha256']:
                        safe.install(originals[target], target, attributes[target], entry['after_sha256'])
                    safe.checked(target, entry['before_sha256'])
                except Exception as error:
                    errors.append(str(error))
            try:
                runner.restart()
                if runner.health() is False:
                    errors.append('Restored service health failed')
            except Exception as error:
                errors.append(str(error))
            receipt.update(status='rollback_incomplete' if errors else 'rolled_back', errors=errors,
                retainedHelpers=retained, backup=str(backup))
            (backup / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
            if errors:
                raise RuntimeError('Rollback incomplete; recovery retained at ' + str(backup) + ': ' + '; '.join(errors)) from failure
            raise
        receipt.update(status='published', serviceHealth=True, backup=str(backup))
        (backup / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
        return receipt


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', type=Path)
    parser.add_argument('--manifest-sha256', required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(json.dumps(deploy(args.stage, apply=args.apply, expected_manifest_hash=args.manifest_sha256)))
