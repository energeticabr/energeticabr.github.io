"""Fresh exact-file rollout using the existing hash-pinned gallery safeguards."""
import hashlib
import importlib.util
from pathlib import Path


GALLERY_RUNNER_SHA256 = "79d2e31cea242e7256124e89a0efe447e51548f24277d6b9c2beac9c62011248"
PACKAGED_RUNNER = Path(__file__).with_name("gallery_deploy_runner.py")
RUNNER_PATH = (PACKAGED_RUNNER if PACKAGED_RUNNER.exists() else
               Path(__file__).resolve().parents[1] / "launch-gallery-quick-search/deploy.py")
if hashlib.sha256(RUNNER_PATH.read_bytes()).hexdigest() != GALLERY_RUNNER_SHA256:
    raise RuntimeError("Gallery deployment runner hash mismatch")
spec = importlib.util.spec_from_file_location("gallery_filter_options_rollout", RUNNER_PATH)
gallery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gallery)
gallery.runner.STAGE = Path("/home/opc/gallery-filter-options-20261009/candidate")


def main():
    gallery.main()


if __name__ == "__main__":
    main()
