"""CAS-protected rollout preserving independent production/mirror changes."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
from urllib.request import urlopen

from patch_workflow import patch_workflow

HELPERS = Path('/home/opc/home-today-attendance-20261013')
EXPECTED_HELPERS = {
    'deploy_context.py': 'cbf8f8434b00e7aaa5c148dec2c8c09f3b4aef734d0ea711e8fcce42370bca51',
    'patch_presence_context.py': 'e7ba490d03e70171d12afcd8f76713ccbaab65b7ec77b2f9464cf753b6d5aaa6',
}
for name, expected in EXPECTED_HELPERS.items():
    assert hashlib.sha256((HELPERS / name).read_bytes()).hexdigest() == expected, name
sys.path.insert(0, str(HELPERS))
import deploy_context as safe

EXPECTED = {
    Path('/opt/energetica-whatsapp/worker/workflow.py'): '4801ef5206e78c176176017204702f6fc09a650b554efd8397ce789a145cbc8b',
    Path('/home/opc/energetica-build/worker/workflow.py'): '7837c3b1ce1688fabcc63e23d4c8c1d21c7c14e041aa2e1d0f346182f010f3d3',
}
TESTED = Path('/home/opc/presence-pending-20261118/candidate/workflow.py')


def health():
    subprocess.run(['systemctl', 'is-active', '--quiet', 'energetica-channel-bridge.service'], check=True)
    with urlopen('http://127.0.0.1:8765/health', timeout=5) as response:
        result = json.load(response)
        assert response.status == 200 and result.get('status') == 'ok'
    return result


def restart():
    subprocess.run(['systemctl', 'restart', 'energetica-channel-bridge.service'], check=True)
    for attempt in range(20):
        try:
            return health()
        except Exception:
            if attempt == 19:
                raise
            time.sleep(.5)


def deploy(apply=False):
    originals = {p: safe.checked(p, expected) for p, expected in EXPECTED.items()}
    candidates = {}
    for p, content in originals.items():
        text = content.decode('utf-8')
        newline = '\r\n' if '\r\n' in text else '\n'
        updated = patch_workflow(text.replace('\r\n', '\n'))
        candidates[p] = updated.replace('\n', newline).encode('utf-8')
    live = next(iter(EXPECTED))
    assert candidates[live] == TESTED.read_bytes(), 'Production candidate must match the tested bytes'
    attributes = {p: p.stat() for p in EXPECTED}
    configs = {p.parent / 'workflow_config.json': safe.digest(p.parent / 'workflow_config.json') for p in EXPECTED}
    after = {p: hashlib.sha256(content).hexdigest() for p, content in candidates.items()}
    def check_configs():
        for p, digest in configs.items():
            safe.checked(p, digest)
    health()
    check_configs()
    if not apply:
        return {'status': 'checked', 'hashes': {str(p): digest for p, digest in after.items()}}
    attempted = []
    try:
        for p, content in candidates.items():
            attempted.append(p)
            safe.install(content, p, attributes[p], EXPECTED[p])
            safe.checked(p, after[p])
        result = restart()
        for p, digest in after.items():
            safe.checked(p, digest)
        check_configs()
        return {'status': 'published', 'hashes': {str(p): digest for p, digest in after.items()}, 'health': result}
    except Exception as failure:
        errors = []
        for p in reversed(attempted):
            try:
                current = safe.digest(p)
                if current == EXPECTED[p]:
                    continue
                safe.install(originals[p], p, attributes[p], after[p])
            except Exception as error:
                errors.append(str(error))
        try:
            restart()
        except Exception as error:
            errors.append(str(error))
        if errors:
            raise RuntimeError('Rollback incomplete; recovery copies preserved: ' + '; '.join(errors)) from failure
        raise


if __name__ == '__main__':
    assert len(sys.argv) == 2 and sys.argv[1] in ('--check', '--apply')
    with safe.deployment_locks([Path('/tmp/energetica-whatsapp-deploy.lock'), Path('/home/opc/.energetica-deploy.lock')]):
        print(json.dumps(deploy(sys.argv[1] == '--apply')))
