# Pending attendance checklist verification

Base app commit: `6ca8a602ae3b48daaa83a87bf0b1f6ff0bc2960c`.

Backend base `worker/workflow.py` SHA-256: `d5238945da0525622761dda0917d6a7da5f1b4cf78e002597d3b2881fdd4738a`. Live and source mirror hashes matched before work.

- UI RED: three new behavior tests failed because pending record IDs had no checkboxes.
- UI GREEN: 297 chat-view tests passed. Full frontend before the review fix: 5,404 passed, zero failures. Final full suite after review: 5,405 passed, zero failures.
- Backend RED: five new tests failed on old accordion presentation, unsupported pending batch selection and incorrect back destination.
- Backend GREEN: eight offline integration tests passed with actual workflow/fixtures on Python 3.12 and the VM's Python 3.9. HTTP is blocked; all writes are in-memory fixtures.
- Existing backend comparison: 28 attendance batch/pending tests; 26 pass and two existing conflict-exit expectation errors reproduce unchanged on baseline and candidate. Both expect immediate `returned_to_main_menu`, while the existing draft-exit policy returns an exit choice. No new regression was observed in that comparison.
- Web/native builds passed; signature gesture guard verified 14 blocks; tracked-file secret scan passed.

## Independent review and audit

- Review found no P0-P2 changes; one P3 warning targeted a historical card. Added a failing regression and scoped the warning to the clicked card. All 297 chat-view tests pass after the correction.
- RHID/signature audit: 236 focused tests pass; signature space (64pt), line above names, PDF-only, multi-select confirmation and vertical pages are already integrated through PR 411. No additional patch needed.
- Reports/layout audit: 395 focused tests pass. The requested report models, exports/editing, dates/widths, 200-row continuous ledger, landscape/cache and task/diary changes are incorporated. No additional patch needed.
- Provision audit: 337 tests pass across parent creation/cascade, grouped popup and repair fixtures. Historical paid-date correction and orphan counterpart creation have verified receipts; do not repeat them. Power Automate recurring definition has a tested candidate but prior deployment was not completed.

## Backend deployment

On 2026-10-12 at 12:09 UTC, production and mirror were hash-guarded against the baseline, backed up and replaced with only the reviewed workflow file. Eight tests passed on the VM immediately before installation.

- Installed SHA-256: `95cae83845805ee1d03a8bbafa3e4bde9fb435506d698328734d3c5e64146c30` in both targets.
- Backup: `/var/backups/energetica-whatsapp/pending-attendance-20261012T120905233081Z`.
- Service active; `/health` returned `status=ok`.
- No real attendance or financial row was submitted for QA.

Publication and live checkbox verification are recorded after they actually complete.
