# Attendance holiday submit implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Submitting the exact justification FERIADO also saves PRESENCA=AUSENTE and removes that record from the pending checklist.

**Architecture:** Reuse the existing guarded SharePoint irregularity writer and its item/date/ETag checks. One conditional PATCH saves IRREGULARIDADES, PRESENCA and MOTIVACAO together. The controller removes only the successfully saved record from the current pending poll; the view does not select or open it again after holiday validation.

**Tech stack:** Existing JavaScript, SharePoint Graph repository, Node tests, Capacitor releases.

**Spec:** User instruction in this conversation, 02/11/2026: when the user indicates FERIADO, PRESENÇA must become AUSENTE on Submeter.

## Constraints and decisions

- User opted out of design/permission questions; execute and publish web/Windows, Android internal, iOS/TestFlight.
- Existing linked worktree is clean at main 3d213818; branch fix/attendance-holiday-submit-20261102.
- Signature gesture blocks must remain intact. Baseline guard: 14 intact; focused baseline: 23 pass.
- Recognize only the complete trimmed word FERIADO, case insensitive. Never infer holiday from negated sentences or other justifications.
- Save MOTIVACAO=FERIADO with the absence to preserve its explicit reason in existing attendance summaries. Preserve payment and work-description fields.
- Existing saved justifications are not silently reclassified by reads. No retrospective production-data migration.
- All writes keep the existing current-date, item ID, ETag and authenticated-session protections.

## Review focus

- Missing or failed save must not remove a pending record or continue individual validation.
- A successful holiday submit must not remain selected for a later batch.
- Mixed select-all queues must continue to the next irregular record.
- Late results must not affect another account, day or newer poll.
- Nonholiday notes retain their original behavior.

## Task 1: Atomic holiday persistence

Files: src/chat/attendance-irregularity-data.js and tests/attendance-irregularity.test.mjs under apps/energetico-mobile.

- [x] Add failing tests for exact holiday, whitespace/case, nonholiday/negated notes and failed atomic write.
- [x] Observe the expected missing PRESENCA/MOTIVACAO assertion failure.
- [x] Save the three holiday fields in one current-ETag update; return presence only after success.
- [x] Run focused data and session tests.

## Task 2: Refresh current pending checklist after success

Files: src/app-controller.js, src/ui/chat-view.js and focused tests.

- [x] Add failing tests for removing only current saved ID/day, preserving controls/other rows and refusing late session or poll changes.
- [x] Add view tests for checkbox/direct/select-all holiday success and failure.
- [x] Ensure a successful holiday result cannot be selected or forwarded into validation again; continue remaining queued records.
- [x] Show the holiday absence effect in the existing edit review.
- [ ] Run focused regression tests, signature guard, app/PWA builds and full project test command through CI.
- [ ] Review whole diff, merge with required checks, verify web assets and Play internal/TestFlight availability separately.

## Execution ledger

- Investigation: 10 rows on 02/11 remain PENDENTE; 8 have only IRREGULARIDADES=FERIADO. Existing writer intentionally wrote only the note. New requirement changes only explicit future submissions.
- Task 1 complete: three initial red assertions reproduced missing fields; added nonpending guard and exact idempotent retry after four further red assertions reproduced concurrent validation overwrite/redundant retry.
- Task 2 complete: controller red tests reproduced retained record and stale-session completion; view red tests reproduced missing absence review. Final focused tests 44 pass; regression chat view/controller/RHID badges 992 pass. Browser review at 320/390/1280 passes; fictitious names only. Native and PWA bundles compile; signature guard 14 intact.
- Independent whole-diff review: initial Important race fixed and retested; final no Important/Critical issues. Reviewer also exercised synchronous controller rerender during select-all save and confirmed next person remains editable.
- Known nonblocking build diagnostics: existing large chunks and ineffective dynamic imports. Regression emits existing jsdom canvas-not-implemented diagnostic without a failing test.
