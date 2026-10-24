"""Apply only reviewed feature hunks to independently pinned fresh sources.

The output directory is private. No environment, state, business JSON or archive
is read or packaged. source.patch and deploy-manifest.json are review artifacts.
"""
import argparse
import difflib
import hashlib
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
FILES = ('worker/workflow.py', 'worker/workflow_config.json',
         'worker/contractor_employment.py', 'worker/supplier_registration_checkpoint.py')
ROOTS = {'app': '/opt/energetica-whatsapp', 'build': '/home/opc/energetica-build'}
DEPLOYMENT_HELPERS = {
    'deploy_context.py': 'cbf8f8434b00e7aaa5c148dec2c8c09f3b4aef734d0ea711e8fcce42370bca51',
    'patch_presence_context.py': 'e7ba490d03e70171d12afcd8f76713ccbaab65b7ec77b2f9464cf753b6d5aaa6'}
INPUTS = {
    'app': {'worker/workflow.py': ('workflow-app.py', '2c82834954b3e008e242677807db2ec9add12429fcbce6ccbefe2c9b11a95362'),
            'worker/workflow_config.json': ('workflow_config.json', '8d3c52efbda61e456405879e2910859acf415c5e781f8e444a3b17ca0f9161c5')},
    'build': {'worker/workflow.py': ('workflow.py', 'eeb8090314104d021f0dfc9a7b9eb0baff2ff861491454bc7aa6f5e8a8a8fc60'),
              'worker/workflow_config.json': ('workflow_config.json', '8d3c52efbda61e456405879e2910859acf415c5e781f8e444a3b17ca0f9161c5')}}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def apply_feature(content, relative):
    """Exact unique context only, no fuzzy patching or whole-source replacement."""
    patch = (HERE / 'feature.patch').read_text(encoding='utf-8')
    blocks = re.split(r'(?=^--- )', patch, flags=re.M)
    selected = [block for block in blocks if block.startswith('--- a/' + relative + '\n')]
    if len(selected) != 1:
        raise ValueError('Feature patch scope mismatch: ' + relative)
    text = content.decode('utf-8')
    for hunk in re.split(r'^@@[^\n]*\n', selected[0], flags=re.M)[1:]:
        lines = hunk.splitlines(keepends=True)
        if any(line[:1] not in {' ', '+', '-'} for line in lines):
            raise ValueError('Malformed feature hunk')
        before = ''.join(line[1:] for line in lines if line[0] in ' -')
        after = ''.join(line[1:] for line in lines if line[0] in ' +')
        if not before or text.count(before) != 1:
            raise RuntimeError('Feature context is not unique/current: ' + relative + ': ' + before[:100])
        text = text.replace(before, after, 1)
    return text.encode('utf-8')


def package(live, output):
    live, output = live.absolute(), output.absolute()
    if live.resolve() != live or output.resolve() != output or output.is_relative_to(HERE.parents[1]):
        raise ValueError('Use real captured sources and a private output outside the checkout')
    before, after = {}, {}
    # Validate ALL captured inputs before producing any candidate.
    for scope, mapping in INPUTS.items():
        for relative, (filename, expected) in mapping.items():
            path = live / filename
            if path.is_symlink() or path.parent.resolve() != path.parent:
                raise RuntimeError('Unexpected capture path')
            data = path.read_bytes()
            if digest(data) != expected:
                raise RuntimeError('Captured source hash drift: ' + filename)
            before[(scope, relative)] = data
    for scope in ROOTS:
        for relative in FILES:
            key = (scope, relative)
            after[key] = (apply_feature(before[key], relative) if key in before
                          else (HERE / Path(relative).name).read_bytes())
            if relative.endswith('.py'):
                compile(after[key], relative, 'exec')
            else:
                json.loads(after[key])
    ancillary = {'deploy.py': (HERE / 'deploy.py').read_bytes()}
    for name, expected in DEPLOYMENT_HELPERS.items():
        path = HERE.parent / 'attendance-rhid-badges' / name
        if path.is_symlink() or path.parent.resolve() != path.parent:
            raise RuntimeError('Unexpected deployment helper alias')
        content = path.read_text(encoding='utf-8').encode('utf-8')
        if digest(content) != expected:
            raise RuntimeError('Reviewed deployment helper hash drift: ' + name)
        ancillary['deployment_helpers/' + name] = content
    for name, content in ancillary.items():
        compile(content, name, 'exec')
    entries, diff = [], []
    for (scope, relative), data in after.items():
        candidate = scope + '/' + relative
        previous = before.get((scope, relative), b'')
        entries.append({'destination': ROOTS[scope] + '/' + relative, 'candidate': candidate,
            'before_sha256': digest(previous) if previous else None, 'after_sha256': digest(data)})
        diff.extend(difflib.unified_diff(previous.decode('utf-8').splitlines(True), data.decode('utf-8').splitlines(True),
            fromfile='a/' + candidate if previous else '/dev/null', tofile='b/' + candidate))
    patch = ''.join(diff).encode('utf-8')
    manifest = {'version': 2, 'files': entries, 'patch_sha256': digest(patch)}
    destinations = [output / scope / relative for scope, relative in after]
    destinations.extend(output / relative for relative in ancillary)
    destinations.extend([output / 'source.patch', output / 'deploy-manifest.json'])
    if any(path.is_symlink() or path.parent.resolve() != path.parent for path in destinations):
        raise RuntimeError('Unexpected private output alias')
    output.mkdir(parents=True, exist_ok=True)
    for (scope, relative), data in after.items():
        target = output / scope / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_symlink() or target.parent.resolve() != target.parent:
            raise RuntimeError('Unexpected private output alias')
        target.write_bytes(data)
    for relative, data in ancillary.items():
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    (output / 'source.patch').write_bytes(patch)
    (output / 'deploy-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8', newline='\n')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(package(args.live, args.output), indent=2))
