"""Exact six-file CAS rollout. Existing shared installer/locks preserve other writers."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import time
from urllib.request import urlopen

HERE = Path(__file__).resolve().parent
HELPERS = HERE.parent / "attendance-rhid-badges"
if not HELPERS.is_dir(): HELPERS = HERE / "deployment_helpers"
for name, expected in {
    "deploy_context.py": "cbf8f8434b00e7aaa5c148dec2c8c09f3b4aef734d0ea711e8fcce42370bca51",
    "patch_presence_context.py": "e7ba490d03e70171d12afcd8f76713ccbaab65b7ec77b2f9464cf753b6d5aaa6",
}.items():
    if hashlib.sha256((HELPERS / name).read_text(encoding="utf-8").encode()).hexdigest() != expected:
        raise RuntimeError("Deployment helper differs from reviewed source: " + name)
sys.path.insert(0, str(HELPERS))
import deploy_context as safe

ROOTS = (Path("/opt/energetica-whatsapp"), Path("/home/opc/energetica-build"))
NAMES = ("channel_bridge.py", "diary_progress.py", "operation_progress.py")


def entries(manifest):
    files = manifest.get("files", [])
    if len(files) != 6 or {entry.get("destination") for entry in files} != {str(root / name) for root in ROOTS for name in NAMES}:
        raise ValueError("Expected exactly six reviewed code targets")
    for entry in files:
        name = Path(entry["destination"]).name
        if entry.get("candidate") != name: raise ValueError("Unexpected candidate path")
        for key in ("before_sha256", "after_sha256"):
            value = entry.get(key)
            if key == "before_sha256" and name == "operation_progress.py" and value is None: continue
            if not isinstance(value, str) or len(value) != 64 or any(character not in "0123456789abcdef" for character in value):
                raise ValueError("Invalid source hash")
    return files


def health():
    subprocess.run(["systemctl", "is-active", "--quiet", "energetica-channel-bridge.service"], check=True, timeout=5)
    with urlopen("http://127.0.0.1:8765/health", timeout=3) as response:
        if response.status != 200 or json.loads(response.read()).get("status") != "ok": raise RuntimeError("Bridge health failed")


def restart():
    subprocess.run(["systemctl", "restart", "energetica-channel-bridge.service"], check=True, timeout=45)
    for attempt in range(20):
        try: health(); return
        except Exception:
            if attempt == 19: raise
            time.sleep(.5)


def validate_stage(stage):
    stage = Path(stage).absolute()
    if stage.resolve() != stage or not str(stage).startswith("/home/opc/measured-progress-20261027-"):
        raise ValueError("Unexpected private deployment stage")
    return stage


def deploy(stage, expected_manifest, apply=False):
    stage = validate_stage(stage)
    manifest_bytes = (HERE / "deploy-manifest.json").read_bytes()
    if hashlib.sha256(manifest_bytes).hexdigest() != expected_manifest: raise ValueError("Manifest changed")
    files = entries(json.loads(manifest_bytes))
    originals, candidates, attributes = {}, {}, {}
    for entry in files:
        target = Path(entry["destination"])
        if entry["before_sha256"] is None:
            if target.exists() or target.is_symlink() or target.parent.resolve() != target.parent: raise RuntimeError("New module target already exists or aliases")
            originals[target] = None
            attributes[target] = (target.parent / "channel_bridge.py").stat()
        else:
            originals[target] = safe.checked(target, entry["before_sha256"])
            attributes[target] = target.stat()
        candidates[target] = safe.checked(stage / entry["candidate"], entry["after_sha256"])
        compile(candidates[target], str(target), "exec")
    health()
    result = {"status": "checked", "codeHashes": {entry["destination"]: entry["after_sha256"] for entry in files}}
    if not apply: return result
    backup = stage / ("backup-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
    backup.mkdir(mode=0o700)
    for index, entry in enumerate(files):
        target = Path(entry["destination"])
        if originals[target] is not None:
            safe.checked(target, entry["before_sha256"])
            shutil.copy2(target, backup / str(index))
            safe.checked(backup / str(index), entry["before_sha256"])
    attempted = []
    try:
        # Create-only module before installing either importer.
        for entry in sorted(files, key=lambda entry: entry["before_sha256"] is not None):
            target = Path(entry["destination"]); info = attributes[target]
            if entry["before_sha256"] is None:
                # The completed staged inode is linked atomically, never replaces an existing target.
                staged = backup / ("new-" + str(len(attempted)))
                staged.write_bytes(candidates[target]); os.chown(staged, info.st_uid, info.st_gid); os.chmod(staged, stat.S_IMODE(info.st_mode))
                os.link(staged, target)
                attempted.append(entry)
            else:
                attempted.append(entry)
                safe.install(candidates[target], target, info, entry["before_sha256"])
            safe.checked(target, entry["after_sha256"])
        restart()
        for entry in files: safe.checked(Path(entry["destination"]), entry["after_sha256"])
    except BaseException as failure:
        errors = []
        for entry in reversed(attempted):
            target = Path(entry["destination"])
            try:
                if entry["before_sha256"] is None:
                    safe.checked(target, entry["after_sha256"]); target.unlink()
                elif safe.digest(target) != entry["before_sha256"]:
                    safe.install(originals[target], target, attributes[target], entry["after_sha256"])
            except Exception as error: errors.append(str(error))
        try: restart()
        except Exception as error: errors.append(str(error))
        if errors: raise RuntimeError("Rollback incomplete; backup retained at " + str(backup) + ": " + "; ".join(errors)) from failure
        raise
    result.update(status="published", serviceHealth=True, backup=str(backup))
    (backup / "receipt.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[3] not in ("--check", "--apply"):
        raise SystemExit("Usage: deploy.py STAGE MANIFEST_SHA256 --check|--apply")
    with safe.deployment_locks([Path("/tmp/energetica-whatsapp-deploy.lock"), Path("/home/opc/.energetica-deploy.lock")]):
        print(json.dumps(deploy(sys.argv[1], sys.argv[2], sys.argv[3] == "--apply")))
