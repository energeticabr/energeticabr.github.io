"""Four-file CAS rollout using the existing non-clobber installer and locks."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from urllib.request import urlopen

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

ALLOWED = {root + '/' + relative: scope + '/' + relative
           for scope, root in [('app', '/opt/energetica-whatsapp'), ('build', '/home/opc/energetica-build')]
           for relative in ('worker/workflow.py', 'worker/workflow_config.json')}
SERVICES = ('energetica-whatsapp.service', 'energetica-channel-bridge.service')


def validate_manifest(manifest):
    files = manifest.get('files', [])
    if len(files) != 4 or {entry.get('destination') for entry in files} != set(ALLOWED):
        raise ValueError('Manifest must contain exactly the four reviewed workflow/config targets')
    for entry in files:
        if entry.get('candidate') != ALLOWED[entry['destination']]:
            raise ValueError('Candidate path differs from reviewed target mapping')
        if any(not re.fullmatch('[a-f0-9]{64}', str(entry.get(key, '')))
               for key in ('before_sha256', 'after_sha256')):
            raise ValueError('Expected lowercase SHA-256 hashes')
    return files


def health():
    subprocess.run(['systemctl', 'is-active', '--quiet', *SERVICES], check=True, timeout=5)
    for port in (8080, 8765):
        with urlopen('http://127.0.0.1:' + str(port) + '/health', timeout=3) as response:
            body = response.read()
            healthy = body.strip() == b'ok' if port == 8080 else json.loads(body).get('status') == 'ok'
            if response.status != 200 or not healthy:
                raise RuntimeError('Backend health failed')


def restart():
    subprocess.run(['systemctl', 'restart', *SERVICES], check=True, timeout=45)
    for attempt in range(20):
        try:
            health()
            return
        except Exception:
            if attempt == 19:
                raise
            time.sleep(.5)


def deploy(stage, apply=False):
    stage = Path(stage).absolute()
    if stage.resolve() != stage or not str(stage).startswith('/home/opc/whatsapp-binary-snapshot-'):
        raise ValueError('Unexpected private candidate stage')
    manifest_bytes = (HERE / 'deploy-manifest.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    if json.loads((stage / 'deploy-manifest.json').read_bytes()) != manifest:
        raise ValueError('Candidate manifest differs from reviewed manifest')
    files = validate_manifest(manifest)
    originals, candidates, attributes = {}, {}, {}
    for entry in files:
        path = Path(entry['destination'])
        originals[path] = safe.checked(path, entry['before_sha256'])
        candidates[path] = safe.checked(stage / entry['candidate'], entry['after_sha256'])
        attributes[path] = path.stat()
        if path.suffix == '.py':
            compile(candidates[path], str(path), 'exec')
        else:
            json.loads(candidates[path])
    health()
    receipt = {'status': 'checked', 'codeHashes': {entry['destination']: entry['after_sha256'] for entry in files}}
    if not apply:
        return receipt
    backup = stage.parent / ('whatsapp-binary-backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(mode=0o700)
    for index, entry in enumerate(files):
        path = Path(entry['destination'])
        safe.checked(path, entry['before_sha256'])
        shutil.copy2(path, backup / str(index))
        safe.checked(backup / str(index), entry['before_sha256'])
    attempted = []
    try:
        for entry in files:
            path = Path(entry['destination'])
            attempted.append(entry)
            safe.install(candidates[path], path, attributes[path], entry['before_sha256'])
            safe.checked(path, entry['after_sha256'])
        restart()
        for entry in files:
            safe.checked(Path(entry['destination']), entry['after_sha256'])
    except BaseException as failure:
        errors = []
        for entry in reversed(attempted):
            path = Path(entry['destination'])
            try:
                if safe.digest(path) == entry['before_sha256']:
                    continue
                safe.install(originals[path], path, attributes[path], entry['after_sha256'])
            except Exception as error:
                errors.append(str(error))
        try:
            restart()
        except Exception as error:
            errors.append(str(error))
        if errors:
            raise RuntimeError('Rollback incomplete; recovery retained at ' + str(backup) + ': ' + '; '.join(errors)) from failure
        raise
    receipt.update(status='published', serviceHealth=True, backup=str(backup))
    (backup / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    return receipt


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[2] not in ('--check', '--apply'):
        raise SystemExit('Usage: deploy.py CANDIDATE_STAGE --check|--apply')
    with safe.deployment_locks([Path('/tmp/energetica-whatsapp-deploy.lock'), Path('/home/opc/.energetica-deploy.lock')]):
        print(json.dumps(deploy(sys.argv[1], sys.argv[2] == '--apply')))
