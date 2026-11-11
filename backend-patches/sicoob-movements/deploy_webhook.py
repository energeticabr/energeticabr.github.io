"""Initial webhook install only: validated hashes, shared locks and rollback."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request

SOURCE = Path(__file__).resolve().parent
LIVE = Path('/opt/energetica-whatsapp/sicoob-movements')
PYTHON = '/opt/energetica-whatsapp/.venv/bin/python'
CADDY = Path('/etc/caddy/Caddyfile')
UNIT = 'energetica-sicoob-pix-webhook.service'
EXPECTED_COLLECTOR = '68ac6aec7e5e00e05f5d331acd555d8205fe1ef14e311af3699de096e7deccfe'
EXPECTED_CADDY = 'c1d1e7270501e6849bfbcbc9aaa6df76c7dce8b68a9f91db2357571dad3b9468'


def run(*args):
    return subprocess.run(args, capture_output=True, text=True, check=True, timeout=60).stdout.strip()


def patched_caddy(content):
    anchor = '\thandle /api/portal-chat {\n'
    if content.count(anchor) != 1 or '/api/sicoob-pix/' in content:
        raise ValueError('Unexpected Caddy routing')
    route = ('\thandle /api/sicoob-pix/* {\n'
             '\t\trequest_body {\n\t\t\tmax_size 32KB\n\t\t}\n'
             '\t\treverse_proxy 127.0.0.1:8775\n\t}\n\n')
    return content.replace(anchor, route + anchor)


@contextmanager
def locked(path):
    import fcntl
    with Path(path).open('a+b') as stream:
        deadline = time.monotonic() + 120
        while True:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() > deadline:
                    raise TimeoutError('Deployment lock busy')
                time.sleep(1)
        yield


def atomic(path, data, metadata=None):
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
            os.fchmod(output.fileno(), metadata.st_mode & 0o777 if metadata else 0o644)
            os.fchown(output.fileno(), metadata.st_uid if metadata else 0, metadata.st_gid if metadata else 0)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def health(url, json_body=True):
    with urllib.request.urlopen(url, timeout=5) as response:
        body = response.read()
        if response.status != 200 or (json.loads(body).get('status') != 'ok' if json_body else body != b'ok'):
            raise RuntimeError('Service health failed')


def deploy():
    if os.geteuid() != 0:
        raise RuntimeError('sudo required')
    with locked('/tmp/energetica-whatsapp-deploy.lock'), locked('/var/lib/energetica-sicoob-movements/pipeline.lock'):
        collector = LIVE / 'sync_pix_receivers.py'
        for path, expected in ((collector, EXPECTED_COLLECTOR), (CADDY, EXPECTED_CADDY)):
            if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise RuntimeError('Live file changed; inspect before deployment')
        new_files = {LIVE / name: (SOURCE / name).read_bytes() for name in
                     ('pix_events.py', 'Configure-SicoobPixWebhook.ps1')}
        new_files[Path('/etc/systemd/system') / UNIT] = (SOURCE / UNIT).read_bytes()
        if any(path.exists() for path in new_files):
            raise RuntimeError('Webhook installation already exists')
        replacements = {collector: (SOURCE / collector.name).read_bytes(),
                        CADDY: patched_caddy(CADDY.read_text()).encode('utf-8')}
        for name in ('pix_events.py', 'sync_pix_receivers.py'):
            compile((SOURCE / name).read_bytes(), name, 'exec')
        candidate = SOURCE / 'Caddyfile.webhook-candidate'
        candidate.write_bytes(replacements[CADDY])
        run('/usr/local/bin/caddy', 'validate', '--config', str(candidate), '--adapter', 'caddyfile')
        originals = {path: (path.read_bytes(), path.stat()) for path in replacements}
        backup = Path('/var/backups/energetica-sicoob-webhook') / time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
        backup.mkdir(mode=0o700, parents=True)
        for path in replacements:
            shutil.copy2(path, backup / path.name)
        installed = []
        try:
            for path, content in new_files.items():
                atomic(path, content)
                installed.append(path)
                run('restorecon', str(path))
            run('sudo', '-n', '-u', 'energetica-whatsapp', PYTHON, str(LIVE / 'pix_events.py'), 'init')
            for path, content in replacements.items():
                atomic(path, content, originals[path][1])
                run('restorecon', str(path))
            run('systemctl', 'daemon-reload')
            run('systemctl', 'enable', '--now', UNIT)
            for attempt in range(15):
                try:
                    health('http://127.0.0.1:8775/api/sicoob-pix/health')
                    break
                except Exception:
                    if attempt == 14:
                        raise
                    time.sleep(1)
            run('systemctl', 'reload', 'caddy')
            health('https://163-176-171-217.sslip.io/api/sicoob-pix/health')
            health('http://127.0.0.1:8765/health')
            health('http://127.0.0.1:8080/health', json_body=False)
        except BaseException:
            subprocess.run(['systemctl', 'disable', '--now', UNIT], capture_output=True, timeout=30)
            for path, (data, metadata) in originals.items():
                atomic(path, data, metadata)
                run('restorecon', str(path))
            for path in reversed(installed):
                path.unlink()
            run('systemctl', 'daemon-reload')
            run('systemctl', 'reload', 'caddy')
            raise
        print(json.dumps({'installed': True, 'backup': str(backup),
                          'collector_sha256': hashlib.sha256(collector.read_bytes()).hexdigest(),
                          'webhook_sha256': hashlib.sha256((LIVE / 'pix_events.py').read_bytes()).hexdigest()}))


if __name__ == '__main__':
    deploy()
