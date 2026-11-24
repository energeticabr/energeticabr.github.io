"""Create the public diff and exact hash-pinned release bundle."""

import argparse
import difflib
import hashlib
import json
from pathlib import Path

from patch_backend import patch

FILES = ("worker/workflow.py",)
BEFORE = {"worker/workflow.py": "131b5f5956c0d2b4bac60a7de380e81a3b8700ea8eeae8033962f4f709b9caef"}
MIRROR_PINS = {"worker/workflow.py": "a77df64274c20e1ae175d074ae7b96cb51cf6b5e7ba4ca0c917783d94a16dbc3"}
SHARED_RUNNER_SHA = "01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2"
INPUTS = {"patch_backend.py", "deploy.py", "deployment_gate.sh", "shared-deploy.py", "source.patch"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def package(baseline, candidate, stage):
    folder = Path(__file__).resolve().parent
    diffs, pins = [], {}
    for relative in FILES:
        before = (baseline / relative).read_bytes()
        after = (candidate / relative).read_bytes()
        if digest(before) != BEFORE[relative] or patch(relative, before) != after:
            raise RuntimeError("Source drift or irreproducible candidate: " + relative)
        diffs.append("".join(difflib.unified_diff(
            before.decode().splitlines(keepends=True), after.decode().splitlines(keepends=True),
            fromfile="a/" + relative, tofile="b/" + relative, n=0)))
        pins[relative] = {"before": digest(before), "after": digest(after)}
    (folder / "source.patch").write_text("".join(diffs), encoding="utf-8")
    runner = (folder.parent / "launch-payroll-per-payment/deploy.py").read_bytes().replace(b"\r\n", b"\n")
    if digest(runner) != SHARED_RUNNER_SHA:
        raise RuntimeError("Shared runner source drift")
    contents = {name: runner if name == "shared-deploy.py" else
                (folder / name).read_bytes().replace(b"\r\n", b"\n") for name in INPUTS}
    manifest = {"files": pins, "mirror": MIRROR_PINS,
                "inputs": {name: digest(contents[name]) for name in sorted(contents)}}
    serialized = (json.dumps(manifest, indent=2) + "\n").encode()
    (folder / "deploy-manifest.json").write_bytes(serialized)
    contents["deploy-manifest.json"] = serialized
    stage.mkdir(parents=True, exist_ok=True)
    for name, data in contents.items():
        target = stage / name
        if target.exists() and target.read_bytes() != data:
            raise RuntimeError("Release staging differs; use a fresh directory: " + name)
        target.write_bytes(data)
    print(json.dumps({"manifest": digest(serialized), "files": pins, "stage": str(stage)}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for arg in ("baseline", "candidate", "stage"):
        parser.add_argument("--" + arg, type=Path, required=True)
    args = parser.parse_args()
    package(args.baseline, args.candidate, args.stage)
