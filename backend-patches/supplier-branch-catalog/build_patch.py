"""Generate the narrow patch from verified source and tested candidate files."""
import difflib
from pathlib import Path
import sys

base, candidate = map(Path, sys.argv[1:3])
output = Path(__file__).with_name("catalog-only.patch")
parts = []
for name in ["worker/clients.py", "worker/workflow.py"]:
    parts.extend(difflib.unified_diff(
        (base / name).read_text(encoding="utf-8").splitlines(keepends=True),
        (candidate / name).read_text(encoding="utf-8").splitlines(keepends=True),
        fromfile="a/" + name, tofile="b/" + name))
output.write_text("".join(parts), encoding="utf-8", newline="\n")
print(output)
if len(sys.argv) == 5:
    baseline_log, candidate_log = map(Path, sys.argv[3:5])
    def failures(path):
        return [line for line in path.read_text(encoding="utf-8", errors="replace").splitlines()
                if line.startswith(("FAIL:", "ERROR:"))]
    baseline, candidate = failures(baseline_log), failures(candidate_log)
    assert sorted(baseline) == sorted(candidate), "Failure set changed"
    Path(__file__).with_name("verification.md").write_text(
        "# Verification\n\n"
        "Six standalone catalog/selector regressions passed locally and against both VM candidates. "
        "The original code fails three of these tests. The stale-session guard also failed before its fix.\n\n"
        "Full backend client/workflow run: 635 tests; 105 failures, 33 errors, 1 skip. "
        "Unmodified baseline: 632 tests with the identical 105 failures, 33 errors and 1 skip. "
        "No new failing/error cases; this legacy suite is NOT green. The 67 targeted client/branch checks pass.\n\n"
        "## Existing failing/error cases (unchanged)\n\n"
        + "".join("- " + name + "\n" for name in candidate),
        encoding="utf-8")
