"""Generate reviewed input pins locally; never stage or deploy anything remotely."""
import argparse
import hashlib
import json
from pathlib import Path
import types

PACKAGE = Path(__file__).resolve().parent


def local_module(name, path):
    module = types.ModuleType(name)
    module.__file__ = str(path)
    exec(compile(path.read_bytes(), str(path), 'exec'), module.__dict__)
    return module


def build_manifest(source, shared_runner):
    deploy = local_module('document_person_manifest_deploy', PACKAGE / 'deploy.py')
    raw = deploy.pinned(Path(source), deploy.BEFORE['channel_bridge.py'], 'Source pin mismatch')
    deploy.pinned(Path(shared_runner), deploy.SHARED_RUNNER_SHA, 'Shared runner drift')
    deploy.pinned(PACKAGE / 'deployment_gate.sh', deploy.GATE_SHA, 'Ingress gate drift')
    patcher = local_module('document_person_manifest_patch', PACKAGE / 'patch_bridge.py')
    candidate = patcher.patch_bridge(raw.decode('utf-8')).encode('utf-8')
    manifest = {
        'files': {name: {'before': deploy.BEFORE[name], 'after': deploy.AFTER[name]} for name in deploy.FILES},
        'mirror': dict(deploy.MIRROR_PINS),
        'inputs': {name: deploy.digest(Path(shared_runner) if name == 'shared-deploy.py' else PACKAGE / name)
                   for name in sorted(deploy.INPUTS)},
    }
    deploy.validate_candidates(manifest, {'channel_bridge.py': candidate})
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--shared-runner', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    data = (json.dumps(build_manifest(args.source, args.shared_runner), indent=2) + '\n').encode('utf-8')
    with args.output.open('xb') as output:
        output.write(data)
    print(hashlib.sha256(data).hexdigest())


if __name__ == '__main__':
    main()
