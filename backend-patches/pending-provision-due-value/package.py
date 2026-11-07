"""Generate the pinned release from independently fetched production and mirror source."""
import difflib
import hashlib
import json
from pathlib import Path

from patch_backend import RELATIVE, patch

root = Path(__file__).resolve().parent
files = {}
for label, target in [('production', '/opt/energetica-whatsapp'), ('mirror', '/home/opc/energetica-build')]:
    before = (root / f'{label}.py').read_bytes()
    after = patch(RELATIVE, before)
    (root / f'{label}-candidate.py').write_bytes(after)
    files[f'{target}/{RELATIVE}'] = {'before': hashlib.sha256(before).hexdigest(), 'after': hashlib.sha256(after).hexdigest()}
    if label == 'production':
        diff = difflib.unified_diff(before.decode().splitlines(), after.decode().splitlines(),
                                    'a/' + RELATIVE, 'b/' + RELATIVE, lineterm='')
        (root / 'source.patch').write_bytes(('\n'.join(diff) + '\n').encode())

inputs = {}
for name in ('deploy.py', 'patch_backend.py', 'source.patch', 'deploy.sh', 'deployment_gate.sh'):
    path = root / name
    data = path.read_bytes().replace(b'\r\n', b'\n')
    path.write_bytes(data)
    inputs[name] = hashlib.sha256(data).hexdigest()

data = (json.dumps({'files': files, 'inputs': inputs}, indent=2) + '\n').encode()
(root / 'deploy-manifest.json').write_bytes(data)
print(hashlib.sha256(data).hexdigest())
