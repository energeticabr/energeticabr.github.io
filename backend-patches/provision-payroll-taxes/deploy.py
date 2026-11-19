"""Install pinned workflow candidates and tax helper with a shared lock and rollback."""
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from urllib.request import urlopen

ROOTS = {"live": Path("/opt/energetica-whatsapp/worker"),
         "mirror": Path("/home/opc/energetica-build/worker")}
TARGETS = {**{key: root / "workflow.py" for key, root in ROOTS.items()},
           **{"tax-" + key: root / "payroll_tax_settlement.py" for key, root in ROOTS.items()}}
RUNNER = Path("/home/opc/provision-contractor-payroll-20261029/package/shared-deploy.py")
RUNNER_HASH = "01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2"
BACKUP_ROOT = Path("/var/backups/energetica-whatsapp")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def health(runner):
    bridge = runner.wait_health()
    with urlopen("http://127.0.0.1:8080/health", timeout=10) as response:
        if response.status != 200 or response.read().strip() != b"ok":
            raise RuntimeError("Worker health check failed")
    return {"bridge": bridge["status"], "worker": "ok"}


def restart():
    subprocess.run(["systemctl", "restart", "energetica-whatsapp.service",
                    "energetica-channel-bridge.service"], check=True, timeout=60)


def deploy(stage, manifest_hash, check_only):
    manifest_file = stage / "deploy-manifest.json"
    if digest(manifest_file) != manifest_hash or digest(RUNNER) != RUNNER_HASH:
        raise RuntimeError("Manifest or shared runner changed")
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    if set(manifest) != set(TARGETS):
        raise RuntimeError("Unexpected deploy scope")
    validated = {}
    for key, target in TARGETS.items():
        pin = manifest[key]
        candidate = stage / pin["candidate"]
        candidate_bytes = candidate.read_bytes()
        if (target.is_symlink() or target.resolve() != target or candidate.parent != stage
                or digest(target) != pin["before"] or hashlib.sha256(candidate_bytes).hexdigest() != pin["after"]):
            raise RuntimeError("Source or candidate drift: " + key)
        if not key.startswith("tax-") and digest(stage / (key + ".patch")) != pin["patch"]:
            raise RuntimeError("Patch drift: " + key)
        compile(candidate_bytes, str(target), "exec")
        validated[key] = candidate_bytes
    spec = importlib.util.spec_from_file_location("shared_deploy", RUNNER)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    old_health = health(runner)
    if check_only:
        return {"status": "checked", "health": old_health}

    backup = BACKUP_ROOT / (
        "provision-payroll-taxes-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
    backup.mkdir(mode=0o700)
    originals = {}
    attributes = {}
    for key, target in TARGETS.items():
        attributes[key] = target.stat() if target.exists() else target.with_name("workflow.py").stat()
        if target.exists():
            saved = backup / (key + ".py")
            shutil.copy2(target, saved)
            if digest(saved) != manifest[key]["before"]:
                raise RuntimeError("Backup mismatch: " + key)
            originals[key] = saved
        else:
            originals[key] = None
        # The root-only backup directory freezes exactly the bytes validated above.
        frozen = backup / ("candidate-" + key + ".py")
        frozen.write_bytes(validated[key])
        frozen.chmod(0o600)
    shutil.copy2(manifest_file, backup / "deploy-manifest.json")
    installed = []
    try:
        # Make the helper available before installing a workflow that imports it.
        for key in ("tax-live", "tax-mirror", "live", "mirror"):
            target, pin = TARGETS[key], manifest[key]
            if digest(target) != pin["before"]:
                raise RuntimeError("Concurrent source change: " + key)
            runner.atomic_copy(backup / ("candidate-" + key + ".py"), target, attributes[key])
            installed.append(key)
            if digest(target) != pin["after"]:
                raise RuntimeError("Installed mismatch: " + key)
        restart()
        current_health = health(runner)
        after = {key: digest(target) for key, target in TARGETS.items()}
        if any(after[key] != manifest[key]["after"] for key in TARGETS):
            raise RuntimeError("Installed sources changed after restart")
    except Exception:
        errors = []
        for key in reversed(installed):
            target = TARGETS[key]
            try:
                if digest(target) != manifest[key]["after"]:
                    raise RuntimeError("Concurrent edit preserved: " + key)
                if originals[key] is None:
                    target.unlink()
                else:
                    runner.atomic_copy(originals[key], target, attributes[key])
            except Exception as error:
                errors.append(str(error))
        try:
            restart()
            health(runner)
        except Exception as error:
            errors.append(str(error))
        (backup / "receipt.json").write_text(json.dumps({"status": "rollback_incomplete" if errors else "rolled_back",
                                                         "errors": errors}), encoding="utf-8")
        raise
    result = {"status": "deployed", "backup": str(backup), "health": current_health, "after": after}
    (backup / "receipt.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] not in {"--check", "--deploy"}:
        raise SystemExit("Usage: deploy.py --check|--deploy STAGE MANIFEST_SHA256")
    fd = os.open("/tmp/energetica-whatsapp-deploy.lock", os.O_NOFOLLOW | os.O_CREAT | os.O_RDWR, 0o644)
    with os.fdopen(fd, "r+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(deploy(Path(sys.argv[2]).resolve(strict=True), sys.argv[3], sys.argv[1] == "--check")))
