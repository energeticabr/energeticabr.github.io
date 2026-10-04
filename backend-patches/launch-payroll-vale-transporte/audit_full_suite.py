"""Compare full legacy suite outcomes, retaining every pre-existing failure by name."""
from pathlib import Path
import sys

baseline, candidate = [Path(p).read_text(encoding='utf-8', errors='replace') for p in sys.argv[1:3]]
def cases(text):
    return sorted(line for line in text.splitlines() if line.startswith(('FAIL:', 'ERROR:')))
assert cases(baseline) == cases(candidate), 'New failing/error cases introduced'
assert 'Ran 2292 tests' in baseline and 'Ran 2292 tests' in candidate
assert 'FAILED (failures=441, errors=132, skipped=3)' in baseline
assert 'FAILED (failures=441, errors=132, skipped=3)' in candidate
report = '# Full legacy backend suite\n\nBaseline and candidate: 2292 checks; 441 failures, 132 errors, 3 skips. Identical failing/error cases, zero new cases. This legacy suite is not green. The five new transport regressions and browser checks pass separately.\n\n' + ''.join('- '+name+'\n' for name in cases(candidate))
Path(__file__).with_name('verification.md').write_text(report, encoding='utf-8', newline='\n')
print('FULL_SUITE_FAILURE_NAMES_UNCHANGED: 441 failures, 132 errors, 3 skips')
