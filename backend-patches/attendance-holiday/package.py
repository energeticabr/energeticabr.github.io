"""Package only the reviewed workflow diff, without runtime data/configuration."""
import argparse
import difflib
import hashlib
import json
from pathlib import Path

BASELINE = "06b4f6999a01e96dc5b53a8fb4739a72daea455b0bbc5ec4be47aafb7ada12d2"


def package(before_path, after_path, output):
    before, after = before_path.read_bytes(), after_path.read_bytes()
    digest = lambda data: hashlib.sha256(data).hexdigest()
    if digest(before) != BASELINE or before == after:
        raise RuntimeError("Unexpected or unchanged workflow source")
    patch = "".join(difflib.unified_diff(
        before.decode("utf-8").splitlines(True), after.decode("utf-8").splitlines(True),
        fromfile="a/worker/workflow.py", tofile="b/worker/workflow.py"))
    output.mkdir(parents=True, exist_ok=True)
    (output / "source.patch").write_bytes(patch.encode("utf-8"))
    manifest = {"worker/workflow.py": {"before": BASELINE, "after": digest(after)}}
    (output / "deploy-manifest.json").write_bytes((json.dumps(manifest, indent=2) + "\n").encode("utf-8"))
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--before", type=Path, required=True)
    parser.add_argument("--after", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(package(args.before, args.after, args.output)))
