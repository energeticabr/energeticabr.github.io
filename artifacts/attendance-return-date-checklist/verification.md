# Attendance return: last evaluated day and checkboxes

User requirement: after editing a supplier and applying those changes to other suppliers, return to the last evaluated attendance date, with checkboxes, Select all and Proceed. Do not reopen the global all-date plain-button queue.

## Cause and bounded correction

The confirmation completion path called `_prompt_remaining_attendance`, which queried the global `presenca_pendente_continuacao` selector. Pending individual selection also discarded `DATA FILTRO PRESENÇA` when resetting fields.

The worker now returns to the existing date-scoped `attendance_multi_select` protocol from the actual evaluated record's DATA (not a consultive PDF's requested date). Individual editing retains the selected-day context. Other dates require an explicit date selection; an exhausted day offers the date picker. Source results are checked for the same day and PENDENTE. Session-scoped completed IDs prevent stale SharePoint results reappearing after batch Back. Plain-text name filtering retains the checkbox protocol and day scope.

No mobile frontend, signature gesture block, financial schema, Power Automate flow, or real HR presence was changed for QA.

## Evidence

- Before implementation: five real-engine regressions reproduced the original return/date/stale-row failures. The text-filter regression separately failed before its handler correction.
- Ten new real-engine offline regressions pass locally. External HTTP is forbidden during these tests.
- Fourteen preceding portable checklist and summary-date regressions pass locally.
- All 24 backend tests (10 new + 14 preceding portable regressions) pass in the server's Python 3.9 runtime.
- Independent read-only review: no P0–P2 findings; 21/21 independently exercised checks passed, including three additional concurrency scenarios.
- Nine focused existing frontend renderer tests pass (checkboxes, Select all, Proceed, names and batch UI).
- Signature gesture guard: 14 locked blocks intact.
- The unified worker patch passes `git apply --check` against the actual deployment baseline.
- Full historical worker mirror is not claimed green; it has previously documented missing dependencies and obsolete expectations. This change is verified by the scoped behavioral suites above.

## Deployment

Both actual server copies were independently read before deployment and matched baseline SHA-256 `be477c9c6d587baa80a4aa7e2b17ba9f8282cc67e0e983e5d539ae19ee7bf56e`.

Reviewed candidate SHA-256: `3140439d59903753febc9435e6d6c5f370cffdc92717fdf64cbcac54e5805e04`.

The publication is a shared worker-service correction used by Android, iOS and Windows/web clients. It does not require a new signed native binary or store submission. The guarded installer checks both baseline hashes, compiles the candidate, backs up both files, preserves ownership/mode, installs atomically, restarts WhatsApp and channel bridge, and checks both health endpoints with rollback on failure.

Installed on 2026-10-12 at 14:52 UTC. Both files match the reviewed candidate hash; both services and both health endpoints passed. Recoverable baseline backup: `/var/backups/energetica-whatsapp/attendance-return-date-20261012T145256311406Z`.

Real completion/edit-all journeys were tested only with in-memory SharePoint fixtures (no actual HR changes). Live UI verification is limited to non-mutating navigation and the day-scoped checklist, not a real presence submission.
