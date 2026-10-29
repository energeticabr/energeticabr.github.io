"""Generate a reviewed, hash-pinned source diff; never include live records."""
import argparse
import difflib
import hashlib
import json
import io
import tarfile
from pathlib import Path

FILES = ('worker/workflow.py', 'worker/provision_description_settlement.py')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def package(baseline, candidate, output, mirror_hashes, archive_output=None):
    diff, manifest = [], {}
    for relative in FILES:
        before_path, after_path = baseline / relative, candidate / relative
        before = before_path.read_bytes() if before_path.exists() else b''
        after = after_path.read_bytes()
        if before == after:
            raise RuntimeError('Expected changed source: ' + relative)
        diff.extend(difflib.unified_diff(before.decode('utf-8').splitlines(True),
            after.decode('utf-8').splitlines(True),
            fromfile='a/' + relative if before else '/dev/null', tofile='b/' + relative))
        manifest[relative] = {'before': digest(before) if before else None,
                              'mirrorBefore': mirror_hashes.get(relative), 'after': digest(after)}
    patch = ''.join(diff).encode('utf-8')
    output.mkdir(parents=True, exist_ok=True)
    (output / 'source.patch').write_bytes(patch)
    # The full source bundle is private deployment material, not a public repo
    # artifact. Only its hash is included in the reviewed public manifest.
    archive_output = archive_output or output / 'source-files.tar'
    archive_output.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive_output, 'w') as archive:
        for relative in FILES:
            data = (candidate / relative).read_bytes()
            info = tarfile.TarInfo(relative)
            info.size, info.mode, info.mtime = len(data), 0o644, 0
            archive.addfile(info, io.BytesIO(data))
    (output / 'deploy-manifest.json').write_bytes((json.dumps(
        {'files': manifest, 'patch': digest(patch), 'archive': digest(archive_output.read_bytes())}, indent=2) + '\n').encode('utf-8'))
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--mirror-hashes', type=Path, required=True)
    parser.add_argument('--archive-output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(package(args.baseline, args.candidate, args.output,
                             json.loads(args.mirror_hashes.read_text(encoding='utf-8')), args.archive_output), indent=2))
