"""Install only the reviewed provision attachment units after code deployment."""
import hashlib
import json
import os
from pathlib import Path
import pwd
import subprocess
import sys

STAGE = Path('/home/opc/provision-attachments-20261017')
UNITS = ('energetica-provision-attachments.service', 'energetica-provision-attachments.timer')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(*args):
    subprocess.run(args, check=True, timeout=950)


def main():
    if len(sys.argv) != 4:
        raise SystemExit('Usage: install_timer.py manifest_sha service_sha timer_sha')
    manifest_path = STAGE / 'deploy-manifest.json'
    if digest(manifest_path) != sys.argv[1]:
        raise RuntimeError('Manifest drift')
    manifest = json.loads(manifest_path.read_text())
    for name, entry in manifest['files'].items():
        for root in ('/opt/energetica-whatsapp', '/home/opc/energetica-build'):
            if digest(Path(root) / name) != entry['after']:
                raise RuntimeError('Deploy code before installing timer')
    for name, expected in zip(UNITS, sys.argv[2:]):
        source, target = STAGE / name, Path('/etc/systemd/system') / name
        if source.is_symlink() or digest(source) != expected:
            raise RuntimeError('Unit payload drift')
        if target.is_symlink() or (target.exists() and digest(target) != expected):
            raise RuntimeError('Existing unit differs; preserved')
    run('systemd-analyze', 'verify', *(str(STAGE / name) for name in UNITS))
    user = pwd.getpwnam('energetica-whatsapp')
    state = Path('/var/lib/energetica-whatsapp/provision-attachment-sync')
    if state.is_symlink() or state.parent.resolve() != state.parent:
        raise RuntimeError('Unexpected state alias')
    state.mkdir(mode=0o700, exist_ok=True)
    os.chown(state, user.pw_uid, user.pw_gid)
    os.chmod(state, 0o700)
    for name in UNITS:
        run('install', '-o', 'root', '-g', 'root', '-m', '0644', str(STAGE / name), '/etc/systemd/system/' + name)
    run('systemctl', 'daemon-reload')
    # Run and verify before enabling the schedule. Original files are preserved
    # on failure; rerunning repairs partial copies without duplicating content.
    run('systemctl', 'start', UNITS[0])
    run('systemctl', 'enable', '--now', UNITS[1])
    run('systemctl', 'is-active', UNITS[1])
    run('systemctl', 'show', UNITS[0], '--property=Result,ExecMainStatus')


if __name__ == '__main__':
    main()
