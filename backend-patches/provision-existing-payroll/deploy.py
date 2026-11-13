"""Deploy the validated workflow to its live and build-mirror roots."""
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
import time
from urllib.request import urlopen

TARGETS = {
    "live": Path("/opt/energetica-whatsapp/worker/workflow.py"),
    "mirror": Path("/home/opc/energetica-build/worker/workflow.py"),
}
RUNNER = Path("/home/opc/provision-contractor-payroll-20261029/package/shared-deploy.py")
RUNNER_HASH = "01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2"
LOCK = "/tmp/energetica-whatsapp-deploy.lock"
BACKUP_ROOT = Path("/var/backups/energetica-whatsapp")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def health(runner):
    result = runner.wait_health()
    for attempt in range(15):
        try:
            with urlopen("http://127.0.0.1:8080/health", timeout=3) as response:
                if response.status == 200 and response.read().strip() == b"ok":
                    return {"bridge": result["status"], "worker": "ok"}
                raise RuntimeError("Worker health check failed")
        except (OSError, RuntimeError, TimeoutError):
            if attempt == 14:
                raise
            time.sleep(1)


def restart():
    subprocess.run(["systemctl", "restart", "energetica-whatsapp.service",
                    "energetica-channel-bridge.service"], timeout=30, check=True)


def deploy(stage, check_only):
    manifest = json.loads((stage / "deploy-manifest.json").read_text(encoding="utf-8"))
    if set(manifest) != set(TARGETS) or digest(RUNNER) != RUNNER_HASH:
        raise RuntimeError("Unexpected manifest scope or deploy runner")
    spec = importlib.util.spec_from_file_location("shared_deploy", RUNNER)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    for name, target in TARGETS.items():
        pins = manifest[name]
        candidate = stage / (name + "-candidate.py")
        if (target.resolve() != target or digest(target) != pins["before"]
                or digest(candidate) != pins["after"]
                or digest(stage / (name + ".patch")) != pins["patch"]):
            raise RuntimeError("Source or candidate changed for " + name)
        compile(candidate.read_bytes(), str(target), "exec")
    old_health = health(runner)
    if check_only:
        return {"status": "checked", "health": old_health}

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = BACKUP_ROOT / ("provision-existing-payroll-" + stamp)
    backup.mkdir(mode=0o700)
    originals = {}
    for name, target in TARGETS.items():
        saved = backup / (name + "-workflow.py")
        shutil.copy2(target, saved)
        if digest(saved) != manifest[name]["before"]:
            raise RuntimeError("Backup mismatch for " + name)
        originals[name] = (saved, target.stat())
    (backup / "deploy-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    installed = []
    try:
        for name, target in TARGETS.items():
            if digest(target) != manifest[name]["before"]:
                raise RuntimeError("Concurrent workflow change for " + name)
            runner.atomic_copy(stage / (name + "-candidate.py"), target, originals[name][1])
            installed.append(name)
            if digest(target) != manifest[name]["after"]:
                raise RuntimeError("Installed hash mismatch for " + name)
        restart()
        current_health = health(runner)
        after = {name: digest(target) for name, target in TARGETS.items()}
        if any(after[name] != manifest[name]["after"] for name in TARGETS):
            raise RuntimeError("Installed source changed after restart")
    except Exception:
        errors = []
        for name in reversed(installed):
            target = TARGETS[name]
            try:
                if digest(target) != manifest[name]["after"]:
                    raise RuntimeError("Concurrent change preserved for " + name)
                runner.atomic_copy(originals[name][0], target, originals[name][1])
                if digest(target) != manifest[name]["before"]:
                    raise RuntimeError("Restored hash mismatch for " + name)
            except Exception as error:
                errors.append(str(error))
        if installed:
            try:
                restart()
                health(runner)
            except Exception as error:
                errors.append(str(error))
        (backup / "receipt.json").write_text(json.dumps({"status": "rollback_incomplete" if errors else "rolled_back",
                                                         "errors": errors}, indent=2), encoding="utf-8")
        raise
    result = {"status": "deployed", "backup": str(backup), "health": current_health, "after": after}
    (backup / "receipt.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in {"--check", "--deploy"}:
        raise SystemExit("Usage: deploy.py --check|--deploy STAGE")
    fd = os.open(LOCK, os.O_NOFOLLOW | os.O_RDWR | os.O_CREAT, 0o644)
    with os.fdopen(fd, "r+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(deploy(Path(sys.argv[2]).resolve(strict=True), sys.argv[1] == "--check")))
