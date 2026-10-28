"""Hash-checked bridge hook installer; run with sudo on the existing VM."""
import fcntl
import hashlib
import json
import os
import pwd
import shutil
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen

BASE = "275f8c6ffe52812405ca1e478825ebe4713b46223e25f9b81d0dae3bd9f7e574"
ROOTS = [Path("/opt/energetica-whatsapp"), Path("/home/opc/energetica-build")]
ANCHOR = '                if action == "operation_progress":\n'
HOOK = '''                if action in {"dda_refresh", "dda_refresh_status"}:
                    from dda_sync import handle_portal
                    return self._send_json(200, handle_portal(identity, body), cors_origin=origin)
'''

def candidate(source):
    if source.count(ANCHOR) != 1:
        raise RuntimeError("Bridge anchor mismatch")
    result = source.replace(ANCHOR, HOOK + ANCHOR)
    compile(result, "channel_bridge.py", "exec")
    return result.encode()

def atomic(path, content, uid, gid, mode):
    temp = path.with_name(path.name + ".dda-tmp")
    temp.write_bytes(content)
    os.chown(temp, uid, gid)
    os.chmod(temp, mode)
    os.replace(temp, path)

def health():
    for _ in range(25):
        try:
            with urlopen("http://127.0.0.1:8765/health", timeout=3) as response:
                if json.load(response).get("status") == "ok":
                    return
        except Exception:
            time.sleep(1)
    raise RuntimeError("Bridge health failed")

def main():
    stage = Path(__file__).resolve().parent
    module = (stage / "dda_sync.py").read_bytes()
    compile(module, "dda_sync.py", "exec")
    access = json.loads((stage / "access.json").read_text())
    if not access.get("emails") or len(access["emails"]) != 1:
        raise RuntimeError("Explicit DDA owner required")
    with open("/tmp/energetica-whatsapp-deploy.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        sources = {}
        for root in ROOTS:
            source = (root / "channel_bridge.py").read_bytes()
            if hashlib.sha256(source).hexdigest() != BASE:
                raise RuntimeError("Source drift")
            if (root / "dda_sync.py").exists():
                raise RuntimeError("Module already installed; inspect before replacing")
            sources[root] = (source, candidate(source.decode()))
        health()
        if sys.argv[1:] == ["--check"]:
            print(json.dumps({"status": "checked", "roots": 2}))
            return
        if sys.argv[1:] != ["--deploy"]:
            raise RuntimeError("Expected --check or --deploy")
        backup = Path("/var/backups/energetica-whatsapp/dda-bank-refresh") / str(int(time.time()))
        backup.mkdir(parents=True, mode=0o700)
        owner = pwd.getpwnam("energetica-whatsapp")
        queue = Path("/var/lib/energetica-whatsapp/dda-sync")
        if queue.exists():
            stat = queue.stat()
            if queue.is_symlink() or stat.st_uid != owner.pw_uid or stat.st_mode & 0o777 != 0o700:
                raise RuntimeError("Unexpected queue ownership or permissions")
            if json.loads((queue / "access.json").read_text()) != access:
                raise RuntimeError("Queue access mismatch")
        else:
            queue.mkdir(mode=0o700)
            os.chown(queue, owner.pw_uid, owner.pw_gid)
            atomic(queue / "access.json", json.dumps(access).encode(), owner.pw_uid, owner.pw_gid, 0o600)
        changed = []
        try:
            for index, (root, (source, updated)) in enumerate(sources.items()):
                target = root / "channel_bridge.py"
                stat = target.stat()
                shutil.copy2(target, backup / ("bridge-" + str(index) + ".py"))
                changed.append((root, source, stat))
                atomic(root / "dda_sync.py", module, stat.st_uid, stat.st_gid, 0o640)
                atomic(target, updated, stat.st_uid, stat.st_gid, stat.st_mode & 0o777)
            subprocess.run(["systemctl", "restart", "energetica-channel-bridge"], check=True)
            health()
            print(json.dumps({"status": "deployed", "backup": str(backup),
                "moduleSha256": hashlib.sha256(module).hexdigest(),
                "bridgeSha256": hashlib.sha256(next(iter(sources.values()))[1]).hexdigest()}))
        except Exception:
            for root, source, stat in reversed(changed):
                atomic(root / "channel_bridge.py", source, stat.st_uid, stat.st_gid, stat.st_mode & 0o777)
                (root / "dda_sync.py").unlink(missing_ok=True)
            subprocess.run(["systemctl", "restart", "energetica-channel-bridge"], check=True)
            health()
            raise

if __name__ == "__main__":
    main()
