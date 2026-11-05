"""Build exact public diff plus a pinned, guarded private deployment package."""
import argparse
import difflib
import hashlib
import json
from pathlib import Path
from patch_backend import patch
from deploy import BEFORE, FILES, MIRROR_PINS, INPUTS, SHARED_RUNNER_SHA


def digest(data):
    return hashlib.sha256(data).hexdigest()


def package(baseline, candidate, stage):
    folder = Path(__file__).resolve().parent
    diffs, pins = [], {}
    for relative in FILES:
        before = (baseline / relative).read_bytes()
        after = (candidate / relative).read_bytes()
        if digest(before) != BEFORE[relative] or patch(relative, before) != after:
            raise RuntimeError('Source drift or irreproducible candidate: ' + relative)
        diffs.append(''.join(difflib.unified_diff(before.decode().splitlines(keepends=True),
            after.decode().splitlines(keepends=True), fromfile='a/' + relative, tofile='b/' + relative, n=0)))
        pins[relative] = {'before': digest(before), 'after': digest(after)}
    (folder / 'source.patch').write_text(''.join(diffs), encoding='utf-8', newline='\n')
    runner = (folder.parent / 'launch-payroll-per-payment/deploy.py').read_bytes().replace(b'\r\n', b'\n')
    if digest(runner) != SHARED_RUNNER_SHA:
        raise RuntimeError('Shared runner source drift')
    files = {name: (runner if name == 'shared-deploy.py' else
        (folder / name).read_bytes().replace(b'\r\n', b'\n')) for name in INPUTS}
    manifest = {'files': pins, 'mirror': MIRROR_PINS,
                'inputs': {name: digest(files[name]) for name in sorted(files)}}
    serialized = (json.dumps(manifest, indent=2) + '\n').encode()
    (folder / 'deploy-manifest.json').write_bytes(serialized)
    files['deploy-manifest.json'] = serialized
    stage.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        target = stage / name
        if target.exists() and target.read_bytes() != data:
            raise RuntimeError('Release staging differs; use fresh directory: ' + name)
        target.write_bytes(data)
    print(json.dumps({'manifest': digest(serialized), 'files': pins, 'stage': str(stage)}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for arg in ('baseline', 'candidate', 'stage'):
        parser.add_argument('--' + arg, type=Path, required=True)
    args = parser.parse_args()
    package(args.baseline, args.candidate, args.stage)
