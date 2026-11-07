"""Guarded deployment of file_sync.py only; run as root on the existing VM."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil

BASELINE_SHA256 = '6ccb14b120955b6a71a3164c6d5fcdbe09c1d499337a9669d4e934d534b8c7ab'
TARGET = Path('/opt/energetica-whatsapp/trancid-monitor/file_sync.py')
DATA = Path('/var/lib/energetica-whatsapp/trancid-monitor')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


if __name__ == '__main__':
    source = Path(__file__).parent / 'file_sync.py'
    backup = TARGET.with_name('file_sync.py.before-report-snapshot-20261107')
    staged = TARGET.with_name('.file_sync.py.report-snapshot-new')
    with (DATA / 'collector.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if digest(TARGET) != BASELINE_SHA256:
            raise RuntimeError('Source changed since baseline; deployment refused')
        if backup.exists() or staged.exists():
            raise RuntimeError('Backup or staged file already exists; deployment refused')
        metadata = TARGET.stat()
        shutil.copy2(TARGET, backup)
        os.chown(backup, metadata.st_uid, metadata.st_gid)
        if digest(backup) != BASELINE_SHA256:
            raise RuntimeError('Backup hash mismatch; deployment refused')
        try:
            shutil.copyfile(source, staged)
            os.chmod(staged, metadata.st_mode & 0o7777)
            os.chown(staged, metadata.st_uid, metadata.st_gid)
            if digest(staged) != digest(source):
                raise RuntimeError('Staged file hash mismatch; deployment refused')
            if digest(TARGET) != BASELINE_SHA256:
                raise RuntimeError('Source changed before replace; deployment refused')
            staged.replace(TARGET)
        finally:
            staged.unlink(missing_ok=True)
        actual = TARGET.stat()
        assert (actual.st_uid, actual.st_gid, actual.st_mode) == (metadata.st_uid, metadata.st_gid, metadata.st_mode)
        assert digest(TARGET) == digest(source)
        print(json.dumps({'baseline_sha256': BASELINE_SHA256, 'deployed_sha256': digest(TARGET),
                          'backup': str(backup), 'uid': actual.st_uid, 'gid': actual.st_gid,
                          'mode': oct(actual.st_mode & 0o7777), 'collector_lock_held': True}))
