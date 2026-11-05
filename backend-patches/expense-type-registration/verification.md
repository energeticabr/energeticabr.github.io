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

Publication receipt is added only after the guarded rollout and installed-module
verification finish. This backend-only change serves Android, iOS and Windows/web
through their existing channel; no new mobile binary is required.
