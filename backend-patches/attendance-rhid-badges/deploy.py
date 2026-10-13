"""Deploy the bounded RHID badge patch with CAS, backups and health rollback."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from urllib.request import urlopen
from patch_bridge import patch_bridge

LIVE = Path('/opt/energetica-whatsapp')
BUILD = Path('/home/opc/energetica-build')
CONFIG = Path('/etc/energetica-rhid-directory.json')

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def atomic_install(content, target, *, mode, uid, gid):
    descriptor, filename = tempfile.mkstemp(prefix='.rhid-badges-', dir=str(target.parent))
    staged = Path(filename)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(staged, mode)
        os.chown(staged, uid, gid)
        os.replace(staged, target)
    finally:
        if staged.exists(): staged.unlink()

def health():
    for attempt in range(20):
        try:
            with urlopen('http://127.0.0.1:8080/health', timeout=3) as response:
                if response.status == 200: return True
        except Exception: pass
        time.sleep(1)
    return False

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--expected-bridge', required=True)
    parser.add_argument('--private-config', required=True, type=Path)
    parser.add_argument('--stage', required=True, type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    patch_root = Path(__file__).resolve().parent
    module_bytes = (patch_root / 'rhid_badge_source.py').read_bytes()
    compile(module_bytes, 'rhid_badge_source.py', 'exec')
    configs = [LIVE / 'worker/workflow_config.json', BUILD / 'worker/workflow_config.json', BUILD / 'workflow_config.json']
    config_hashes = {str(path): digest(path) for path in configs}
    targets = {}
    for root in (LIVE, BUILD):
        bridge = root / 'channel_bridge.py'
        if digest(bridge) != args.expected_bridge: raise RuntimeError('Bridge changed; refusing deployment.')
        targets[bridge] = patch_bridge(bridge.read_text(encoding='utf-8')).encode('utf-8')
        targets[root / 'rhid_badge_source.py'] = module_bytes
    # Existing connection only. Never replace a different secret configuration.
    private_bytes = args.private_config.read_bytes()
    if CONFIG.exists() and CONFIG.read_bytes() != private_bytes:
        raise RuntimeError('RHID configuration already exists and differs; preserving it.')
    print(json.dumps({'dryRun': not args.apply, 'bridgeCasVerified': True, 'codeTargets': len(targets),
                      'credentialValuesLogged': False, 'workflowConfigPreserved': True}))
    if not args.apply: return
    backups = args.stage.resolve() / 'backups'
    backups.mkdir(mode=0o700)
    before = {}
    for target in targets:
        if target.exists():
            stat = target.stat()
            saved = backups / (('live-' if target.is_relative_to(LIVE) else 'build-') + target.name)
            shutil.copy2(target, saved)
            before[target] = (saved, stat)
        else: before[target] = None
    created_config = not CONFIG.exists()
    try:
        if any(digest(root / 'channel_bridge.py') != args.expected_bridge for root in (LIVE, BUILD)):
            raise RuntimeError('Bridge changed after validation; refusing installation.')
        live_stat = (LIVE / 'channel_bridge.py').stat()
        if created_config:
            atomic_install(private_bytes, CONFIG, mode=0o640, uid=live_stat.st_uid, gid=live_stat.st_gid)
        for target, content in targets.items():
            stat = target.stat() if target.exists() else target.parent.stat()
            atomic_install(content, target, mode=(stat.st_mode & 0o777) if target.exists() else (0o640 if target.is_relative_to(LIVE) else 0o644),
                           uid=stat.st_uid, gid=stat.st_gid)
        if any(digest(Path(path)) != expected for path, expected in config_hashes.items()):
            raise RuntimeError('Workflow configuration changed; aborting.')
        subprocess.run(['systemctl', 'restart', 'energetica-whatsapp'], check=True)
        if not health(): raise RuntimeError('Service health failed.')
        result = {'serviceHealth': True, 'workflowConfigPreserved': True,
                  'codeHashes': {str(path): digest(path) for path in targets},
                  'credentialMode': oct(CONFIG.stat().st_mode & 0o777)}
        (args.stage / 'deployment.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result))
    except Exception:
        for target, backup in before.items():
            if backup:
                saved, stat = backup
                atomic_install(saved.read_bytes(), target, mode=stat.st_mode & 0o777, uid=stat.st_uid, gid=stat.st_gid)
            elif target.exists():
                target.replace(backups / ('unused-' + ('live-' if target.is_relative_to(LIVE) else 'build-') + target.name))
        if created_config and CONFIG.exists(): CONFIG.replace(backups / 'unused-credentials.private.json')
        subprocess.run(['systemctl', 'restart', 'energetica-whatsapp'], check=False)
        raise

if __name__ == '__main__': main()
