# RHID Attendance Adjustments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify RHID punches by time window and publish auditable manual corrections in the attendance report.

**Architecture:** Keep raw RHID data unchanged. A VM SQLite audit store records overrides, the authenticated report endpoint overlays current corrections, and the mobile/web client renders and edits effective slots. The existing PDF consumes the same effective table.

**Tech Stack:** Python standard-library SQLite and unittest/pytest; JavaScript ES modules, Node test runner, CSS; existing GitHub Pages, Play internal and TestFlight workflows.

**Spec:** `docs/superpowers/specs/2026-10-01-rhid-attendance-adjustments-design.md`

## Global Constraints

- Never edit signature gesture lock blocks; run `pnpm guard:signature-gestures` before mobile changes.
- Preserve `BATIDAS_RHID` and all RHID source rows; overrides live only in the separate audit store.
- Every manual change requires `HH:MM` and a nonempty reason; only finalised days may be changed.
- Use the portal's existing authenticated allowlist; validate the person against the selected date server-side.
- Publish the same commit to web, Play internal, and TestFlight and confirm each run.

## Review Focus

- A punch exactly at 12:30 belongs to entrada 2, not saída 1: classification unit test.
- Two punches in one window remain visible as an inconsistency: classification unit test.
- A fresh RHID sync cannot erase or silently replace an override: report/overlay test.
- A forged person/date or empty reason cannot write to the audit store: backend endpoint test.
- A failed save cannot mark a cell as corrected: controller/UI test.

---

### Task 1: Classify punches and overlay adjustments

**Files:** `apps/energetico-mobile/src/chat/rhid-attendance-table.js`, `apps/energetico-mobile/tests/rhid-attendance-table.test.mjs`.

**Interfaces:** `classifyRhidPunch(time)` returns a slot or null; `buildRhidAttendanceTable(rows)` retains `headers`/`rows` and adds per-person slot metadata and issues.

- [ ] Add failing tests for each window edge, out-of-window and duplicate punches, empty slots, overrides, and effective totals.
- [ ] Run `node --test tests/rhid-attendance-table.test.mjs` and confirm expected RED failures.
- [ ] Implement classification, discrepancy metadata, and override overlay without losing raw punches.
- [ ] Re-run focused tests and then the complete mobile test suite.
- [ ] Commit the self-contained classification change.

### Task 2: Persist auditable corrections on the VM

**Files:** staged live `channel_bridge.py`, new `rhid_attendance_adjustments.py`, backend tests; deploy script scoped to those files.

**Interfaces:** `RhidAttendanceAdjustmentStore.save(day, person_key, slot, value, reason, actor, original)` appends an event; `.latest_for_day(day)` returns current slot overrides. `portal_rhid_attendance_adjust` validates and saves; `portal_rhid_attendance_report` returns `ADMIN_AJUSTES` for each person.

- [ ] Copy/read the exact live baseline and add failing store and endpoint tests, including source immutability and invalid identity/date/person.
- [ ] Run focused Python tests and confirm expected RED failures.
- [ ] Add SQLite store and authenticated route; keep current RHID data intact.
- [ ] Run backend focused/full tests, stage checksummed files, retain backups, deploy and verify health and a read-only report.
- [ ] Record the deployed hashes and preserve rollback files.

### Task 3: Edit slots in app and refresh report

**Files:** `apps/energetico-mobile/src/chat/chat-client.js`, `src/ui/chat-view.js`, `src/app-controller.js`, `src/styles.css`, related test files.

**Interfaces:** `client.saveRhidAttendanceAdjustment({date, personKey, slot, time, reason})`; view emits `rhid-attendance-adjust-save`; controller refreshes the existing message after save.

- [ ] Add failing tests for opening eligible cells, showing RHID/admin comparison, mandatory reason, blue/orange coloring, authenticated save and failure retention.
- [ ] Run focused tests and confirm expected RED failures.
- [ ] Implement API call, modal, controller save/refresh, accessible clickable cells and responsive styling.
- [ ] Run focused and full tests, `pnpm build`, `pnpm build:pwa`, and signature guard.
- [ ] Commit the app change.

### Task 4: Review and release

**Files:** no new product files unless review discovers a defect.

- [ ] Review frontend/backend diff and re-run affected tests after corrections.
- [ ] Push branch, open PR, attach it if the app accepts, merge after checks.
- [ ] Verify GitHub Pages, Play internal AAB upload and TestFlight group association for the merge SHA.
- [ ] Report deployed state and any remaining live verification limit honestly.
