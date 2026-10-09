"""Single-module gallery rollout using the unchanged, hash-pinned shared runner.

Importing this file does not contact the VM or execute a rollout. The CLI is for
the main agent only, after uploading the reviewed bundle to the staged directory.
"""
import hashlib
import importlib.util
from pathlib import Path
import re


RUNNER_SHA256 = "01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2"
PACKAGED_RUNNER = Path(__file__).with_name("shared_deploy_runner.py")
RUNNER_PATH = (PACKAGED_RUNNER if PACKAGED_RUNNER.exists() else
               Path(__file__).resolve().parents[1] / "launch-payroll-per-payment/deploy.py")
if hashlib.sha256(RUNNER_PATH.read_bytes()).hexdigest() != RUNNER_SHA256:
    raise RuntimeError("Shared deployment runner hash mismatch")
spec = importlib.util.spec_from_file_location("gallery_shared_rollout", RUNNER_PATH)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
runner.FILES = ("worker/launch_gallery.py",)
runner.NEW_HELPERS = ()
runner.STAGE = Path("/home/opc/gallery-quick-search-20261009/candidate")
_shared_execute = runner.execute


class _KnownBaselines:
    """Compatibility with the shared runner's single-before-hash comparison.

The digest guard below enforces the exact hash for each target, including the
runner's checks before backups/writes. This is never an unscoped hash allowlist.
"""
    def __init__(self, values):
        self.values = frozenset(values)

    def __eq__(self, value):
        return value in self.values


def execute(manifest, check_only=False):
    if not isinstance(manifest, dict) or set(manifest) != set(runner.FILES):
        raise RuntimeError("Unexpected file manifest")
    roots = {str(root) for root in runner.ROOTS}
    targets, sources, compatible = {}, {}, {}
    for relative in runner.FILES:
        entry = manifest[relative]
        if not isinstance(entry, dict) or set(entry) != {"before", "after"}:
            raise RuntimeError("Invalid hash metadata")
        pins = entry["before"]
        if not isinstance(pins, dict) or set(pins) != roots:
            raise RuntimeError("Invalid target baseline mapping")
        if any(not isinstance(value, str) or not re.fullmatch("[0-9a-f]{64}", value)
               for value in [entry["after"], *pins.values()]):
            raise RuntimeError("Invalid pinned hash")
        candidate = runner.STAGE / relative
        if candidate.is_symlink() or runner.digest(candidate) != entry["after"]:
            raise RuntimeError("Candidate hash mismatch: " + relative)
        for root in runner.ROOTS:
            target = root / relative
            if target.is_symlink() or runner.digest(target) != pins[str(root)]:
                raise RuntimeError("Live source drift: " + str(target))
            targets[target] = pins[str(root)]
            sources[target] = candidate
        compatible[relative] = {"before": _KnownBaselines(pins.values()), "after": entry["after"]}

    original_digest, original_copy = runner.digest, runner.atomic_copy
    installed = set()

    def guarded_digest(path):
        actual = original_digest(path)
        if path in targets and path not in installed and actual != targets[path]:
            raise RuntimeError("Live source drift: " + str(path))
        return actual

    def guarded_copy(source, target, attributes=None):
        if target in sources and source == sources[target]:
            guarded_digest(target)
            installed.add(target)
        return original_copy(source, target, attributes)

    runner.digest, runner.atomic_copy = guarded_digest, guarded_copy
    try:
        # The shared runner owns backups, atomic installation, health checks,
        # service restart and independent restoration of each actual baseline.
        return _shared_execute(compatible, check_only)
    finally:
        runner.digest, runner.atomic_copy = original_digest, original_copy


def main():
    # Retain the shared manifest digest gate, exact roots, deployment lock and CLI.
    runner.execute = execute
    runner.main()


if __name__ == "__main__":
    main()
