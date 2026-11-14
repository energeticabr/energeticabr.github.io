"""Build and install the IDFOLHA report backend from independently pinned source trees."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen


HERE = Path(__file__).resolve().parent
PRODUCTION = PurePosixPath("/opt/energetica-whatsapp")
MIRROR = PurePosixPath("/home/opc/energetica-build")
TARGET_ROOTS = {"live": PRODUCTION, "mirror": MIRROR}
BRIDGE, GALLERY, NEW = "channel_bridge.py", "worker/launch_gallery.py", "worker/payroll_pending.py"
WORKER = "worker/workflow.py"
FILES = (NEW, GALLERY, WORKER, BRIDGE)
STAGE = Path("/var/lib/energetica-deploy/payroll-pending")
BACKUPS = Path("/var/backups/energetica-whatsapp")
LOCKS = (Path("/tmp/energetica-whatsapp-deploy.lock"), Path("/home/opc/.energetica-deploy.lock"))
DEPS = {
    "deploy_context.py": "cbf8f8434b00e7aaa5c148dec2c8c09f3b4aef734d0ea711e8fcce42370bca51",
    "patch_presence_context.py": "e7ba490d03e70171d12afcd8f76713ccbaab65b7ec77b2f9464cf753b6d5aaa6",
}
GATE_SHA256 = "ae5ed44ab6d6ab1edfecbc14dd3bbd59505e9f991962d1410f488e4a029eefb6"
INPUTS = {"deploy.py", "deploy.sh", "patch_backend.py", "payroll_pending.py",
          "deployment_gate.sh", *DEPS}


def sha(content):
    return hashlib.sha256(content).hexdigest()


def checked_file(path, expected=None):
    if path.resolve() != path or path.is_symlink() or not path.is_file() or path.stat().st_nlink != 1:
        raise RuntimeError(f"File missing or aliased: {path}")
    content = path.read_bytes()
    if expected is not None and sha(content) != expected:
        raise RuntimeError(f"SHA-256 mismatch: {path}")
    return content


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_package(baselines, out):
    """Package reviewed code and release pins without copying the captured backend sources."""
    patch = load_module(HERE / "patch_backend.py", "pending_patch")
    current = checked_file(HERE / "payroll_pending.py").replace(b"\r\n", b"\n")
    compile(current, NEW, "exec")
    entries = {}
    for scope, root in TARGET_ROOTS.items():
        matching = baselines / scope
        upgrading = (matching / NEW).is_file()
        for relative in FILES:
            path = matching / relative
            if relative == NEW:
                before = sha(checked_file(path)) if upgrading else None
                entries[f"{root}/{relative}"] = {"before": before, "after": sha(current)}
                continue
            before = checked_file(path)
            if upgrading:
                if b"payroll_pending" not in before:
                    raise RuntimeError(f"Payroll report was not installed in {path}")
                after = before
            else:
                after = patch.change(relative, before)
            compile(after, relative, "exec")
            entries[f"{root}/{relative}"] = {"before": sha(before), "after": sha(after)}
    sources = {
        "deployment_gate.sh": HERE.parent / "launch-payroll-attachments" / "deployment_gate.sh",
        **{filename: HERE.parent / "attendance-rhid-badges" / filename for filename in DEPS},
    }
    inputs = {filename: checked_file(sources.get(filename, HERE / filename)).replace(b"\r\n", b"\n")
              for filename in sorted(INPUTS - {"payroll_pending.py"})}
    inputs["payroll_pending.py"] = current
    for filename, pin in DEPS.items():
        if sha(inputs[filename]) != pin:
            raise RuntimeError(f"Unexpected shared deployment helper: {filename}")
    if sha(inputs["deployment_gate.sh"]) != GATE_SHA256:
        raise RuntimeError("Unexpected ingress gate version")
    manifest = {"files": entries, "inputs": {filename: sha(content) for filename, content in inputs.items()}}
    out.mkdir(mode=0o700, exist_ok=False)
    for filename, content in inputs.items():
        (out / filename).write_bytes(content)
    raw = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")
    (out / "deploy-manifest.json").write_bytes(raw)
    return sha(raw)


def validate_stage(expected):
    if os.geteuid() != 0 or HERE != STAGE:
        raise RuntimeError(f"Run the installed package as root from {STAGE}")
    for directory in (HERE, *HERE.parents):
        attrs = directory.stat()
        if directory.resolve() != directory or attrs.st_uid != 0 or attrs.st_mode & 0o022:
            raise RuntimeError(f"Untrusted deployment directory: {directory}")
    if not re.fullmatch(r"[a-f0-9]{64}", expected):
        raise RuntimeError("Expected a reviewed release manifest SHA-256")
    for filename in INPUTS | {"deploy-manifest.json"}:
        attrs = (HERE / filename).lstat()
        if not stat.S_ISREG(attrs.st_mode) or attrs.st_uid != 0 or attrs.st_mode & 0o022:
            raise RuntimeError(f"Untrusted deployment file: {filename}")
    manifest = json.loads(checked_file(HERE / "deploy-manifest.json", expected))
    if set(manifest) != {"files", "inputs"} or set(manifest["inputs"]) != INPUTS:
        raise RuntimeError("Unexpected deployment package")
    expected_paths = {f"{root}/{relative}" for root in TARGET_ROOTS.values() for relative in FILES}
    if set(manifest["files"]) != expected_paths:
        raise RuntimeError("Unexpected target scope")
    for filename, pin in manifest["inputs"].items():
        if not isinstance(pin, str) or not re.fullmatch(r"[a-f0-9]{64}", pin):
            raise RuntimeError("Invalid package SHA-256")
        checked_file(HERE / filename, pin)
    if manifest["inputs"]["deployment_gate.sh"] != GATE_SHA256:
        raise RuntimeError("Unexpected ingress gate version")
    for filename, pin in DEPS.items():
        if manifest["inputs"][filename] != pin:
            raise RuntimeError(f"Unexpected shared deployment helper: {filename}")
    return manifest


def plan_files(manifest):
    patch = load_module(HERE / "patch_backend.py", "pending_patch")
    helper = checked_file(HERE / "payroll_pending.py")
    plan = []
    for root in map(Path, TARGET_ROOTS.values()):
        for relative in FILES:
            path = root / relative
            pins = manifest["files"][str(path)]
            if set(pins) != {"before", "after"} or path.parent.resolve() != path.parent:
                raise RuntimeError(f"Unexpected target metadata: {path}")
            old_hash = pins["before"]
            if relative == NEW and old_hash is None:
                if os.path.lexists(path):
                    # A rolled-back rollout leaves our inactive helper available for the exact same retry.
                    checked_file(path, pins["after"])
                before, after = None, helper
                info = (root / GALLERY).stat()
            else:
                if not isinstance(old_hash, str) or not re.fullmatch(r"[a-f0-9]{64}", old_hash):
                    raise RuntimeError(f"Missing baseline SHA-256 for {path}")
                before, info = checked_file(path, old_hash), path.stat()
                if relative == NEW:
                    after = helper
                elif old_hash == pins["after"]:
                    after = before
                else:
                    after = patch.change(relative, before)
            compile(after, str(path), "exec")
            if sha(after) != pins["after"]:
                raise RuntimeError(f"Candidate SHA-256 differs: {path}")
            plan.append((path, before, after, info))
    return plan


def publish_new(path, content, info):
    descriptor, name = tempfile.mkstemp(prefix=".payroll-pending-", dir=path.parent)
    staged = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.chown(staged, info.st_uid, info.st_gid)
        os.chmod(staged, stat.S_IMODE(info.st_mode))
        os.link(staged, path, follow_symlinks=False)
    finally:
        staged.unlink(missing_ok=True)


def health():
    for service in ("energetica-channel-bridge.service", "energetica-whatsapp.service"):
        subprocess.run(["systemctl", "is-active", "--quiet", service], check=True, timeout=4)
    for port in (8765, 8080):
        with urlopen(f"http://127.0.0.1:{port}/health", timeout=3) as response:
            body = response.read()
            healthy = json.loads(body).get("status") == "ok" if port == 8765 else body.strip() == b"ok"
            if response.status != 200 or not healthy:
                raise RuntimeError(f"Backend health check failed on port {port}")


def restart():
    subprocess.run(["systemctl", "restart", "energetica-channel-bridge.service", "energetica-whatsapp.service"],
                   check=True, timeout=45)
    for attempt in range(15):
        try:
            health()
            return
        except (OSError, RuntimeError, ValueError, subprocess.SubprocessError):
            if attempt == 14:
                raise
            time.sleep(.5)


def import_contract(root):
    """Verify the installed service follows the flat import convention of the bridge."""
    script = ('import sys; sys.path[:0] = sys.argv[1:]; '
              'from workflow import WorkflowEngine; from launch_gallery import LaunchGalleryService; '
              'from payroll_pending import handle, has_unresolved_application, legacy_origin_write')
    command = [sys.executable, "-I", "-B", "-c", script, str(root), str(root / "worker")]
    if root == PRODUCTION:
        command = ["runuser", "-u", "energetica-whatsapp", "--", *command]
    subprocess.run(command, check=True, cwd=root, timeout=15)


def rollout(plan, helper, receipt, backup_root=BACKUPS):
    backup = backup_root / ("payroll-pending-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
    backup.mkdir(mode=0o700)
    for index, (path, before, after, info) in enumerate(plan):
        if before is not None:
            content = checked_file(path, sha(before))
            saved = backup / f"{index}-{path.name}"
            saved.write_bytes(content)
            checked_file(saved, sha(before))
    changed = []
    try:
        for path, before, after, info in plan:
            if before is None:
                if not os.path.lexists(path):
                    publish_new(path, after, info)
            elif after != before:
                helper.install(after, path, info, sha(before))
                changed.append((path, before, after, info))
            checked_file(path, sha(after))
        for root in TARGET_ROOTS.values():
            import_contract(Path(root))
        restart()
        for path, before, after, info in plan:
            checked_file(path, sha(after))
    except BaseException as failure:
        errors = []
        for path, before, after, info in reversed(changed):
            try:
                helper.install(before, path, info, sha(after))
                checked_file(path, sha(before))
            except Exception as rollback_error:
                errors.append(str(rollback_error))
        if changed:
            try:
                restart()
            except Exception as rollback_error:
                errors.append(str(rollback_error))
        receipt.update(status="rollback_incomplete" if errors else "rolled_back",
                       backup=str(backup), errors=errors)
        (backup / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        if errors:
            raise RuntimeError(f"Rollback incomplete, see {backup}") from failure
        raise
    receipt.update(status="deployed", backup=str(backup))
    (backup / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--make-package", nargs=2, type=Path, metavar=("BASELINES", "OUTPUT"))
    mode.add_argument("--check", metavar="MANIFEST_SHA256")
    mode.add_argument("--deploy", metavar="MANIFEST_SHA256")
    args = parser.parse_args()
    if args.make_package:
        baselines, output = args.make_package
        print(build_package(baselines.resolve(), output.resolve()))
        return
    if args.deploy and os.getenv("PAYROLL_PENDING_DEPLOY_GATE") != str(os.getppid()):
        raise RuntimeError("Apply using deploy.sh so the active bridge requests can drain")
    manifest = validate_stage(args.check or args.deploy)
    helper = load_module(HERE / "deploy_context.py", "shared_payroll_deploy")
    with helper.deployment_locks(LOCKS):
        plan = plan_files(manifest)
        health()
        receipt = {"status": "checked", "health": "ok", "files": manifest["files"]}
        if args.deploy:
            rollout(plan, helper, receipt)
        print(json.dumps(receipt))


if __name__ == "__main__":
    main()
