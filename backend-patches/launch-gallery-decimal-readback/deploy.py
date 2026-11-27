"""Validate and deploy numeric readback for the shared launch gallery."""
import argparse
from datetime import datetime, timezone
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
from textwrap import indent

DIRECTORY = Path(__file__).resolve().parent
shared_source = DIRECTORY / 'shared_rollout.py'
if not shared_source.is_file():
    shared_source = DIRECTORY.parent / 'sharepoint-decimal-readback/deploy.py'
spec = importlib.util.spec_from_file_location('decimal_readback_rollout', shared_source)
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)

BASELINES = {
    '/opt/energetica-whatsapp': '321d5286d5b4122527d6c2b4976fe99eb6f3eb74a603974caae8cbf5d6756244',
    '/home/opc/energetica-build': '934e366b4dadf980980d88f038159ba68bbe160717247fc0677b36e00ecd48b2',
}
SOURCE = Path('worker/launch_gallery.py')


def candidate(before):
    source = before.decode('utf-8')
    newline = '\r\n' if '\r\n' in source else '\n'
    source = source.replace('\r\n', '\n')
    prefix, separator, function = source.partition('def _number(value, blank_zero=False):\n')
    if not separator:
        raise RuntimeError('Gallery number parser not found')
    start = '    if raw.startswith("R$"):\n'
    end = '    try:\n        result = Decimal(raw)'
    if start not in function or end not in function:
        raise RuntimeError('Gallery number parser changed')
    head, _, remainder = function.partition(start)
    block, marker, tail = (start + remainder).partition(end)
    # A JSON number can use an exponent, while typed strings keep their existing grammar.
    patched = prefix + separator + head + '    if isinstance(value, str):\n' + indent(block, '    ') + marker + tail
    encoded = patched.replace('\n', newline).encode('utf-8')
    compile(encoded, str(SOURCE), 'exec')
    return encoded


def checked_files():
    files = {}
    for root, expected in BASELINES.items():
        path = Path(root) / SOURCE
        original = path.read_bytes()
        if path.is_symlink() or shared.digest(original) != expected:
            raise RuntimeError('Gallery baseline changed at ' + str(path))
        files[path] = (original, candidate(original), path.stat())
    return files


def test_candidate(candidate_bytes):
    with tempfile.TemporaryDirectory(prefix='launch-gallery-decimal-') as temporary:
        worker = Path(temporary)
        (worker / SOURCE.name).write_bytes(candidate_bytes)
        search_path = os.pathsep.join(map(str, (worker, shared.ROOTS[0] / 'worker', shared.ROOTS[0])))
        env = {**os.environ, 'GALLERY_WORKER': str(worker), 'PYTHONPATH': search_path}
        subprocess.run([sys.executable, '-B', str(DIRECTORY / 'test_gallery_decimal.py'), '-v'],
                       check=True, env=env)


def rollout(apply):
    files = checked_files()
    for _, after, _ in files.values():
        test_candidate(after)
    report = {'status': 'checked', 'files': {str(path): shared.digest(after)
               for path, (_, after, _) in files.items()}}
    if not apply:
        return report
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = shared.ROOTS[0] / 'backups' / ('gallery-decimal-' + stamp)
    backup.mkdir(mode=0o700)
    installed = []
    try:
        for index, (path, (before, after, attributes)) in enumerate(files.items()):
            if path.is_symlink() or path.read_bytes() != before:
                raise RuntimeError('Gallery source changed during deploy at ' + str(path))
            (backup / f'launch_gallery-{index}.py').write_bytes(before)
            shared.replace(path, after, attributes)
            installed.append(path)
        shared.restart()
    except BaseException:
        for path in reversed(installed):
            before, after, attributes = files[path]
            if path.is_symlink() or path.read_bytes() != after:
                raise RuntimeError('Concurrent edit preserved at ' + str(path))
            shared.replace(path, before, attributes)
        if installed:
            shared.restart()
        raise
    report.update(status='deployed', health='ok', backup=str(backup))
    (backup / 'receipt.json').write_text(json.dumps(report, indent=2))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    operation = parser.add_mutually_exclusive_group(required=True)
    operation.add_argument('--check', action='store_true')
    operation.add_argument('--apply', action='store_true')
    options = parser.parse_args()
    fd = os.open(shared.LOCK, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as lock:
        info = os.fstat(lock.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != 0:
            raise RuntimeError('Unexpected shared backend deployment lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(rollout(options.apply)))
