# Verification

Synthetic data only; no real provision was settled for testing.

- TDD observed missing batch review/edit behavior on the fresh baseline.
- Real grouped engine tests cover table rows/totals, pending vs paid, selection,
  submit, individual draft edits, precision, invalid amounts, legacy drafts,
  large groups, blank-field review, final synthetic commit, product persistence,
  concurrency refusal, lost-response retry, one-order conversion and scoped
  channel metadata. External SharePoint IO is served from an in-memory boundary.
- Installer tests: 9 passed (scope/hash/assembly/drift/check-only/rollback).
- Renderer tests: 6 passed; real-browser matrix: 12 width/sample combinations
  passed at 320, 390, 1024 and 1365 pixels, including long text and missing values.
- Fictitious preview visually checked in the shared real chat view; no financial
  submission is used as a visual test.

Historical backend tests are archived separately from the current production
source. The first unchanged-baseline grouped run had 11 passes and 12 failures
because its old synthetic connector lacks the REST boundary required by the
newer attachment coordinator. The initial broad snapshot collection also lacks
the deployment/webhook test-only modules. Broader baseline/candidate comparison
and final platform/release evidence are recorded before release; these historical
fixture limitations are not represented as a passing complete backend suite.

The broad historical suites were interrupted after about seven minutes to avoid
unrelated broad test work competing on the small production VM. Only
the task-owned test processes were stopped. The payment-settlement historical
subset is compared separately; compression is not changed by this patch.

Completed historical `test_workflow.py -k payment_settlement` comparison:
baseline and candidate both had 2 passes and the same 15 failing test names
(541 deselected). These archived tests still expect the older individual
selection contract. No new failure was introduced in that completed subset.
This is distinct from the current real-engine batch-review tests.

One independent whole-branch review found two important issues. Four regressions
reproduced the failures before fixes: scientific-notation JSON numbers at commit
and retry, persisted line-picker resume and cancelled exit. Accepted draft amounts
now use canonical decimal strings before advancing (original snapshots remain
immutable), and choose-phase resume explicitly restores the provision picker.
All five selected cases, including the existing foreign-line check, passed after
the fixes. The complete expanded backend suite then passed: 29 tests.

Final local platform verification on this mobile tree:

- Full mobile suite: 7,402 tests, 7,399 passed, 0 failed, 3 conditional skips.
  Skips: external WebKit harness not configured and two older browser checks
  whose Chrome discovery does not resolve the Windows installation. The new
  provision-review browser matrix ran all 12 combinations, without a skip.
- Native web bundle and PWA bundle both built successfully. Existing chunk-size
  and mixed dynamic/static-import warnings remain non-fatal.
- Signature gesture guard: all 14 blocks intact. iOS project verification passed.
- Exact VM installer check-only passed against production and mirror with the
  final four candidate hashes and healthy services. No runtime rollout yet.
- Tracked-source secrets check passed after staging every new mobile file.

The independent reviewer reran the six renderer tests and checked exact diff,
source/archive hashes and public/private scope. Its two Important findings were
fixed with observed RED/GREEN regressions; no Critical finding remained.

Task-only dependencies, source copies, caches and lock directories isolate the
test runner from production. Production dependencies and records are untouched.
