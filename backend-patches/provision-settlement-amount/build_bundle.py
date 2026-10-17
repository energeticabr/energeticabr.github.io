"""Build a four-file patch and private source bundle from verified snapshots.

Usage: python build_bundle.py PRIVATE_WORKSPACE
Only source.patch/deploy-manifest.json belong in git; source-files.tar stays private.
"""
import difflib
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile

FILES = ('worker/provision_description_settlement.py', 'worker/provision_description_query.py',
         'worker/clients.py', 'worker/workflow.py')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    workspace = Path(sys.argv[1])
    destination = Path(__file__).resolve().parent
    manifest, patches = {}, []
    with tarfile.open(workspace / 'source-files.tar', 'w', format=tarfile.USTAR_FORMAT) as archive:
        for relative in FILES:
            before = (workspace / 'baseline' / relative).read_bytes()
            after = (workspace / 'candidate' / relative).read_bytes()
            if before == after:
                raise ValueError('Unexpected unchanged file: ' + relative)
            manifest[relative] = {'before': digest(before), 'mirrorBefore': digest(before), 'after': digest(after)}
            patches.extend(difflib.unified_diff(before.decode('utf-8').splitlines(keepends=True),
                                               after.decode('utf-8').splitlines(keepends=True),
                                               fromfile='a/' + relative, tofile='b/' + relative))
            entry = tarfile.TarInfo(relative)
            entry.size, entry.mode = len(after), 0o644
            archive.addfile(entry, io.BytesIO(after))
    patch = ''.join(patches).encode('utf-8')
    (destination / 'source.patch').write_bytes(patch)
    result = {'files': manifest, 'patch': digest(patch),
              'archive': digest((workspace / 'source-files.tar').read_bytes())}
    (destination / 'deploy-manifest.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
