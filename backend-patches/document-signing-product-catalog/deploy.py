"""Use the pinned shared rollback-capable deployer for both VM mirrors."""

import hashlib
import importlib.util
from pathlib import Path

RUNNER_SHA256 = "50b7473a603ddacd0f8a25ff6a75b28500851036d187c8b701480371f2ef1f4f"


def main() -> None:
    shared = Path(__file__).with_name("shared_deploy_runner.py")
    if hashlib.sha256(shared.read_bytes()).hexdigest() != RUNNER_SHA256:
        raise RuntimeError("Shared deployer drift")
    spec = importlib.util.spec_from_file_location("receipt_catalog_deploy_runner", shared)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    runner.STAGE = Path(__file__).resolve().parent / "candidate"
    runner.main()


if __name__ == "__main__":
    main()
