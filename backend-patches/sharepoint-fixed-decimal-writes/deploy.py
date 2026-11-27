"""Publish the SharePoint fixed decimal JSON body serializer."""
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

DIRECTORY = Path(__file__).resolve().parent
shared_source = DIRECTORY / 'shared_rollout.py'
if not shared_source.is_file():
    shared_source = DIRECTORY.parent / 'sharepoint-decimal-readback/deploy.py'
spec = importlib.util.spec_from_file_location('decimal_readback_rollout', shared_source)
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)

BASELINE = 'e2f6323dee791405bba7b4d88364229da3de104b82ff785058cfb854f280b827'
SOURCE = Path('worker/clients.py')

SERIALIZER = r'''_SHAREPOINT_JSON_TOKEN = re.compile(r'"[^"\\]*(?:\\.[^"\\]*)*"|(-?\d+(?:\.\d+)?[eE][+-]?\d+)')


def _sharepoint_json_body(value):
    """Expand only numeric exponents in valid JSON, preserving string contents."""
    try:
        raw = json.dumps(value, allow_nan=False)
    except ValueError as exc:
        raise requests.exceptions.InvalidJSONError(exc) from exc
    return _SHAREPOINT_JSON_TOKEN.sub(
        lambda match: format(Decimal(match[1]), "f") if match[1] else match[0],
        raw,
    ).encode("utf-8")


'''
REQUEST_BODY = '''        json_body = kwargs.pop("json", None)
        if json_body is not None and not kwargs.get("data") and not kwargs.get("files"):
            kwargs["data"] = _sharepoint_json_body(json_body)
            if not any(name.lower() == "content-type" for name in headers):
                headers["Content-Type"] = "application/json"
'''


def candidate(source):
    text = source.decode('utf-8')
    helper_anchor = 'def _localized_decimal(value) -> Decimal | None:\n'
    request_anchor = '        if endpoint.startswith(("https://", "http://")):\n'
    if text.count(helper_anchor) != 1 or text.count(request_anchor) != 1:
        raise RuntimeError('SharePoint serializer anchors changed')
    text = text.replace(helper_anchor, SERIALIZER + helper_anchor)
    text = text.replace(request_anchor, REQUEST_BODY + request_anchor)
    after = text.encode('utf-8')
    compile(after, str(SOURCE), 'exec')
    return after


def deploy(apply):
    files = {}
    for root in shared.ROOTS:
        path = root / SOURCE
        before = path.read_bytes()
        if path.is_symlink() or shared.digest(before) != BASELINE:
            raise RuntimeError('Unexpected SharePoint client baseline at ' + str(path))
        files[path] = (before, path.stat())
    after = candidate(next(iter(files.values()))[0])
    with tempfile.TemporaryDirectory(prefix='sharepoint-json-candidate-') as temporary:
        proposed = Path(temporary) / SOURCE.name
        proposed.write_bytes(after)
        env = {**os.environ, 'CLIENT_SOURCE': str(proposed)}
        for test in ('test_fixed_decimal_writes.py', 'test_decimal_readback.py', 'test_dates.py'):
            subprocess.run([sys.executable, '-B', str(DIRECTORY / test), '-v'], env=env, check=True)
    report = {'status': 'checked', 'after': shared.digest(after), 'paths': list(map(str, files))}
    if not apply:
        return report

    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = shared.ROOTS[0] / 'backups' / ('sharepoint-fixed-decimals-' + stamp)
    backup.mkdir(mode=0o700)
    installed = []
    try:
        for index, (path, (before, attributes)) in enumerate(files.items()):
            if path.is_symlink() or path.read_bytes() != before:
                raise RuntimeError('SharePoint client changed during deploy at ' + str(path))
            (backup / f'clients-{index}.py').write_bytes(before)
            shared.replace(path, after, attributes)
            installed.append(path)
        shared.restart()
    except BaseException:
        for path in reversed(installed):
            before, attributes = files[path]
            if path.is_symlink() or path.read_bytes() != after:
                raise RuntimeError('Concurrent edit preserved at ' + str(path))
            shared.replace(path, before, attributes)
        if installed:
            shared.restart()
        raise

    report.update(status='deployed', backup=str(backup), health='ok')
    (backup / 'receipt.json').write_text(json.dumps(report, indent=2))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--apply', action='store_true')
    options = parser.parse_args()
    fd = os.open(shared.LOCK, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as lock:
        info = os.fstat(lock.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != 0:
            raise RuntimeError('Unexpected shared backend deployment lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(deploy(options.apply)))
