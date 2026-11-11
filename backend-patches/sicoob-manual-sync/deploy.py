"""Guarded OCI install. Execute with sudo from a validated staging directory."""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

EXPECTED_BRIDGE = '6e81c177a7a85cd398e9dea7dd520aca2d842ef0f87d805c3b5badc7472f21d3'
COLLECTORS = {
    'sync_movements.py': 'fb8688b04a5ae07098d96ed78f1b711796944fbab4dfdb5d7d65ba036c91ab32',
    'sync_boleto_receipts.py': 'eabde796064593acfb0887a35bfae8914d57319e3b70741269b8ffee91e109f4',
    'sync_pix_receivers.py': '5b8b67556189f9687e1fb644275d6ab0da8f038d1efd13ac4c9d14e87680f2a2',
}
LIVE = Path('/opt/energetica-whatsapp')
BUILD = Path('/home/opc/energetica-build')
UNIT = 'energetica-sicoob-manual-sync.service'
TIMER = 'energetica-sicoob-movements.timer'
SOURCE = Path(__file__).resolve().parent


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


def atomic(path, content, uid=0, gid=0, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.sicoob-deploy.tmp')
    with temporary.open('wb') as stream:
        stream.write(content)
        os.fchmod(stream.fileno(), mode)
        os.fchown(stream.fileno(), uid, gid)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def patched_bridge(data):
    source = data.decode('utf-8')
    anchor = '                if action in {"sefaz_refresh", "sefaz_refresh_status"}:\n'
    hook = ('                if action in {"sicoob_refresh", "sicoob_refresh_status"}:\n'
            '                    from sicoob_sync import handle_portal as handle_sicoob_refresh\n'
            '                    return self._send_json(200, handle_sicoob_refresh(identity, body), cors_origin=origin)\n')
    if source.count(anchor) != 1 or 'handle_sicoob_refresh' in source:
        raise ValueError('Unexpected portal routing')
    result = source.replace(anchor, hook + anchor)
    compile(result, 'channel_bridge.py', 'exec')
    return result.encode('utf-8')


def healthy(worker_url='http://127.0.0.1:8080/health', bridge_url='http://127.0.0.1:8765/health'):
    try:
        with urllib.request.urlopen(worker_url, timeout=2) as response:
            if response.status != 200 or response.read() != b'ok':
                return False
        with urllib.request.urlopen(bridge_url, timeout=2) as response:
            return response.status == 200 and json.loads(response.read()).get('status') == 'ok'
    except Exception:
        return False


def health():
    for _ in range(30):
        if healthy():
            return
        time.sleep(1)
    raise RuntimeError('Bridge health did not recover')


@contextlib.contextmanager
def paused_schedule():
    was_active = subprocess.run(['systemctl', 'is-active', '--quiet', TIMER]).returncode == 0
    try:
        if was_active:
            run('systemctl', 'stop', TIMER)
        # A timer may have fired after the earlier preflight check. Do not install
        # the shared lock while an old, unlocked pipeline is still running.
        scheduled = run('systemctl', 'show', 'energetica-sicoob-movements.service', '-p', 'ActiveState', '--value')
        if scheduled not in ('inactive', 'failed'):
            raise RuntimeError('Scheduled collector active; retry after it finishes')
        yield
    finally:
        # Also restore scheduling if install health AND rollback health fail.
        if was_active:
            run('systemctl', 'start', TIMER)


def deploy():
    if os.geteuid() != 0:
        raise SystemExit('sudo required')
    with Path('/tmp/energetica-whatsapp-deploy.lock').open('a+b') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        bridges = [LIVE / 'channel_bridge.py', BUILD / 'channel_bridge.py']
        originals = {path: path.read_bytes() for path in bridges}
        if any(hashlib.sha256(data).hexdigest() != EXPECTED_BRIDGE for data in originals.values()):
            raise RuntimeError('Bridge changed since validation; inspect before deploying')
        for name, expected in COLLECTORS.items():
            if hashlib.sha256((LIVE / 'sicoob-movements' / name).read_bytes()).hexdigest() != expected:
                raise RuntimeError('Collector changed since validation')
        run('/usr/bin/python3', '-m', 'unittest', 'discover', '-s', str(SOURCE))
        for name in ('sicoob_sync.py', 'sicoob_worker.py'):
            compile((SOURCE / name).read_text(), name, 'exec')
        scheduled = run('systemctl', 'show', 'energetica-sicoob-movements.service', '-p', 'ActiveState', '--value')
        if scheduled not in ('inactive', 'failed'):
            raise RuntimeError('Scheduled collector active; retry after it finishes')
        service_path = Path('/etc/systemd/system') / UNIT
        dropin = Path('/etc/systemd/system/energetica-sicoob-movements.service.d/manual-pipeline.conf')
        targets = {LIVE / 'sicoob_sync.py': (SOURCE / 'sicoob_sync.py').read_bytes(),
                   BUILD / 'sicoob_sync.py': (SOURCE / 'sicoob_sync.py').read_bytes(),
                   LIVE / 'sicoob-manual-sync/sicoob_worker.py': (SOURCE / 'sicoob_worker.py').read_bytes(),
                   BUILD / 'sicoob-manual-sync/sicoob_worker.py': (SOURCE / 'sicoob_worker.py').read_bytes(),
                   service_path: (SOURCE / UNIT).read_bytes(),
                   dropin: (SOURCE / 'scheduled-pipeline.conf').read_bytes()}
        if any(path.exists() for path in targets):
            raise RuntimeError('New install targets already exist; inspect before replacing')
        account = run('id', '-u', 'energetica-whatsapp')
        group = run('id', '-g', 'energetica-whatsapp')
        queue_root = Path('/var/lib/energetica-whatsapp/sicoob-sync')
        if queue_root.exists():
            raise RuntimeError('Queue already exists; preserve and inspect before upgrading')
        backup = Path('/var/backups/energetica-sicoob-manual-sync') / time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
        backup.mkdir(mode=0o700, parents=True)
        for index, path in enumerate(bridges):
            shutil.copy2(path, backup / f'channel_bridge.{index}.py')
        metadata = {path: path.stat() for path in bridges}
        installed = []
        with paused_schedule():
            try:
                queue_root.mkdir(mode=0o700)
                os.chown(queue_root, int(account), int(group))
                atomic(queue_root / 'access.json', (queue_root.parent / 'dda-sync/access.json').read_bytes(), int(account), int(group), 0o600)
                for path, data in targets.items():
                    atomic(path, data)
                    installed.append(path)
                for path, data in originals.items():
                    meta = metadata[path]
                    atomic(path, patched_bridge(data), meta.st_uid, meta.st_gid, meta.st_mode & 0o777)
                run('systemctl', 'daemon-reload')
                run('systemctl', 'enable', '--now', UNIT)
                time.sleep(2)
                run('systemctl', 'is-active', UNIT)
                state = json.loads((queue_root / 'state.json').read_text())
                if time.time() - state['heartbeat'] > 10:
                    raise RuntimeError('Queue worker heartbeat missing')
                run('systemctl', 'restart', 'energetica-channel-bridge.service')
                health()
            except BaseException:
                subprocess.run(['systemctl', 'disable', '--now', UNIT], capture_output=True)
                for path, data in originals.items():
                    meta = metadata[path]
                    atomic(path, data, meta.st_uid, meta.st_gid, meta.st_mode & 0o777)
                for path in installed:
                    path.unlink(missing_ok=True)
                run('systemctl', 'daemon-reload')
                run('systemctl', 'restart', 'energetica-channel-bridge.service')
                health()
                # Preserve any newly created receipts and access file for audit.
                raise
        # Report success only after restoring the timer.
        print(json.dumps({'status': 'deployed', 'backup': str(backup), 'bridgeSha256': hashlib.sha256(bridges[0].read_bytes()).hexdigest(),
                          'queueSha256': hashlib.sha256(targets[LIVE / 'sicoob_sync.py']).hexdigest(),
                          'workerSha256': hashlib.sha256(targets[LIVE / 'sicoob-manual-sync/sicoob_worker.py']).hexdigest()}))


if __name__ == '__main__':
    deploy()
