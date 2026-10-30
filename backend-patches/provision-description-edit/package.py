"""Freeze only final reviewed private candidates; never called during preparation."""
import difflib
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import types

PUBLIC = Path(__file__).resolve().parent
REPOSITORY = PUBLIC.parents[1]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def freeze(workspace, *, deployment=None):
    workspace = Path(workspace).resolve()
    if workspace.is_relative_to(REPOSITORY.resolve()):
        raise RuntimeError('Private sources must remain outside repository')
    if deployment is None:
        deployment = types.ModuleType('description_deployment')
        deployment.__file__ = str(PUBLIC / 'deploy.py')
        exec(compile((PUBLIC / 'deploy.py').read_bytes(), deployment.__file__, 'exec'), deployment.__dict__)
    pins = deployment.BEFORE
    for folder in ('baseline', 'candidate'):
        for name, pin in deployment.GUARDS.items():
            deployment.pinned(workspace / folder / name, pin, 'Private unchanged-source guard drift')
    release = workspace / 'release'
    if release.exists() or release.is_symlink():
        raise RuntimeError('Release already exists; never overwrite a frozen package')
    payloads, files, diff = {}, {}, []
    for name in deployment.FILES:
        old = deployment.pinned(workspace / 'baseline' / name, pins[name], 'Private baseline drift')
        candidate = workspace / 'candidate' / name
        deployment.plain(candidate)
        new = candidate.read_bytes()
        if digest(old) != pins[name] or old == new:
            raise RuntimeError('Private baseline drift or unchanged candidate: ' + name)
        compile(new, name, 'exec')
        payloads[name] = new
        files[name] = {'before': digest(old), 'after': digest(new)}
        diff.extend(difflib.unified_diff(old.decode('utf-8').splitlines(True), new.decode('utf-8').splitlines(True),
                                         fromfile='a/' + name, tofile='b/' + name, n=0))
    patch = ''.join(diff).encode('utf-8')
    inputs = {n: (patch if n == 'source.patch' else (PUBLIC / n).read_bytes()) for n in deployment.INPUTS}
    manifest = {'version': 1, 'files': files, 'guards': dict(deployment.GUARDS),
                'inputs': {n: digest(data) for n, data in inputs.items()}}
    deployment.validate_manifest(manifest)
    encoded = (json.dumps(manifest, indent=2, sort_keys=True) + '\n').encode('utf-8')
    with tempfile.TemporaryDirectory(prefix='.description-package-', dir=workspace) as temporary:
        staging = Path(temporary) / 'release'
        staging.mkdir(mode=0o700)
        for name, data in payloads.items():
            target = staging / 'candidate' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        for name, data in inputs.items():
            (staging / name).write_bytes(data)
        (staging / 'deploy-manifest.json').write_bytes(encoded)
        for name, data in payloads.items():
            if digest((staging / 'candidate' / name).read_bytes()) != files[name]['after']:
                raise RuntimeError('Package readback failed')
        staging.rename(release)
    # Public files contain only reviewed zero-context diff and hashes; full
    # engine/helper sources remain exclusively in the private release directory.
    (PUBLIC / 'source.patch').write_bytes(patch)
    (PUBLIC / 'deploy-manifest.json').write_bytes(encoded)
    return manifest


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] != '--freeze':
        raise SystemExit('Usage after main freeze approval: package.py --freeze PRIVATE_WORKSPACE')
    result = freeze(sys.argv[2])
    print(json.dumps({'manifest': result, 'manifestSha256': digest((Path(sys.argv[2]) / 'release/deploy-manifest.json').read_bytes())}, indent=2))
