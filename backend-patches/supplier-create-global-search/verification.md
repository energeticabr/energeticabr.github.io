# Verification — supplier registration and global grouping search

## Scope

The multiple-launch grouping supplier picker searches the complete supplier catalog,
including SharePoint continuation pages, and always offers the existing standard
supplier-registration wizard. Recurring expenses offer the same wizard. Completion
returns to the exact origin; grouping does not replace individual line suppliers.
Parent attachments and collected answers survive the nested wizard. Stale parent
pagination, choices and filter commands cannot populate the supplier name.

The mobile change accepts full-name remote grouping queries and does not incorrectly
filter server results against only their displayed label. Other search behavior and
the legacy local-only fallback remain unchanged.

## Executed checks (2026-10-20)

- Mobile project `pnpm test`: 6,684 tests; 6,682 passed, zero failures, two platform skips.
- Root `node --test --test-concurrency=2 tests/*.test.mjs`: 1,130 tests;
  1,124 passed, zero failures, six platform skips.
- `pnpm build`, `pnpm build:pwa`, `pnpm ios:verify`, `pnpm secrets:verify`: passed.
- Signature guard: all 14 protected blocks intact, before and after changes.
- Backend package `pytest`: 30 passed (14 real-engine contract tests and
  16 installer/package/rollback checks), using in-memory storage/catalogs only.
- Configuration schema validation: passed.
- The initial seven contract tests failed six feature assertions against the
  unchanged production snapshot before implementation. Frontend four new tests
  likewise failed before their fix. Review reproduced stale pagination, then the
  added eight stale-control subcases failed before the defensive fix and passed after it.

## Legacy fixture limitation (not represented as green)

The locally available legacy `tests/test_workflow.py` is older than the production
snapshot and is not present in the live deployment. Both baseline and final candidate
ran the same 571 tests: 373 failures, 31 errors and one skip. The complete sets of
404 failing/error test names were compared; **no new failing/error name** was introduced.
The legacy suite is not claimed to pass. Representative pre-existing failures include
`test_all_selection_fields_offer_blank_and_blank_is_not_persisted`,
`test_attachment_at_confirmation_compressed_queue_preserves_every_file`,
`test_attachment_at_confirmation_refreshes_summary_without_submitting`,
`test_attachment_at_confirmation_resumes_after_compression_selection`, and
`test_attendance_batch_resumes_action_after_reconnect`.
Full named baseline and candidate diagnostics remain in the private task QA folder;
they are excluded from the public patch because they can contain unrelated workflow data.

## Publication and live validation

The reviewed manifest pins the three changed source files independently for the live
VM and mirror, with a recoverable backup and post-restart health verification.
No supplier, expense, order, provision or launch record is created by deployment.
Live receipts and platform release results are recorded in the pull-request follow-up
after deployment; test results above are not a substitute for those receipts.
