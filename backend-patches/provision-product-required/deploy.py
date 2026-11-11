"""Install the tested patch using the shared atomic VM rollout."""

import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import sys


PACKAGE = Path(__file__).resolve().parent
ROOTS = (Path("/opt/energetica-whatsapp"), Path("/home/opc/energetica-build"))
FILES = ("worker/workflow_config.json", "worker/workflow.py", "worker/payment_provision_flow.py")
INPUTS = {"deploy.py", "patch_backend.py", "shared-deploy.py", "deployment_gate.sh"}
LOCK = "/tmp/energetica-whatsapp-deploy.lock"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load_verified(name, data):
    scope = {"__file__": str(PACKAGE / name), "__name__": name}
    exec(compile(data, str(PACKAGE / name), "exec"), scope)
    return scope


def prepare(expected):
    raw = (PACKAGE / "deploy-manifest.json").read_bytes()
    if digest(raw) != expected:
        raise ValueError("Deployment manifest hash mismatch")
    manifest = json.loads(raw)
    targets = [(root / name, name) for root in ROOTS for name in FILES]
    if set(manifest["inputs"]) != INPUTS or set(manifest["files"]) != {str(path) for path, _ in targets}:
        raise ValueError("Unexpected deployment scope")
    inputs = {}
    for name, pin in manifest["inputs"].items():
        path = PACKAGE / name
        inputs[name] = path.read_bytes()
        if path.is_symlink() or digest(inputs[name]) != pin:
            raise ValueError(f"Deployment input hash mismatch: {name}")
    patch = load_verified("patch_backend.py", inputs["patch_backend.py"])["patch"]
    plan = []
    for path, name in targets:
        if path.resolve() != path or not path.is_file() or path.stat().st_nlink != 1:
            raise ValueError(f"Unexpected file: {path}")
        before = path.read_bytes()
        pins = manifest["files"][str(path)]
        if digest(before) != pins["before"]:
            raise ValueError(f"Source drift: {path}")
        after = patch(name, before)
        if digest(after) != pins["after"]:
            raise ValueError(f"Candidate hash mismatch: {path}")
        if path.suffix == ".py":
            compile(after, str(path), "exec")
        plan.append((path, before, after))
    runner = load_verified("shared-deploy.py", inputs["shared-deploy.py"])
    runner["BACKUPS"] /= "provision-product-required"
    return runner, plan


def main():
    mode, expected = sys.argv[1:]
    if mode not in {"--check", "--deploy"} or os.geteuid() != 0:
        raise ValueError("Expected root and explicit deployment mode")
    if PACKAGE.parent != Path("/var/lib/energetica-deploy"):
        raise ValueError("Expected a root-owned deployment stage")
    for path in (PACKAGE, *PACKAGE.parents, *PACKAGE.iterdir()):
        info = path.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or path.is_symlink():
            raise ValueError(f"Unprotected deployment path: {path}")
    fd = os.open(LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o644)
    with os.fdopen(fd, "r+") as lock:
        if not stat.S_ISREG(os.fstat(lock.fileno()).st_mode):
            raise ValueError("Invalid deployment lock")
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        runner, plan = prepare(expected)
        if mode == "--check":
            result = {"status": "checked", "health": runner["health"](),
                      "candidate": {str(path): digest(after) for path, _, after in plan}}
        else:
            if not os.environ.get("PROVISION_PRODUCT_GATE"):
                raise ValueError("Drain ingress using the shared deployment gate first")
            result = runner["rollout"](plan)
        print(json.dumps(result))


if __name__ == "__main__":
    main()
