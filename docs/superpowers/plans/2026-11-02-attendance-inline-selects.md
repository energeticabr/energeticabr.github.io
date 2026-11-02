# Attendance confirmation inline selectors

**Goal:** Edit each selected presence's descriptor and executed activity directly in its confirmation summary; changing descriptor clears activity. Group fills reflect the resulting descriptor/activity pair.

**Architecture:** Keep the existing confirmation and reply transport. Backend advertises validated opaque choices on each cell's `editor: {value, options: [{value,label}]}` and persists row overrides. Mobile renders native selectors over wrapping value labels; only the current prompt accepts edits. Existing ETag commit journal applies per-entry updates after confirmation.

**Constraints:** Preserve signature gesture locks, holiday motivation, other rows, pending drafts, grouping behavior and concurrency checks. No data writes during dropdown selection. Blank activities require selection before submission. Catalog failure and stale choices must preserve the draft.

**Task 1:** Mobile selectors and interaction. Regression tests for selectors, blank activity, disabled historical/busy prompts, emitted opaque reply, group regrouping, controller advertised-choice validation and draft preservation. Run focused tests (expected all pass), 320/390px browser checks (expected no overflow and complete wrapping), full mobile suite and both builds (expected zero failures).

**Task 2:** Backend row drafts, contextual catalogs, stale-choice guard and per-entry commit. Exercise real engine with fake external dependencies (expected no writes before confirmation and only selected-row changes afterward). Produce independently hash-pinned app/build candidates, check deployment, backup and rollback. Keep existing consistency tests.

**Task 3:** Review combined change, apply important fixes, merge PR, deploy backend and verify health. Publish and independently verify Pages for Windows, Android internal track, and processed iOS TestFlight build attached to its internal group.

**Review focus:** Wrong supplier after regrouping; descriptor change retaining a previous activity; stale choice mapped to a new catalog item; catalog failure changing unrelated fields; conflict retry losing row-specific edits.

User has explicitly requested autonomous implementation and publication without confirmation prompts.
