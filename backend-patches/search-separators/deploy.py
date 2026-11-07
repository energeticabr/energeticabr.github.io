"""Use the existing rollback installer for the search-only worker modules."""
from pathlib import Path
import hashlib
import importlib.util
import json
import subprocess
import sys
from urllib.request import urlopen


ROOT = Path("/opt/energetica-whatsapp")
STAGE = Path(__file__).resolve().parent
FILES = ("worker/logic.py", "worker/launch_gallery.py", "worker/workflow.py")
RUNNER = "shared-deploy.py"
RUNNER_SHA = "01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2"
SERVICES = ("energetica-whatsapp.service", "energetica-channel-bridge.service")


def health(runner_health):
    subprocess.run(["systemctl", "is-active", "--quiet", *SERVICES], check=True)
    with urlopen("http://127.0.0.1:8080/health", timeout=5) as response:
        if response.status != 200:
            raise RuntimeError("WhatsApp worker health failed")
    return runner_health()


def main(mode, manifest_sha):
    if mode not in {"--check", "--deploy"}:
        raise ValueError("Invalid deployment mode")
    manifest_bytes = (STAGE / "manifest.json").read_bytes()
    if hashlib.sha256(manifest_bytes).hexdigest() != manifest_sha:
        raise ValueError("Unexpected deployment manifest")
    manifest = json.loads(manifest_bytes)
    if set(manifest) != set(FILES):
        raise ValueError("Unexpected deployment scope")
    runner_path = STAGE / RUNNER
    if hashlib.sha256(runner_path.read_bytes()).hexdigest() != RUNNER_SHA:
        raise ValueError("Unexpected installer")
    spec = importlib.util.spec_from_file_location("search_deploy_runner", runner_path)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    runner.ROOTS = (ROOT,)
    runner.STAGE = STAGE / "candidate"
    runner.FILES = FILES
    runner.BACKUPS /= "search-separators"
    runner_health = runner.health
    runner.health = lambda: health(runner_health)
    runner.restart = lambda: subprocess.run(["systemctl", "restart", *SERVICES], check=True, timeout=45)
    print(json.dumps(runner.execute(manifest, check_only=mode == "--check")))


if __name__ == "__main__":
    main(*sys.argv[1:])
