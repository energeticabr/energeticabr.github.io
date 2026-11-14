"""Publish the RH workflow and configuration together on the Energético VM."""

import argparse
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

from patch_backend import patch_config, patch_workflow


ROOTS = (Path("/opt/energetica-whatsapp"), Path("/home/opc/energetica-build"))
SERVICES = ("energetica-channel-bridge.service", "energetica-whatsapp.service")
LOCK = "/tmp/energetica-whatsapp-deploy.lock"
SHARED = Path("/home/opc/provision-contractor-payroll-20261029/package/shared-deploy.py")
SHARED_SHA = "01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2"


def shared_runner():
    if hashlib.sha256(SHARED.read_bytes()).hexdigest() != SHARED_SHA:
        raise RuntimeError("Shared deployer hash mismatch")
    spec = importlib.util.spec_from_file_location("workflow_deploy", SHARED)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    return runner


def check_health(runner):
    health = runner.wait_health()
    subprocess.run(["systemctl", "is-active", "--quiet", SERVICES[1]], check=True)
    with urlopen("http://127.0.0.1:8080/health", timeout=5) as response:
        if response.status != 200:
            raise RuntimeError("Worker health check failed")
    return health


def deploy(stage, apply):
    runner = shared_runner()
    files = []
    for root, stage_name in zip(ROOTS, ("app", "mirror")):
        candidate_dir = stage / stage_name
        for name, patch in (("workflow.py", patch_workflow), ("workflow_config.json", patch_config)):
            target = root / "worker" / name
            if target.resolve() != target or not target.is_file():
                raise RuntimeError(f"Invalid deploy target: {target}")
            before = target.read_bytes()
            candidate = candidate_dir / name
            after = candidate.read_bytes()
            if patch(before.decode("utf-8")).encode("utf-8") != after:
                raise RuntimeError(f"Candidate differs from current source: {target}")
            files.append((target, candidate, before, after, target.stat()))
    check_health(runner)
    if not apply:
        return {"status": "checked", "targets": [str(row[0]) for row in files]}

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = Path("/var/backups/energetica-whatsapp") / f"rh-menu-retirement-{stamp}"
    backup.mkdir(mode=0o700, parents=True)
    for index, (target, _, before, _, _) in enumerate(files):
        saved = backup / f"{index}-{target.name}"
        shutil.copy2(target, saved)
        if saved.read_bytes() != before:
            raise RuntimeError(f"Backup differs from checked source: {target}")
    changed = []
    try:
        for index, (target, candidate, before, after, metadata) in enumerate(files):
            if target.read_bytes() != before or candidate.read_bytes() != after:
                raise RuntimeError(f"Concurrent change: {target}")
            changed.append(index)
            runner.atomic_copy(candidate, target, metadata)
            if target.read_bytes() != after:
                raise RuntimeError(f"Installed source differs: {target}")
        subprocess.run(["systemctl", "restart", *SERVICES], check=True)
        health = check_health(runner)
        for target, _, _, after, _ in files:
            if target.read_bytes() != after:
                raise RuntimeError(f"Post-restart source differs: {target}")
    except Exception:
        failures = []
        for index in reversed(changed):
            target, _, before, after, metadata = files[index]
            try:
                if target.read_bytes() == after:
                    runner.atomic_copy(backup / f"{index}-{target.name}", target, metadata)
                if target.read_bytes() != before:
                    raise RuntimeError(f"Concurrent change preserved: {target}")
            except Exception as error:
                failures.append(str(error))
        if changed:
            try:
                subprocess.run(["systemctl", "restart", *SERVICES], check=True)
                check_health(runner)
            except Exception as error:
                failures.append(str(error))
        print(json.dumps({"status": "rollback_incomplete" if failures else "rolled_back",
                          "backup": str(backup), "failures": failures}), file=sys.stderr)
        raise
    receipt = {"status": "deployed", "backup": str(backup), "health": health,
               "after": {str(target): hashlib.sha256(after).hexdigest()
                         for target, _, _, after, _ in files}}
    (backup / "receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    with os.fdopen(os.open(LOCK, os.O_RDWR | os.O_NOFOLLOW), "r+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(deploy(args.stage.resolve(), args.apply)))
