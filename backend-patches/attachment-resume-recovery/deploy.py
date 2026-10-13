"""Bounded two-source installer; dry-run is the default, with no SSH behavior."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import time
from urllib.request import urlopen
import uuid

from patch_bridge import patch_bridge


LIVE = Path("/opt/energetica-whatsapp")
MIRROR = Path("/home/opc/energetica-build")


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def checked_source(target, expected_hash):
    if target.is_symlink() or target.parent.resolve() != target.parent or not target.is_file():
        raise RuntimeError("Unexpected bridge target or path alias")
    content = target.read_bytes()
    if hashlib.sha256(content).hexdigest() != expected_hash:
        raise RuntimeError("Bridge changed; refusing deployment.")
    return content


def atomic_install(content, target, *, mode, uid, gid, expected_hash):
    """Stage in the target directory, preserve metadata, then CAS and replace."""
    checked_source(target, expected_hash)
    descriptor, filename = tempfile.mkstemp(prefix=".attachment-recovery-", dir=str(target.parent))
    staged = Path(filename)
    try:
        with os.fdopen(descriptor, "wb") as destination:
            destination.write(content)
            destination.flush()
            os.fsync(destination.fileno())
        if hasattr(os, "chown"):
            os.chown(staged, uid, gid)
        elif (uid, gid) != (staged.stat().st_uid, staged.stat().st_gid):
            raise RuntimeError("Cannot preserve source ownership on this platform")
        # chown can clear special mode bits, so restore the mode after ownership.
        os.chmod(staged, mode)
        checked_source(target, expected_hash)
        os.replace(staged, target)
        if hasattr(os, "O_DIRECTORY"):
            directory_fd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
    finally:
        staged.unlink(missing_ok=True)


def health(*, attempts=20, delay=0.5):
    for attempt in range(attempts):
        try:
            with urlopen("http://127.0.0.1:8080/health", timeout=1) as response:
                if response.status == 200:
                    return True
        except (OSError, ValueError):
            pass
        if attempt + 1 < attempts:
            time.sleep(delay)
    return False


class SystemRunner:
    def restart(self):
        subprocess.run(["systemctl", "restart", "energetica-whatsapp"], check=True)

    def wait_health(self):
        return health()


def workflow_snapshot(roots):
    # Include absent paths so a concurrent configuration creation also aborts.
    paths = [root / relative for root in roots
             for relative in ("worker/workflow_config.json", "workflow_config.json")]
    return {path: digest(path) if path.exists() else None for path in paths}


def check_workflows(expected):
    for path, before in expected.items():
        current = digest(path) if path.exists() else None
        if current != before:
            raise RuntimeError("Workflow configuration changed; aborting.")


def write_receipt(backup, result):
    (backup / "receipt.json").write_bytes((json.dumps(result, indent=2) + "\n").encode("utf-8"))


def deploy_patch(*, expected_live_hash, expected_mirror_hash, stage,
                 live=LIVE, mirror=MIRROR, apply=False, runner=None):
    expected = (expected_live_hash, expected_mirror_hash)
    if any(not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value) for value in expected):
        raise ValueError("Both expected source hashes must be lowercase SHA-256 values")
    roots = tuple(Path(root).absolute() for root in (live, mirror))
    if roots[0].resolve() == roots[1].resolve():
        raise ValueError("Live and mirror must be distinct roots")
    targets = [root / "channel_bridge.py" for root in roots]
    original, attributes, candidate = {}, {}, {}
    for target, before in zip(targets, expected):
        original[target] = checked_source(target, before)
        attributes[target] = target.stat()
        content = patch_bridge(original[target].decode("utf-8")).encode("utf-8")
        compile(content, str(target), "exec")
        candidate[target] = content
    workflows = workflow_snapshot(roots)
    after_hashes = {target: hashlib.sha256(content).hexdigest() for target, content in candidate.items()}
    result = {"dryRun": not apply, "sourceCasVerified": True, "workflowConfigPreserved": True,
              "codeHashes": {str(target): value for target, value in after_hashes.items()}}
    if not apply:
        return result

    stage = Path(stage).resolve()
    if any(stage.is_relative_to(root.resolve()) for root in roots):
        raise ValueError("Backup stage must be outside both source roots")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = stage / "backups" / f"attachment-resume-{stamp}-{uuid.uuid4().hex[:8]}"
    backup.mkdir(parents=True, mode=0o700, exist_ok=False)
    saved = {}
    for name, target, before in zip(("live", "mirror"), targets, expected):
        checked_source(target, before)
        saved[target] = backup / f"{name}-channel_bridge.py"
        shutil.copy2(target, saved[target])
        if digest(saved[target]) != before:
            raise RuntimeError("Backup hash mismatch; refusing installation.")
    # Revalidate both sources together before the first installation.
    for target, before in zip(targets, expected):
        checked_source(target, before)
    check_workflows(workflows)

    runner = runner if runner is not None else SystemRunner()
    attempted = []
    try:
        for target, before in zip(targets, expected):
            checked_source(target, before)
            attempted.append((target, before))
            info = attributes[target]
            atomic_install(candidate[target], target, mode=stat.S_IMODE(info.st_mode),
                           uid=info.st_uid, gid=info.st_gid, expected_hash=before)
            if digest(target) != after_hashes[target]:
                raise RuntimeError("Installed source hash mismatch")
        check_workflows(workflows)
        runner.restart()
        if not runner.wait_health():
            raise RuntimeError("Service health failed; expected HTTP 200.")
        for target in targets:
            if digest(target) != after_hashes[target]:
                raise RuntimeError("Bridge changed after restart")
        check_workflows(workflows)
        result.update({"status": "deployed", "serviceHealth": True, "backup": str(backup)})
        write_receipt(backup, result)
        return result
    except Exception as failure:
        errors = []
        for target, before in reversed(attempted):
            try:
                current = digest(target)
                if current == before:
                    continue
                if current != after_hashes[target]:
                    raise RuntimeError("Concurrent source change preserved: " + str(target))
                restored = saved[target].read_bytes()
                if hashlib.sha256(restored).hexdigest() != before:
                    raise RuntimeError("Rollback backup hash mismatch")
                info = attributes[target]
                atomic_install(restored, target, mode=stat.S_IMODE(info.st_mode),
                               uid=info.st_uid, gid=info.st_gid, expected_hash=after_hashes[target])
                if digest(target) != before:
                    raise RuntimeError("Restored source hash mismatch")
            except Exception as error:
                errors.append(str(error))
        if attempted:
            try:
                runner.restart()
                if not runner.wait_health():
                    raise RuntimeError("Restored service health failed; expected HTTP 200.")
            except Exception as error:
                errors.append(str(error))
        receipt = {"status": "rollback_incomplete" if errors else "rolled_back",
                   "failure": str(failure), "errors": errors, "backup": str(backup)}
        try:
            write_receipt(backup, receipt)
        except OSError as error:
            errors.append("Could not save rollback receipt: " + str(error))
        if errors:
            raise RuntimeError("Rollback incomplete: " + "; ".join(errors)) from failure
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-live-hash", required=True)
    parser.add_argument("--expected-mirror-hash", required=True)
    parser.add_argument("--stage", required=True, type=Path)
    parser.add_argument("--live", default=LIVE, type=Path)
    parser.add_argument("--mirror", default=MIRROR, type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(json.dumps(deploy_patch(expected_live_hash=args.expected_live_hash,
        expected_mirror_hash=args.expected_mirror_hash, stage=args.stage,
        live=args.live, mirror=args.mirror, apply=args.apply)))


if __name__ == "__main__":
    main()
