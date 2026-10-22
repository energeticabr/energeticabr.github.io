"""Read exact reviewed private sources; never extract archive paths."""
import hashlib
import json
from pathlib import Path
import tarfile

STAGE = Path(__file__).resolve().parent
FILES = ('worker/payment_provision_group.py', 'worker/payment_provision_flow.py', 'worker/workflow.py')


def patch(relative, before):
    if relative not in FILES:
        raise RuntimeError('Unexpected source scope')
    manifest = json.loads((STAGE / 'deploy-manifest.json').read_text(encoding='utf-8'))
    pins = manifest['files'][relative]
    if hashlib.sha256(before).hexdigest() != pins['before']:
        raise RuntimeError('Source baseline mismatch')
    with tarfile.open(STAGE / 'source-files.tar') as archive:
        members = archive.getmembers()
        if len(members) != len(FILES) or {member.name for member in members} != set(FILES):
            raise RuntimeError('Private source bundle scope mismatch')
        for member in members:
            if not member.isfile() or not 0 <= member.size <= 20_000_000:
                raise RuntimeError('Unexpected private source member')
        data = archive.extractfile(relative).read()
    if hashlib.sha256(data).hexdigest() != pins['after']:
        raise RuntimeError('Private source hash mismatch')
    return data
