"""Install the authorized balance route on OCI with backup and rollback."""
import fcntl
import os
from pathlib import Path
import shutil
import subprocess
import time

from deploy import BUILD, LIVE, SOURCE, atomic, health, run

BRIDGE_UNIT = 'energetica-channel-bridge.service'
ANCHOR = '                if action in {"sicoob_refresh", "sicoob_refresh_status"}:\n'
ROUTE = ('                if action == "sicoob_balance":\n'
         '                    from sicoob_balance import handle_portal as read_sicoob_balance\n'
         '                    return self._send_json(200, read_sicoob_balance(identity, body), cors_origin=origin)\n')


def patched_bridge(content):
    source = content.decode('utf-8')
    if source.count(ANCHOR) != 1 or '"sicoob_balance"' in source:
        raise ValueError('Unexpected Sicoob portal routing')
    source = source.replace(ANCHOR, ROUTE + ANCHOR)
    compile(source, 'channel_bridge.py', 'exec')
    return source.encode('utf-8')


def replace(path, data, metadata):
    atomic(path, data, metadata.st_uid, metadata.st_gid, metadata.st_mode & 0o777)


def deploy():
    if os.geteuid() != 0:
        raise SystemExit('sudo required')
    run('/usr/bin/python3', '-B', '-m', 'unittest', 'discover', '-s', str(SOURCE), '-p', 'test_sicoob_balance.py')
    bridges = [LIVE / 'channel_bridge.py', BUILD / 'channel_bridge.py']
    additions = {LIVE / 'sicoob-movements/Read-SicoobBalance.ps1': 'Read-SicoobBalance.ps1',
                 LIVE / 'sicoob_balance.py': 'sicoob_balance.py', BUILD / 'sicoob_balance.py': 'sicoob_balance.py'}
    with Path('/tmp/energetica-whatsapp-deploy.lock').open('a+b') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if any(path.exists() for path in additions):
            raise RuntimeError('Balance files already installed; inspect before updating')
        originals = {path: path.read_bytes() for path in bridges}
        metadata = {path: path.stat() for path in bridges}
        updates = {path: patched_bridge(data) for path, data in originals.items()}
        backup = Path('/var/backups/energetica-sicoob-balance') / time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
        backup.mkdir(mode=0o700, parents=True)
        for index, path in enumerate(bridges):
            shutil.copy2(path, backup / f'channel_bridge.{index}.py')
        installed = []
        updated_bridges = []
        try:
            for path, name in additions.items():
                atomic(path, (SOURCE / name).read_bytes())
                installed.append(path)
            # Check the bank read under the bridge account without echoing the amount.
            subprocess.run(['runuser', '-u', 'energetica-whatsapp', '--', '/usr/bin/python3', '-B', '-c',
                            'from sicoob_balance import SicoobBalance; raise SystemExit(SicoobBalance.fetch() is None)'],
                           cwd=LIVE, check=True, capture_output=True, timeout=25)
            for path, data in updates.items():
                replace(path, data, metadata[path])
                updated_bridges.append(path)
            run('systemctl', 'restart', BRIDGE_UNIT)
            health()
        except BaseException:
            for path in updated_bridges:
                replace(path, originals[path], metadata[path])
            for path in installed:
                path.unlink(missing_ok=True)
            if updated_bridges:
                run('systemctl', 'restart', BRIDGE_UNIT)
                health()
            raise
        print(f'Balance route deployed. Backup: {backup}')


if __name__ == '__main__':
    deploy()
