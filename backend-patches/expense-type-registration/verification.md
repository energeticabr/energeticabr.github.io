# Verification — 2026-11-04

- Exact live baseline downloaded before patching; candidate reproduces from
  `patch_backend.py`. Only two runtime modules change; config stays unchanged.
- 15 behavioral tests pass against the complete current runtime, including the
  real provision mixin and synthetic storage/catalog adapters. Both registration
  entry and confirmed commit execute the existing workflow implementation.
- Baseline RED: missing action/order/child route. Additional RED cases found by
  independent review: empty source auto-selected the action as field data;
  repeated raw create action became a type name. Both have passing regressions.
- 30 installer tests pass locally (5 POSIX/shell cases skipped on Windows), now
  exercising the actual two-module scope and failure before the second install.
- Independent read-only review ran all 45 tests and found no remaining Important
  or Critical issues after the fixes.
- Real server poll serialization plus unchanged conversation store/chat renderer:
  9 browser states pass at 320/390/1200 px, including filter, no-match fallback,
  long text wrapping, first actionable create button and no horizontal overflow.
- Signature guard: all 14 protected blocks intact. No app bundle changes.
- Complete historical `test_workflow` suite compared on baseline and candidate:
  both 571 tests, 376 failures, 38 errors, 1 skipped. Exact failure/error identity
  sets match; this legacy suite is not reported as green. Private full logs and
  identity inventories remain in this task's `private/full-{baseline,candidate}`.
- Release manifest SHA256:
  `5b782b9bdaafa94be43773383b7f3b3e53b45cb52fae49270248aabb23c3fb60`.

## Published

- PR #760 merged as `ce23ade193ab764b8646b65f4df5198de946ce2b`.
- Installer CI succeeded on PR run `41954930719` and main run `41954989990`.
- Linux server QA: 15 behavioral tests and all 38 installer tests passed.
- Guarded deployment completed at `2026-11-05T02:24:39Z` (2026-11-04 local),
  with bridge health `ok` and verified installed hashes. Backup:
  `/var/backups/energetica-whatsapp/expense-type-registration-20261105T022439420452Z`.
- Post-deployment: all 15 behavior tests passed again with imports explicitly
  pinned to `/opt/energetica-whatsapp/worker`, using only synthetic adapters.
- Runtime config SHA256 remained
  `e72f874a925a2155906009dddb549131ceeb91d26071d3977a44330b22a6b4a3`;
  both mirror module hashes stayed unchanged.
- `publication.json` records the exact installed revisions. Android, iOS and
  Windows/web receive the behavior through the existing shared channel;
  no new binary or reinstall is required. Visual QA used the current renderer
  with synthetic server polls; no authenticated production form was submitted.
