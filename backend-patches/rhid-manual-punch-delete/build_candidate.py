"""Generate a private, hash-pinned candidate from the reviewed live baseline."""
import difflib
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
from patch_sources import patch_sources

STAGE = Path('/home/opc/rhid-delete-20261020')
NAMES = ('channel_bridge.py', 'rhid_attendance_adjustments.py', 'rhid_calendar_snapshot.py')
PINNED = {
    'channel_bridge.py': 'f00982379874d719b7cb91f1c951bee2033b41e4b136b2f90d53248b5a49957e',
    'rhid_attendance_adjustments.py': '2e68f1b27d93875235934e2f61060e04be680e86190db1072c7fc1c421c2da00',
    'rhid_calendar_snapshot.py': 'b18c23c5f973b9f7328a64a7ba9fa0b25941201f03d391b4c5646c2ea2964b15',
}
MIRROR = {**PINNED, 'rhid_attendance_adjustments.py': '4ef82b7b3d82fa90109950a8de74044ad5a36e6bcd8ab852aab562f9655e3130',
          'rhid_calendar_snapshot.py': None}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def build():
    # Windows checkouts may deliver CRLF. Normalize only when the complete
    # resulting installer still matches the independently reviewed LF digest.
    shared = STAGE / 'shared-deploy.py'
    shared_data = shared.read_bytes().replace(b'\r\n', b'\n')
    if digest(shared_data) != '01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2':
        raise RuntimeError('Shared installer content drift')
    shared.write_bytes(shared_data)
    sources = {}
    for name in NAMES:
        data = (STAGE / 'baseline' / name).read_bytes()
        if digest(data) != PINNED[name]:
            raise RuntimeError('Reviewed baseline drift: ' + name)
        sources[name] = data.decode('utf-8')
    patched = patch_sources(sources)
    helper = 'rhid_manual_punch_removal.py'
    patched[helper] = (STAGE / helper).read_text(encoding='utf-8')
    manifest, patch = {'files': {}}, []
    candidate = STAGE / 'candidate'
    candidate.mkdir(exist_ok=True)
    for name, source in patched.items():
        compile(source, name, 'exec')
        data = source.encode('utf-8')
        path = candidate / name
        if path.exists() and path.read_bytes() != data:
            raise RuntimeError('Existing candidate differs: ' + name)
        path.write_bytes(data)
        manifest['files'][name] = {'before': PINNED.get(name), 'mirrorBefore': MIRROR.get(name), 'after': digest(data)}
        patch.extend(difflib.unified_diff(sources.get(name, '').splitlines(True), source.splitlines(True),
                                        fromfile='a/' + name, tofile='b/' + name))
    patch_data = ''.join(patch).encode('utf-8')
    (STAGE / 'source.patch').write_bytes(patch_data)
    with tarfile.open(STAGE / 'source-files.tar', 'w') as archive:
        for name, source in patched.items():
            data = source.encode('utf-8')
            info = tarfile.TarInfo(name)
            info.size, info.mode = len(data), 0o644
            archive.addfile(info, io.BytesIO(data))
    manifest['patch'] = digest(patch_data)
    manifest['archive'] = digest((STAGE / 'source-files.tar').read_bytes())
    manifest_data = (json.dumps(manifest, indent=2) + '\n').encode('utf-8')
    (STAGE / 'deploy-manifest.json').write_bytes(manifest_data)
    return {'manifestSha256': digest(manifest_data), 'files': manifest['files']}

if __name__ == '__main__':
    print(json.dumps(build()))
