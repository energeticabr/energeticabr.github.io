"""Use the pinned rollout runner for the shared settlement module."""
import hashlib
import importlib.util
from pathlib import Path


RUNNER = Path("/var/lib/energetica-deploy/launch-order-cleanup-20261111/deploy_runner.py")
RUNNER_HASH = "92b17e8d28a5bfdfabdf99ca6245ac6a75c4b17e85b083e3a8bcb4656c1e8720"


def main():
    if hashlib.sha256(RUNNER.read_bytes()).hexdigest() != RUNNER_HASH:
        raise RuntimeError("Unexpected shared deployment runner")
    spec = importlib.util.spec_from_file_location("deploy_runner", RUNNER)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    runner.PACKAGE = Path(__file__).resolve().parent
    runner.RELATIVES = ("worker/provision_description_settlement.py",)
    runner.INPUTS = {"deploy.py", "deploy.sh", "patch_backend.py"}
    runner.main()


if __name__ == "__main__":
    main()
