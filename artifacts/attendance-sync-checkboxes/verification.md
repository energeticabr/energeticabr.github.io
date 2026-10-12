# Attendance supplier selection and collective confirmation

Baseline backend SHA-256: `3140439d59903753febc9435e6d6c5f370cffdc92717fdf64cbcac54e5805e04`.
Candidate backend SHA-256: `e2f9a39837f19fba31fd8f00b94e100134f2ac69f386807f0f5e150c8a7b581d`.

## Verified before deployment

- Persistent checkboxes support current and already-open legacy selectors. Marking or clearing a supplier neither submits nor removes the row. SUBMETER sends only checked IDs using `supplier_sync_batch:`.
- Fresh server-side validation rejects malformed, unknown, cross-day, unavailable and already-validated participants before replication. The original presence remains a participant.
- Final confirmation contains every participant and all editable fields, including date before supplier. Only SIM submits the chosen presence to all participants; EDITAR/CANCELAR do not submit presence.
- Data and final-status journals retain partial progress, support retries without duplicate writes, preserve previously edited participants across cycles and reconcile concurrent metadata.
- New backend tests reproduced baseline failures before implementation: 17 tests / 30 expected failures / zero errors. Three review findings were reproduced then covered by regression tests.
- Independently verified 45 offline backend tests: 21 new and 24 prior attendance regressions, all passing. The prior replication-return test now correctly excludes both newly validated participants. A replacement conversation never receives the previous operation's journal or retries.
- Production Python 3.9: refreshed final-candidate run passed all 21 new offline tests. All tests use in-memory fixtures; HTTP is blocked. No real HR test submissions.
- Frontend full suite: 5413 tests passing before the final additional table-coverage test; refreshed chat-view suite: 306 tests passing, including a complete 25-row confirmation.
- PWA/native web builds succeeded. Existing chunk/import warnings remain.
- Signature guard: 14 protected gesture blocks intact. Diff whitespace check passed.
- Browser QA verified persistent checked/unchecked rows and a real-engine 3-row / 17-field confirmation at 390x844, using the actual frontend with a local-only event sink.

## Broad historical suite limitation

The same 2142 historical cases are not green on the baseline: 553 failures, 124 errors and 3 skips. Candidate: 553 failures, 125 errors and 3 skips. No added failing case identities; the extra error is the old direct private-bulk fixture `test_other_suppliers_query_uses_real_columns_same_day_and_preserves_source`, which omits the required persisted `state.key` used by the new checkpoint journal. This is not a claim that the historical suite passed.

## Release

Independent final review: no P0-P2 on the final candidate; 21 tests plus 7 independent operation-identity proofs passed. The reviewer verified replacement batch/flow/original/day/stage/index/journal states remain unchanged and cannot replay the old synchronization.

Guarded VM installation, PR merge and per-platform publication receipts are recorded below when verified.
