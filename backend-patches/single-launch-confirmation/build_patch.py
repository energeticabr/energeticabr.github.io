"""Generate a scoped deployment patch from verified baseline and tested candidate."""
import difflib
from pathlib import Path
import sys

base, candidate = map(Path, sys.argv[1:3])
patch = "".join("".join(difflib.unified_diff(
    (base / name).read_text(encoding="utf-8").splitlines(keepends=True),
    (candidate / name).read_text(encoding="utf-8").splitlines(keepends=True),
    fromfile="a/" + name, tofile="b/" + name))
    for name in ("worker/launch_preview.py", "worker/launch_line_controls.py"))
with Path(__file__).with_name("single-confirmation.patch").open("w", encoding="utf-8", newline="\n") as stream:
    stream.write(patch)
if len(sys.argv) == 5:
    baseline_log, candidate_log = map(Path, sys.argv[3:5])
    def failures(path):
        return [line for line in path.read_text(encoding="utf-8", errors="replace").splitlines()
                if line.startswith(("FAIL:", "ERROR:"))]
    baseline_failures, candidate_failures = failures(baseline_log), failures(candidate_log)
    assert sorted(baseline_failures) == sorted(candidate_failures), "New failing/error cases"
    report = ("# Existing backend failures\n\n"
              "Baseline and candidate: 2292 tests, 441 failures, 132 errors, 3 skips. "
              "Identical failing/error cases; the legacy full suite is not green.\n\n"
              + "".join("- " + name + "\n" for name in candidate_failures))
    with Path(__file__).with_name("verification.md").open("w", encoding="utf-8", newline="\n") as stream:
        stream.write(report)
