"""Archive only the reviewed workflow diff, with exact hashes and regression evidence."""
import difflib
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import sys

baseline, candidate, baseline_log, candidate_log = map(Path, sys.argv[1:5])
output = Path(__file__).parent
relative = "worker/workflow.py"
before = (baseline / relative).read_bytes()
after = (candidate / relative).read_bytes()
cases = lambda path: sorted(line for line in path.read_text(encoding="utf-8", errors="replace").splitlines()
                            if line.startswith(("FAIL:", "ERROR:")))
baseline_cases, candidate_cases = Counter(cases(baseline_log)), Counter(cases(candidate_log))
new_cases, removed_cases = candidate_cases - baseline_cases, baseline_cases - candidate_cases
infra_note = ""
if new_cases or removed_cases:
    # Report (never silently remove) the specifically diagnosed Windows socket
    # failure, and require three successful exact-case reruns on BOTH sources.
    infra_case = ("ERROR: test_completion_menu_requires_microsoft_auth_and_allowed_origin "
                  "(test_portal_attachments.PortalAttachmentTests.test_completion_menu_requires_microsoft_auth_and_allowed_origin)")
    assert not removed_cases and new_cases == Counter({infra_case: 1}), "New backend failing/error cases"
    text = candidate_log.read_text(encoding="utf-8", errors="replace")
    block = text.split(infra_case + "\n", 1)[1].split("======================================================================", 1)[0]
    assert "ConnectionAbortedError: [WinError 10053]" in block, "Unverified infrastructure exception"
    assert len(sys.argv) == 7, "Both exact-case rerun logs are required"
    for retry in map(Path, sys.argv[5:7]):
        content = retry.read_text(encoding="utf-8", errors="replace")
        assert re.search(r"Ran 3 tests in", content) and content.rstrip().endswith("OK"), "Exact-case reruns failed"
        assert content.count("test_completion_menu_requires_microsoft_auth_and_allowed_origin (") == 3
    infra_note = ("\nOne additional case was a Windows HTTP socket abort (WinError 10053), "
                  "not a payroll assertion. Its exact case passed all three fresh retries on "
                  "both baseline and candidate. It remains included in the candidate failure list below.\n")
patch = "".join(difflib.unified_diff(before.decode("utf-8").splitlines(keepends=True),
                                  after.decode("utf-8").splitlines(keepends=True),
                                  fromfile="a/" + relative, tofile="b/" + relative, n=0))
assert patch, "Empty product patch"
(output / "workflow.patch").write_text(patch, encoding="utf-8", newline="\n")
manifest = {relative: {"before": hashlib.sha256(before).hexdigest(),
                       "after": hashlib.sha256(after).hexdigest()}}
(output / "deploy-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
summaries = []
counts = []
for label, path in (("Baseline", baseline_log), ("Candidate", candidate_log)):
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    total = next(line for line in reversed(lines) if re.match(r"Ran \d+ tests", line))
    counts.append(int(re.match(r"Ran (\d+) tests", total).group(1)))
    summaries.append(label + ": " + total)
    summaries.append(next(line for line in reversed(lines) if line.startswith("FAILED (")))
report = ("# Backend regression comparison\n\n" + "\n".join(summaries)
          + "\n\nThe inherited full backend suite is NOT green. The inherited failing/error case identities remain ("
          + str(sum(baseline_cases.values())) + "). The candidate adds "
          + str(counts[1] - counts[0]) + " passing per-payment regressions.\n\n"
          + infra_note
          + "\n".join("- " + case for case in cases(candidate_log)) + "\n")
(output / "regression-comparison.md").write_text(report, encoding="utf-8", newline="\n")
print(json.dumps({"manifest": manifest, "patch_lines": len(patch.splitlines()),
                  "inherited_failed_cases": sum(baseline_cases.values()), "additional_socket_error": bool(infra_note)}))
