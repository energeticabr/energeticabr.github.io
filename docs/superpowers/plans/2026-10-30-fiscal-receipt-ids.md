# Fiscal receipt IDs implementation plan

**Goal:** Show the IDs of every added fiscal row inside the left side of its result cluster.

**Architecture:** Carry optional `createdItemIds` from confirmed collector delivery through the durable VM receipt and strict client validator to a two-column receipt cluster.

**Spec:** `docs/superpowers/specs/2026-10-30-fiscal-receipt-ids-design.md`

- [x] Trace confirmed created-row IDs across all three source workers; extend receipt metadata without new fiscal queries.
- [x] Test preservation, validation, deduplication and legacy compatibility; observe missing-field failure before implementation.
- [x] Render per-source ID badges at the left, preserving source summaries and acknowledgement behavior.
- [x] Validate all badges and layout with many/long IDs, empty and legacy metadata at narrow and desktop widths.
- [ ] Review and deploy the metadata update; verify read-only runtime state without posting financial records.
- [ ] Run required checks, merge and verify publication on PC/web, Android internal and iOS TestFlight.

Validation: local app suite 8,136 tests / 8,133 passed / 3 skipped / zero failures; three additional new browser cases passed at 320/390/1365 px. Portal suite 1,278 / 1,271 passed / 7 skipped. Backend 27 Python tests, 22 Node tests and 124 PowerShell assertions passed. Review findings for lost Flow replies and empty-to-unknown evidence were reproduced and fixed; pending-delivery markers are persisted before side effects, and interrupted sources cannot retain a false zero-creation claim. All QA used fictitious data with no fiscal queries or SharePoint record writes.
