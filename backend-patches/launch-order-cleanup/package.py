"""Build a stage with only the pinned, reviewed deployment inputs."""
import hashlib
import json
from pathlib import Path
import sys


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main(output):
    source = Path(__file__).resolve().parent
    shared = source.parent / 'launch-payroll-attachments'
    manifest = (source / 'deploy-manifest.json').read_bytes()
    pins = json.loads(manifest)['inputs']
    files = {name: source / name for name in ('deploy.py', 'deploy.sh', 'patch_backend.py', 'source.patch')}
    files |= {'deploy_runner.py': shared / 'deploy.py', 'deployment_gate.sh': shared / 'deployment_gate.sh'}
    if files.keys() != pins.keys():
        raise RuntimeError('Unexpected package scope')
    payloads = {name: path.read_bytes().replace(b'\r\n', b'\n') for name, path in files.items()}
    for name, data in payloads.items():
        if digest(data) != pins[name]:
            raise RuntimeError(f'Unexpected digest for {name}')
    output.mkdir()
    for name, data in (payloads | {'deploy-manifest.json': manifest}).items():
        (output / name).write_bytes(data)
    print(digest(manifest))


if __name__ == '__main__':
    main(Path(sys.argv[1]))
