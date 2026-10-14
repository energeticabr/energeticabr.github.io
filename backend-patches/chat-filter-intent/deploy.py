"""Guarded deployment of the tested workflow candidate on the Energético VM.

Run as root with the candidate path after patch_workflow.py and tests pass.
Never removes its backup; if post-deploy verification fails, restores both files.
"""

from datetime import datetime, timezone
import fcntl
import hashlib
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen


APP = Path("/opt/energetica-whatsapp/worker/workflow.py")
BUILD = Path("/home/opc/energetica-build/worker/workflow.py")
BASELINE = "910a6d02e87c35c83af13914fc43e34e014caa24ad5c3fffe455547b42c55c85"
CANDIDATE = "1e9943436d42423ed5ada269d903e87a7f3ecc92f53344a335e99f50f000b3f8"
SERVICES = ("energetica-whatsapp.service", "energetica-channel-bridge.service")
HEALTH = ("http://127.0.0.1:8080/health", "http://127.0.0.1:8765/health")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def install(source, destination):
    original = destination.stat()
    with tempfile.NamedTemporaryFile(prefix=".workflow-chat-filter-", dir=destination.parent,
                                     delete=False) as handle:
        temporary = Path(handle.name)
    try:
        shutil.copyfile(source, temporary)
        temporary.chmod(stat.S_IMODE(original.st_mode))
        os.chown(temporary, original.st_uid, original.st_gid)
        if digest(temporary) != digest(source):
            raise RuntimeError("Candidate copy hash changed")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def restart_and_check():
    subprocess.run(("systemctl", "restart", *SERVICES), check=True, timeout=45)
    for _ in range(10):
        try:
            subprocess.run(("systemctl", "is-active", "--quiet", *SERVICES), check=True, timeout=5)
            if all(urlopen(url, timeout=3).status == 200 for url in HEALTH):
                return
        except Exception:
            time.sleep(2)
    raise RuntimeError("Services did not recover their health endpoints")


def main():
    candidate = Path(sys.argv[1]).resolve(strict=True)
    if candidate != Path("/tmp/workflow-chat-filter-candidate.py"):
        raise ValueError("Unexpected candidate path")
    lock_path = Path("/home/opc/.energetica-deploy.lock")
    with lock_path.open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if any(digest(path) != BASELINE for path in (APP, BUILD)):
            raise RuntimeError("Live or build workflow changed; refusing to overwrite")
        if digest(candidate) != CANDIDATE:
            raise RuntimeError("Candidate differs from tested source")
        backup = Path("/home/opc") / ("chat-filter-intent-backup-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
        backup.mkdir(mode=0o700)
        for name, path in (("app", APP), ("build", BUILD)):
            shutil.copy2(path, backup / f"{name}-workflow.py")
            if digest(backup / f"{name}-workflow.py") != BASELINE:
                raise RuntimeError("Backup verification failed")
        deployed = False
        try:
            install(candidate, APP)
            deployed = True
            install(candidate, BUILD)
            if any(digest(path) != CANDIDATE for path in (APP, BUILD)):
                raise RuntimeError("Installed hash mismatch")
            restart_and_check()
        except BaseException:
            if deployed:
                install(backup / "app-workflow.py", APP)
                install(backup / "build-workflow.py", BUILD)
                restart_and_check()
            raise
        print(f"CHAT_FILTER_DEPLOYMENT_VERIFIED backup={backup} hash={CANDIDATE}")


if __name__ == "__main__":
    main()
