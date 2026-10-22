"""Generate a pinned bridge candidate outside the public source repository."""
import difflib
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

PUBLIC = Path(__file__).resolve().parent
REPOSITORY = PUBLIC.parents[1]


def module(name):
    spec = importlib.util.spec_from_file_location('append_' + name, PUBLIC / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def digest(data):
    return hashlib.sha256(data).hexdigest()


def package(workspace):
    workspace = Path(workspace).resolve()
    if workspace.is_relative_to(REPOSITORY):
        raise ValueError('Private candidate must remain outside the source repository')
    deployment, patcher = module('deploy'), module('patch_backend')
    before = (workspace / 'baseline/channel_bridge.py').read_bytes()
    if digest(before) != deployment.BEFORE['channel_bridge.py']:
        raise ValueError('Live bridge baseline mismatch')
    after = patcher.patch_bridge(before.decode('utf-8')).encode('utf-8')
    compile(after, 'channel_bridge.py', 'exec')
    (workspace / 'candidate').mkdir(exist_ok=True)
    (workspace / 'candidate/channel_bridge.py').write_bytes(after)
    diff = ''.join(difflib.unified_diff(before.decode().splitlines(True), after.decode().splitlines(True),
                                      fromfile='a/channel_bridge.py', tofile='b/channel_bridge.py', n=0))
    (PUBLIC / 'source.patch').write_bytes(diff.encode())
    runner = (REPOSITORY / 'backend-patches/launch-payroll-per-payment/deploy.py').read_bytes().replace(b'\r\n', b'\n')
    if digest(runner) != deployment.SHARED_RUNNER_SHA:
        raise ValueError('Reviewed deployment runner mismatch')
    (workspace / 'shared-deploy.py').write_bytes(runner)
    inputs = {name: digest(((workspace if name == 'shared-deploy.py' else PUBLIC) / name).read_bytes())
              for name in deployment.INPUTS}
    manifest = {'files': {'channel_bridge.py': {'before': digest(before), 'after': digest(after)}},
                'mirror': deployment.MIRROR_PINS, 'inputs': inputs}
    (PUBLIC / 'deploy-manifest.json').write_bytes((json.dumps(manifest, indent=2, sort_keys=True) + '\n').encode())
    return manifest


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: package.py PRIVATE_WORKSPACE')
    print(json.dumps(package(sys.argv[1]), indent=2, sort_keys=True))
