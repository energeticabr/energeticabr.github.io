"""Install the authenticated manual payroll endpoint and shared writer together."""

import fcntl
import importlib.util
import json
import os
from pathlib import Path
import sys


def main():
    if len(sys.argv) != 4 or sys.argv[1] not in {"--check", "--deploy"}:
        raise SystemExit("Usage: deploy.py --check|--deploy STAGE EXISTING_RUNNER")
    stage = Path(sys.argv[2]).resolve(strict=True)
    spec = importlib.util.spec_from_file_location("existing_payroll_deploy", Path(sys.argv[3]).resolve(strict=True))
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    runner.TARGETS = {
        f"{variant}-{filename.stem}": filename
        for variant, workflow in runner.TARGETS.items()
        for filename in (workflow.parent.parent / "channel_bridge.py", workflow.with_name("launch_gallery.py"), workflow)
    }
    fd = os.open(runner.LOCK, os.O_NOFOLLOW | os.O_RDWR | os.O_CREAT, 0o644)
    with os.fdopen(fd, "r+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(runner.deploy(stage, sys.argv[1] == "--check")))


if __name__ == "__main__":
    main()
