"""Hash-guarded, recoverable one-file RHID day-validation deployment."""
from contextlib import ExitStack, contextmanager
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from urllib.request import urlopen
from uuid import uuid4
import argparse
import ctypes
import fcntl
import json
import os
import shutil
import stat
import subprocess
import tempfile
import time

from patch_bridge import patch_bridge

ROOTS = (Path("/opt/energetica-whatsapp"), Path("/home/opc/energetica-build"))
LOCKS = (Path("/tmp/energetica-whatsapp-deploy.lock"), Path("/home/opc/.energetica-deploy.lock"))


def digest(data):
    return sha256(data).hexdigest()


def checked(path, expected):
    if path.is_symlink() or path.parent.resolve() != path.parent or not path.is_file():
        raise RuntimeError("Unexpected target path: " + str(path))
    data = path.read_bytes()
    if digest(data) != expected:
        raise RuntimeError("Source changed; refusing replacement: " + str(path))
    return data


@contextmanager
def deployment_locks():
    with ExitStack() as stack:
        for path in LOCKS:
            flags = os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC
            try:
                fd = os.open(path, flags)
            except FileNotFoundError:
                try:
                    fd = os.open(path, flags | os.O_CREAT | os.O_EXCL, 0o644)
                except FileExistsError:
                    fd = os.open(path, flags)
            stream = stack.enter_context(os.fdopen(fd, "r+"))
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid not in {0, os.geteuid(), 1000}:
                raise RuntimeError("Unexpected deployment lock")
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def exchange(left, right):
    """Atomically swap two paths on the same filesystem (Linux renameat2)."""
    libc = ctypes.CDLL(None, use_errno=True)
    operation = libc.renameat2
    operation.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
    operation.restype = ctypes.c_int
    if operation(-100, os.fsencode(left), -100, os.fsencode(right), 2) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), str(left))


def atomic_install(path, candidate, expected, recovery):
    before = checked(path, expected)
    info = path.stat()
    fd, name = tempfile.mkstemp(prefix=".rhid-day-", dir=str(path.parent))
    temp = Path(name)
    displaced = recovery / (("live-" if path.parent == ROOTS[0] else "mirror-") + path.name)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(candidate)
            output.flush()
            os.fsync(output.fileno())
        os.chown(temp, info.st_uid, info.st_gid)
        os.chmod(temp, stat.S_IMODE(info.st_mode))
        checked(path, expected)
        exchange(temp, path)
        try:
            if digest(temp.read_bytes()) != digest(before):
                raise RuntimeError("Source changed during exchange")
            shutil.copy2(temp, displaced)
            if digest(displaced.read_bytes()) != expected:
                raise RuntimeError("Displaced source copy differs")
        except Exception:
            if temp.exists() and digest(path.read_bytes()) == digest(candidate):
                exchange(temp, path)
            raise
    finally:
        temp.unlink(missing_ok=True)
    return displaced


def healthy():
    for _ in range(20):
        try:
            with urlopen("http://127.0.0.1:8080/health", timeout=1) as response:
                if response.status == 200:
                    return True
        except OSError:
            pass
        time.sleep(.5)
    return False


def run(expected, stage, apply=False):
    if len(expected) != 64 or any(char not in "0123456789abcdef" for char in expected):
        raise ValueError("Expected SHA-256 required")
    stage = Path(stage).resolve()
    if any(stage.is_relative_to(root.resolve()) for root in ROOTS):
        raise ValueError("Stage must be outside both code roots")
    targets = [root / "channel_bridge.py" for root in ROOTS]
    with deployment_locks():
        originals = {path: checked(path, expected) for path in targets}
        candidate = {path: patch_bridge(data.decode("utf-8")).encode("utf-8") for path, data in originals.items()}
        after = {path: digest(data) for path, data in candidate.items()}
        if len(set(after.values())) != 1:
            raise RuntimeError("Candidates differ between roots")
        receipt = {"status": "checked" if not apply else "pending", "before": expected,
                   "after": next(iter(after.values()))}
        if not apply:
            return receipt
        recovery = stage / ("rhid-day-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + "-" + uuid4().hex[:8])
        recovery.mkdir(parents=True, mode=0o700, exist_ok=False)
        displaced = {}
        for path in targets:
            backup = recovery / (("live-" if path.parent == ROOTS[0] else "mirror-") + path.name + ".backup")
            backup.write_bytes(originals[path])
            if digest(backup.read_bytes()) != expected:
                raise RuntimeError("Backup verification failed")
        try:
            for path in targets:
                displaced[path] = atomic_install(path, candidate[path], expected, recovery)
                checked(path, after[path])
            subprocess.run(["systemctl", "restart", "energetica-whatsapp"], check=True)
            if not healthy():
                raise RuntimeError("Service health failed")
            for path in targets:
                checked(path, after[path])
        except Exception:
            for path, old in reversed(list(displaced.items())):
                if digest(path.read_bytes()) != after[path]:
                    raise RuntimeError("Concurrent target change preserved; manual recovery: " + str(recovery))
                info = path.stat()
                fd, name = tempfile.mkstemp(prefix=".rhid-day-rollback-", dir=str(path.parent))
                temp = Path(name)
                try:
                    with os.fdopen(fd, "wb") as output:
                        output.write(old.read_bytes())
                        output.flush()
                        os.fsync(output.fileno())
                    os.chown(temp, info.st_uid, info.st_gid)
                    os.chmod(temp, stat.S_IMODE(info.st_mode))
                    exchange(temp, path)
                    (recovery / (("live-" if path.parent == ROOTS[0] else "mirror-") + path.name + ".candidate")).write_bytes(temp.read_bytes())
                finally:
                    temp.unlink(missing_ok=True)
            subprocess.run(["systemctl", "restart", "energetica-whatsapp"], check=True)
            raise
        receipt.update({"status": "deployed", "health": "ok", "recovery": str(recovery)})
        (recovery / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected", required=True)
    parser.add_argument("--stage", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(json.dumps(run(args.expected, args.stage, args.apply)))
