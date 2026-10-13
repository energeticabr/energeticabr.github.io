"""Hash-guarded workflow-only rollout using the existing non-clobber installer."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
from urllib.request import urlopen

STAGE = Path('/home/opc/home-today-attendance-20261013')
BEFORE = '70558a64d50da382e28825486716f952c7c0c2f7725596c4e9552bd3d6dda135'
AFTER = '910a6d02e87c35c83af13914fc43e34e014caa24ad5c3fffe455547b42c55c85'
HELPERS = {'deploy_context.py': 'cbf8f8434b00e7aaa5c148dec2c8c09f3b4aef734d0ea711e8fcce42370bca51',
           'patch_presence_context.py': 'e7ba490d03e70171d12afcd8f76713ccbaab65b7ec77b2f9464cf753b6d5aaa6'}
for name, expected in HELPERS.items():
    if hashlib.sha256((STAGE / name).read_bytes()).hexdigest() != expected:
        raise RuntimeError('Installer helper changed: ' + name)
sys.path.insert(0, str(STAGE))
import deploy_context as safe

def health():
    subprocess.run(['systemctl', 'is-active', '--quiet', 'energetica-channel-bridge.service'], check=True)
    with urlopen('http://127.0.0.1:8765/health', timeout=5) as response:
        result = json.load(response)
        assert response.status == 200 and result.get('status') == 'ok'
    return result

def restart():
    subprocess.run(['systemctl', 'restart', 'energetica-channel-bridge.service'], check=True)
    for attempt in range(20):
        try: return health()
        except Exception:
            if attempt == 19: raise
            time.sleep(.5)

def deploy(apply=False):
    roots = (Path('/opt/energetica-whatsapp'), Path('/home/opc/energetica-build'))
    targets = [root / 'worker/workflow.py' for root in roots]
    candidate = safe.checked(STAGE / 'final/worker/workflow.py', AFTER)
    compile(candidate, 'workflow.py', 'exec')
    originals = {target: safe.checked(target, BEFORE) for target in targets}
    attributes = {target: target.stat() for target in targets}
    configs = {root / 'worker/workflow_config.json': safe.digest(root / 'worker/workflow_config.json') for root in roots}
    def check_configs():
        for path, expected in configs.items(): safe.checked(path, expected)
    health()
    check_configs()
    if not apply: return {'status': 'checked', 'candidate': AFTER}
    changed = []
    try:
        for target in targets:
            safe.install(candidate, target, attributes[target], BEFORE)
            changed.append(target)
            safe.checked(target, AFTER)
        result = restart()
        for target in targets: safe.checked(target, AFTER)
        check_configs()
        return {'status': 'published', 'hash': AFTER, 'health': result,
                'recovery': 'Originals preserved in .rhid-context-recovery-* beside each workflow.py'}
    except Exception as failure:
        errors = []
        for target in reversed(changed):
            try:
                safe.install(originals[target], target, attributes[target], AFTER)
            except Exception as error:
                errors.append(str(error))
        try: restart()
        except Exception as error: errors.append(str(error))
        if errors:
            raise RuntimeError('Rollback incomplete; preserved recovery copies: ' + '; '.join(errors)) from failure
        raise

if __name__ == '__main__':
    assert len(sys.argv) == 2 and sys.argv[1] in ('--check', '--apply')
    with safe.deployment_locks([Path('/tmp/energetica-whatsapp-deploy.lock'), Path('/home/opc/.energetica-deploy.lock')]):
        print(json.dumps(deploy(sys.argv[1] == '--apply')))
