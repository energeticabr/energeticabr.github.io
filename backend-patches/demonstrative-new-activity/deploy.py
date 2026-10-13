"""Use the existing exact-file, locked, backed-up, rollback-capable deployer."""
import hashlib
import importlib.util
from pathlib import Path

RUNNER_SHA = "01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2"
LOCAL_RUNNER = Path(__file__).resolve().parent.parent / "launch-payroll-per-payment" / "deploy.py"


def load_runner(path):
    if hashlib.sha256(path.read_bytes()).hexdigest() != RUNNER_SHA:
        raise RuntimeError("Shared deployer hash mismatch")
    spec = importlib.util.spec_from_file_location("demonstrative_activity_shared_deploy", path)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    runner.STAGE = Path(__file__).resolve().parent / "candidate"
    return runner


if __name__ == "__main__":
    load_runner(Path(__file__).with_name("shared_deploy_runner.py")).main()
