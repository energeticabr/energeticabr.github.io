"""Guarded installation of reviewed UI retirement sources, with rollback."""
import datetime
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

SERVICES = ["energetica-whatsapp", "energetica-channel-bridge"]
ALLOWED = {
    "/opt/energetica-whatsapp/worker/workflow.py",
    "/home/opc/energetica-build/worker/workflow.py",
    "/opt/energetica-whatsapp/channel_bridge.py",
    "/home/opc/energetica-build/channel_bridge.py",
}

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def install(source, target):
    stat = target.stat()
    descriptor, temporary = tempfile.mkstemp(prefix=".retired-gallery-", dir=str(target.parent))
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(source.read_bytes())
            output.flush()
            os.fsync(output.fileno())
        os.chown(temporary, stat.st_uid, stat.st_gid)
        os.chmod(temporary, stat.st_mode & 0o777)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def health():
    if any(subprocess.run(["systemctl", "is-active", "--quiet", service]).returncode for service in SERVICES):
        return False
    try:
        with urllib.request.urlopen("http://127.0.0.1:8080/health", timeout=5) as response:
            if response.read().decode().strip() != "ok":
                return False
        with urllib.request.urlopen("http://127.0.0.1:8765/health", timeout=5) as response:
            return json.load(response).get("status") == "ok"
    except (OSError, ValueError):
        return False

def main():
    import sys
    root = Path(sys.argv[1]).resolve()
    assert os.geteuid() == 0
    manifest = json.loads((root / "manifest.json").read_text())
    records = manifest["sources"]
    targets = [Path(target) for record in records for target in record["targets"]]
    assert len(targets) == 4 and {str(target) for target in targets} == ALLOWED
    for record in records:
        source = root / record["file"]
        assert source.is_file() and not source.is_symlink()
        assert source.resolve().parent == root
        assert digest(source) == record["candidate_sha256"], "Reviewed candidate changed"
        compile(source.read_text(), str(source), "exec")
        for target_name in record["targets"]:
            target = Path(target_name)
            assert target.is_file() and not target.is_symlink(), str(target)
            assert digest(target) == record["base_sha256"], "Live source changed: " + str(target)
    assert health(), "Services unhealthy before deployment"
    backup = Path("/var/backups/energetica-whatsapp") / ("retired-delegated-gallery-" + datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%S%fZ"))
    backup.mkdir(mode=0o700)
    for index, target in enumerate(targets):
        shutil.copy2(target, backup / (str(index) + "-" + target.name))
    try:
        for record in records:
            for target_name in record["targets"]:
                install(root / record["file"], Path(target_name))
        for service in SERVICES:
            subprocess.run(["systemctl", "restart", service], check=True)
        for _ in range(20):
            if health():
                break
            time.sleep(1)
        else:
            raise RuntimeError("Health check failed after restart")
        for record in records:
            assert all(digest(Path(target)) == record["candidate_sha256"] for target in record["targets"])
    except BaseException:
        for index, target in enumerate(targets):
            install(backup / (str(index) + "-" + target.name), target)
        for service in SERVICES:
            subprocess.run(["systemctl", "restart", service], check=True)
        raise
    print(json.dumps({"backup": str(backup), "sources": records, "services": SERVICES, "health": "ok"}))

if __name__ == "__main__":
    main()
