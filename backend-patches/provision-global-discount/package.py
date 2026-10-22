"""Build public diff/pins and a private source archive from verified snapshots."""
import difflib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile

PUBLIC = Path(__file__).resolve().parent
REPOSITORY = PUBLIC.parents[1]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def package(workspace):
    workspace = Path(workspace).resolve()
    if workspace.is_relative_to(REPOSITORY):
        raise ValueError('The source bundle must remain outside the public repository')
    spec = importlib.util.spec_from_file_location('global_discount_deploy_config', PUBLIC / 'deploy.py')
    deployment = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(deployment)
    payloads, files, patches = {}, {}, []
    for relative in deployment.FILES:
        before = (workspace / 'baseline' / relative).read_bytes()
        after = (workspace / 'candidate' / relative).read_bytes()
        if digest(before) != deployment.BEFORE[relative] or before == after:
            raise RuntimeError('Unexpected source baseline or unchanged file: ' + relative)
        compile(after, relative, 'exec')
        payloads[relative] = after
        files[relative] = {'before': digest(before), 'after': digest(after)}
        patches.extend(difflib.unified_diff(before.decode('utf-8').splitlines(True),
            after.decode('utf-8').splitlines(True), fromfile='a/' + relative, tofile='b/' + relative, n=0))
    (PUBLIC / 'source.patch').write_bytes(''.join(patches).encode('utf-8'))
    with tarfile.open(workspace / 'source-files.tar', 'w', format=tarfile.USTAR_FORMAT) as archive:
        for relative, data in payloads.items():
            member = tarfile.TarInfo(relative)
            member.size, member.mode, member.mtime = len(data), 0o644, 0
            archive.addfile(member, io.BytesIO(data))
    runner = (REPOSITORY / 'backend-patches/launch-payroll-per-payment/deploy.py').read_bytes().replace(b'\r\n', b'\n')
    if digest(runner) != deployment.SHARED_RUNNER_SHA:
        raise RuntimeError('Shared installer source drift')
    (workspace / 'shared-deploy.py').write_bytes(runner)
    inputs = {}
    for name in deployment.INPUTS:
        root = workspace if name in {'source-files.tar', 'shared-deploy.py'} else PUBLIC
        inputs[name] = digest((root / name).read_bytes())
    manifest = {'files': files, 'mirror': deployment.MIRROR_PINS, 'inputs': inputs}
    (PUBLIC / 'deploy-manifest.json').write_bytes((json.dumps(manifest, indent=2, sort_keys=True) + '\n').encode('utf-8'))
    return manifest


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: package.py PRIVATE_WORKSPACE')
    print(json.dumps(package(sys.argv[1]), indent=2, sort_keys=True))
