"""Install the scheduled-payment integration on the existing OCI DDA worker."""
import fcntl
import grp
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone


ROOT = Path('/opt/energetica-whatsapp')
COLLECTOR = ROOT / 'dda-collector'
PRIVATE = Path('/var/lib/energetica-whatsapp/dda-collector')
SERVICE = 'energetica-dda-scheduled-payment'
ACCOUNT = 'energetica-whatsapp'
EXPECTED = {
    COLLECTOR / 'DdaMonitor.psm1': '86617423b13443fbb2cc09f52d34a8ce625b780830a6d94b609fa8fed5837b4e',
    COLLECTOR / 'DdaSharePoint.psm1': '0670ccf9ea6d5024b24fe1ebe1347ef942f32102b6d5ada6721fba28f4f18511',
    ROOT / 'dda_manual_payment.py': '04b390f41e521ac70629621a84d5629ad27c2dce860080db2ec51ab6a45f2941',
}
HTTP_SOURCE = ". (Join-Path $PSScriptRoot 'DdaBankHttp.ps1')"
STATUS_SOURCE = ". (Join-Path $PSScriptRoot 'DdaBankStatus.ps1')"


def run(*args, env=None):
    subprocess.run(args, env=env, check=True, timeout=120)


def replace_once(source, before, after):
    if source.count(before) != 1:
        raise RuntimeError('COLLECTOR_SOURCE_ANCHOR_CHANGED')
    return source.replace(before, after)


def install_atomic(path, data, mode, uid, gid):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as file:
        temp = Path(file.name)
        try:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
            os.fchown(file.fileno(), uid, gid)
            os.fchmod(file.fileno(), mode)
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)


def main(stage):
    gid = grp.getgrnam(ACCOUNT).gr_gid
    for path, expected in EXPECTED.items():
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise RuntimeError(f'LIVE_SOURCE_CHANGED: {path.name}')

    monitor_path, sharepoint_path, manual_path = EXPECTED
    monitor = replace_once(monitor_path.read_text(), HTTP_SOURCE, f'{HTTP_SOURCE}\n{STATUS_SOURCE}')
    monitor = replace_once(monitor,
        "if([string]$row.codigoTipoSituacaoBoleto -ne [string]$Situacao -or $payer -ne $Credentials.cnpj){continue}",
        "if($payer -ne $Credentials.cnpj -or (Get-DdaBankStatusCode $row) -ne $Situacao){continue}")
    sharepoint = replace_once(sharepoint_path.read_text(), HTTP_SOURCE, f'{HTTP_SOURCE}\n{STATUS_SOURCE}')
    sharepoint = replace_once(sharepoint,
        '$parsed=0;if([int]::TryParse([string]$_.codigoTipoSituacaoBoleto,[ref]$parsed)){$parsed}else{-1}',
        'Get-DdaBankStatusCode $_')

    notice_dir = ROOT / 'dda-scheduled-payment'
    notice_dir.mkdir(mode=0o750, exist_ok=True)
    os.chown(notice_dir, 0, gid)
    files = {
        monitor_path: (monitor.encode(), 0o640, gid),
        sharepoint_path: (sharepoint.encode(), 0o640, gid),
        COLLECTOR / 'DdaBankStatus.ps1': ((stage / 'DdaBankStatus.ps1').read_bytes(), 0o640, gid),
        manual_path: ((stage / 'dda_manual_payment.py').read_bytes(), 0o640, gid),
        notice_dir / 'notify.py': ((stage / 'notify.py').read_bytes(), 0o640, gid),
    }
    for kind in ('service', 'timer'):
        name = f'{SERVICE}.{kind}'
        files[Path('/etc/systemd/system') / name] = ((stage / name).read_bytes(), 0o644, 0)
    for path in files.keys() - EXPECTED.keys():
        if path.exists():
            raise RuntimeError(f'LIVE_TARGET_ALREADY_EXISTS: {path.name}')
    for path in (manual_path, notice_dir / 'notify.py'):
        compile(files[path][0], str(path), 'exec')

    backup = Path('/var/backups/energetica-dda-scheduled-payment') / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup.mkdir(mode=0o700, parents=True)
    changed = []
    bridge = 'energetica-channel-bridge.service'
    bridge_restarted = False
    with (PRIVATE / 'sync.lock').open('r+b') as lock:
        # Match the PowerShell collector's one-byte POSIX record lock.
        fcntl.lockf(lock, fcntl.LOCK_EX, 1)
        try:
            for path, expected in EXPECTED.items():
                if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                    raise RuntimeError(f'LIVE_SOURCE_CHANGED_AFTER_LOCK: {path.name}')
                shutil.copy2(path, backup / path.name)
            for path, (data, mode, group) in files.items():
                install_atomic(path, data, mode, 0, group)
                changed.append(path)
                if path.read_bytes() != data:
                    raise RuntimeError(f'INSTALL_READBACK_MISMATCH: {path.name}')
            env = {**os.environ, 'DDA_PRIVATE_ROOT': str(PRIVATE)}
            run('/usr/bin/pwsh', '-NoLogo', '-NoProfile', '-NonInteractive',
                '-File', str(stage / 'Test-CollectorScheduleAliases.ps1'), '-CollectorPath', str(COLLECTOR), env=env)
            run('systemd-analyze', 'verify', f'/etc/systemd/system/{SERVICE}.service',
                f'/etc/systemd/system/{SERVICE}.timer')
            run('systemctl', 'daemon-reload')
            bridge_restarted = True
            run('systemctl', 'restart', bridge)
            run('systemctl', 'is-active', '--quiet', bridge)
            run('sudo', '-n', '-u', ACCOUNT, f'{ROOT}/.venv/bin/python', '-B', str(notice_dir / 'notify.py'), '--check')
        except BaseException:
            for path in reversed(changed):
                prior = backup / path.name
                if prior.exists():
                    install_atomic(path, prior.read_bytes(), files[path][1], 0, files[path][2])
                else:
                    path.unlink()
            run('systemctl', 'daemon-reload')
            if bridge_restarted:
                run('systemctl', 'restart', bridge)
            raise
    print(f'installed=true backup={backup.name}')


if __name__ == '__main__':
    if os.geteuid() != 0:
        raise RuntimeError('ROOT_REQUIRED')
    main(Path(sys.argv[1]).resolve(strict=True))
