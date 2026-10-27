# Measured loading progress implementation

**Goal:** replace static 0/unknown badges throughout the app with measured work or completed stages.
**Architecture:** operation-scoped UI task progress and optional identity-scoped VM telemetry. Existing measured transfers keep their finer resolution.
**Stack:** JavaScript/DOM, Python bridge, Capacitor Android/iOS, Pages.
**Spec:** ../specs/2026-10-27-measured-loading-progress-design.md

## Constraints
- No timer-generated percentages, unknown byte denominator, premature 100 or global foreground/background event mixing.
- No duplicate business submissions on telemetry failure. Preserve cancellation, stale search and account/session guards.
- Do not edit signature lock blocks. Guard must report 14 intact.
- User opts out of permission/design confirmation and authorizes implementation and internal publication.

## Tasks
1. Audit all mascot loader consumers and current live VM/client boundaries. Write regression tests for scoped task stages, stale operations, failure and measured callbacks. Implement shared UI helper.
2. Add authenticated bounded VM operation progress and client polling, with independent registry/handler tests including identity isolation, locking and no business side effects. Wire chat resume/common responses.
3. Wire galleries, reports, intermediate dialogs and local/media operations to their owned stages/units. Test representative operation families plus exhaustive consumer inventory; preserve focus/caret while filtering.
4. Inspect phone/desktop rendering, run protected guard, focused tests then one final full suite and builds. Run one fresh whole-branch review; fix material findings with regressions.
5. Deploy guarded VM candidate with source checksums, backup and rollback. Commit/PR/checks/merge; observe existing main publication workflows without duplicate dispatch. Verify public bytes, Android internal commit, TestFlight ready/group attachment and VM health.

## Review focus
Concurrent operations and stale sessions; untrusted/missing progress snapshots; unknown-length transfers; telemetry errors vs mutation uncertainty; success receipts and loader completion ordering.
