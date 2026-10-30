"""Atualiza somente o módulo da fila fiscal, com hash, backup e rollback."""
import hashlib
import json
import os
import stat
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen

BASE_MODULE = '95007fd0111b0c205720c620e077b05164c30d9de59bfea565f243ec9b1a4d60'
CANDIDATE_MODULE = '73585af092a1cb49c9a551ed27fa3a699b1128151f4047d3fa3b941cf5899355'
TARGETS = (Path('/opt/energetica-whatsapp/sefaz_sync.py'), Path('/home/opc/energetica-build/sefaz_sync.py'))


def checked_module(source, expected):
    if hashlib.sha256(source).hexdigest() != expected:
        raise RuntimeError('Fiscal module hash drift')
    compile(source, 'sefaz_sync.py', 'exec')
    return source


def atomic(path, content, metadata):
    temporary = path.with_name(path.name + f'.update-{os.getpid()}-tmp')
    with temporary.open('xb') as stream:
        os.chown(temporary, metadata.st_uid, metadata.st_gid)
        os.chmod(temporary, metadata.st_mode & 0o777)
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def health():
    for _ in range(20):
        try:
            with urlopen('http://127.0.0.1:8765/health', timeout=2) as response:
                if json.load(response).get('status') == 'ok':
                    return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError('Bridge health failed')


def restart():
    subprocess.run(['systemctl', 'restart', 'energetica-channel-bridge'], check=True, timeout=45)


def main():
    import fcntl
    if sys.argv[1:] not in (['--check'], ['--deploy']):
        raise RuntimeError('Expected --check or --deploy')
    candidate = checked_module(Path(__file__).with_name('sefaz_sync.py').read_bytes(), CANDIDATE_MODULE)
    with open('/tmp/energetica-whatsapp-deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current = []
        for target in TARGETS:
            metadata = target.lstat()
            if target.is_symlink() or not stat.S_ISREG(metadata.st_mode):
                raise RuntimeError('Unexpected fiscal module target')
            source = checked_module(target.read_bytes(), BASE_MODULE)
            current.append((target, source, metadata))
        health()
        report = {'targets': len(TARGETS), 'fromSha256': BASE_MODULE, 'moduleSha256': CANDIDATE_MODULE}
        if sys.argv[1] == '--check':
            print(json.dumps({'status': 'checked', **report}))
            return
        backup = Path('/var/backups/energetica-whatsapp/sefaz-manual-sync-updates') / str(time.time_ns())
        backup.mkdir(parents=True, mode=0o700)
        changed = []
        try:
            for index, (target, source, metadata) in enumerate(current):
                backup_file = backup / f'module-{index}.py'
                backup_file.write_bytes(source)
                os.chown(backup_file, 0, 0)
                os.chmod(backup_file, 0o600)
                atomic(target, candidate, metadata)
                changed.append((target, source, metadata))
            restart()
            health()
            for target in TARGETS:
                checked_module(target.read_bytes(), CANDIDATE_MODULE)
            print(json.dumps({'status': 'deployed', 'backup': str(backup), **report}))
        except Exception:
            for target, source, metadata in reversed(changed):
                atomic(target, source, metadata)
            restart()
            health()
            raise


if __name__ == '__main__':
    main()
