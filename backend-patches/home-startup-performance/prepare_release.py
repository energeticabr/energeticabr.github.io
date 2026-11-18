"""Prepare the reviewed manifest from an exact captured production baseline."""
import difflib
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import patch_backend

package = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('startup_deploy', package / 'deploy.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
before = Path(sys.argv[1]).read_bytes()
if hashlib.sha256(before).hexdigest() != deploy.BEFORE['worker/workflow.py']:
    raise RuntimeError('Captured baseline does not match the reviewed source pin')
after = patch_backend.patch('worker/workflow.py', before)
(package / 'source.patch').write_text(''.join(difflib.unified_diff(
    before.decode().splitlines(keepends=True), after.decode().splitlines(keepends=True),
    fromfile='a/worker/workflow.py', tofile='b/worker/workflow.py')), encoding='utf-8')
manifest = {'files': {'worker/workflow.py': {'before': hashlib.sha256(before).hexdigest(),
    'after': hashlib.sha256(after).hexdigest()}}, 'mirror': deploy.MIRROR_PINS,
    'inputs': {name: hashlib.sha256((package / name).read_bytes()).hexdigest() for name in sorted(deploy.INPUTS)}}
data = json.dumps(manifest, indent=2).encode() + b'\n'
(package / 'deploy-manifest.json').write_bytes(data)
print(json.dumps({'manifest_sha256': hashlib.sha256(data).hexdigest(), 'after': manifest['files']['worker/workflow.py']['after']}))
