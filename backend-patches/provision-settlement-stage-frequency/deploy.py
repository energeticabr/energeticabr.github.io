"""Hash-pinned install of settlement stage ordering; the build mirror is read-only."""

from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import signal
import stat
import sys
import time
import types


ROOT = Path("/opt/energetica-whatsapp")
MIRROR = Path("/home/opc/energetica-build")
STAGE = Path(os.environ.get(
    "PROVISION_STAGE_FREQUENCY_STAGE",
    "/home/opc/provision-settlement-stage-frequency-20261124-r2/release",
))
BACKUPS = Path("/var/backups/energetica-whatsapp")
LOCK = Path("/tmp/energetica-whatsapp-deploy.lock")
FILES = ("worker/workflow.py",)
BEFORE = {"worker/workflow.py": "131b5f5956c0d2b4bac60a7de380e81a3b8700ea8eeae8033962f4f709b9caef"}
MIRROR_PINS = {"worker/workflow.py": "a77df64274c20e1ae175d074ae7b96cb51cf6b5e7ba4ca0c917783d94a16dbc3"}
SHARED_RUNNER_SHA = "01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2"
INPUTS = {"patch_backend.py", "deploy.py", "deploy.sh", "deployment_gate.sh", "shared-deploy.py", "source.patch"}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def directory(path):
    if path.resolve() != path.absolute() or (path.exists() and not path.is_dir()):
        raise RuntimeError("Unexpected directory alias: " + str(path))


def plain(path):
    if path.is_symlink() or path.resolve() != path.absolute() or not path.is_file() or path.stat().st_nlink != 1:
        raise RuntimeError("Unexpected file alias: " + str(path))


def pinned(path, expected, message):
    plain(path)
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise RuntimeError(message + ": " + str(path))
    return data


def mirror_guard():
    for relative, expected in MIRROR_PINS.items():
        pinned(MIRROR / relative, expected, "Read-only mirror source drift")


def load(name, path, expected_sha):
    module = types.ModuleType(name)
    module.__file__ = str(path)
    data = pinned(path, expected_sha, "Package input mismatch")
    exec(compile(data, str(path), "exec"), module.__dict__)
    return module


def checked_manifest(expected_sha):
    manifest_path = STAGE / "deploy-manifest.json"
    manifest = json.loads(pinned(manifest_path, expected_sha, "Manifest hash mismatch"))
    if set(manifest) != {"files", "mirror", "inputs"} or set(manifest["files"]) != set(FILES):
        raise RuntimeError("Unexpected deployment scope")
    for relative, pins in manifest["files"].items():
        if (set(pins) != {"before", "after"} or pins["before"] != BEFORE[relative]
                or not isinstance(pins["after"], str) or not re.fullmatch(r"[0-9a-f]{64}", pins["after"])):
            raise RuntimeError("Unexpected source pins")
    if manifest["mirror"] != MIRROR_PINS:
        raise RuntimeError("Unexpected read-only mirror pins")
    if set(manifest["inputs"]) != INPUTS:
        raise RuntimeError("Unexpected package inputs")
    for relative, expected in manifest["inputs"].items():
        pinned(STAGE / relative, expected, "Package input mismatch")
    if manifest["inputs"]["shared-deploy.py"] != SHARED_RUNNER_SHA:
        raise RuntimeError("Shared runner drift")
    mirror_guard()
    return manifest


def validate_source(relative, data):
    if relative not in FILES:
        raise RuntimeError("Unexpected source scope: " + relative)
    compile(data, relative, "exec")


def assemble(manifest):
    mirror_guard()
    for relative in FILES:
        pinned(ROOT / relative, manifest["files"][relative]["before"], "Production source drift")
    patcher = load("provision_settlement_stage_patcher", STAGE / "patch_backend.py",
                   manifest["inputs"]["patch_backend.py"])
    candidate = {relative: patcher.patch(relative, pinned(
        ROOT / relative, manifest["files"][relative]["before"], "Production source drift"))
        for relative in FILES}
    for relative, data in candidate.items():
        if hashlib.sha256(data).hexdigest() != manifest["files"][relative]["after"]:
            raise RuntimeError("Candidate hash mismatch: " + relative)
        validate_source(relative, data)
    return candidate


def materialize_candidate(manifest, candidate):
    root = STAGE / "candidate"
    target = root / "worker/workflow.py"
    for folder in (STAGE, root, target.parent):
        directory(folder)
        folder.mkdir(parents=True, exist_ok=True)
        directory(folder)
    expected = manifest["files"]["worker/workflow.py"]["after"]
    if target.exists() or target.is_symlink():
        pinned(target, expected, "Existing candidate differs")
    else:
        with target.open("xb") as stream:
            stream.write(candidate["worker/workflow.py"])
        pinned(target, expected, "Candidate materialization mismatch")
    return root


@contextmanager
def deployment_lock(*, check_only=False):
    flags = (os.O_RDONLY if check_only else os.O_RDWR) | os.O_NOFOLLOW | os.O_NONBLOCK
    try:
        fd = os.open(LOCK, flags)
    except FileNotFoundError:
        if check_only:
            raise RuntimeError("Shared deployment lock absent; read-only check cannot create it")
        fd = os.open(LOCK, flags | os.O_CREAT | os.O_EXCL, 0o644)
    with os.fdopen(fd, "r" if check_only else "r+") as lock:
        info = os.fstat(lock.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                or info.st_uid not in {0, pwd.getpwnam("opc").pw_uid}):
            raise RuntimeError("Unexpected deployment lock")
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def interrupted(signum, frame):
    raise RuntimeError("Deployment interrupted by signal " + str(signum))


def wait_health(runner):
    """Allow the channel bridge up to 60 seconds to finish its cold start."""
    deadline = time.monotonic() + 60
    while True:
        try:
            return runner.health()
        except Exception:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise
            time.sleep(min(1, remaining))


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in {"--check", "--deploy"}:
        raise SystemExit("Usage: deploy.py --check|--deploy reviewed_manifest_sha256")
    if Path(__file__).absolute().parent != STAGE or Path(__file__).resolve().parent != STAGE:
        raise RuntimeError("Unexpected release directory or alias")
    stage_info = STAGE.lstat()
    if (not stat.S_ISDIR(stage_info.st_mode) or stage_info.st_uid != 0
            or stat.S_IMODE(stage_info.st_mode) & 0o077):
        raise RuntimeError("Release snapshot must be private and root-owned")
    check_only = sys.argv[1] == "--check"
    if not check_only:
        if os.geteuid() != 0 or os.environ.get("PROVISION_STAGE_FREQUENCY_GATE") != str(os.getppid()):
            raise RuntimeError("Use deploy.sh to gate and drain bridge ingress")
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(signum, interrupted)
    with deployment_lock(check_only=check_only):
        manifest = checked_manifest(sys.argv[2])
        candidate = assemble(manifest)
        candidate_root = materialize_candidate(manifest, candidate)
        runner = load("provision_settlement_shared_runner", STAGE / "shared-deploy.py", SHARED_RUNNER_SHA)
        runner.ROOTS = (ROOT,)
        runner.STAGE = candidate_root
        runner.FILES = FILES
        runner.BACKUPS = BACKUPS / "provision-settlement-stage-frequency"
        runner.wait_health = lambda: wait_health(runner)
        result = runner.execute(manifest["files"], check_only=check_only)
        mirror_guard()
        print(json.dumps(result))


if __name__ == "__main__":
    main()
