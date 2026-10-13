# Report dismissal and daily RHID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consistent single-emoji dismissal in all reports and daily RHID without automatic PDF.

**Added requests:** Provision report parent/child grouping; lower annual table readability; description gallery status filter/display/edit; portrait-rotated report landscape parity.

**Architecture:** Reuse existing report lifecycle callbacks and outside-click handlers; centralize close-control presentation if useful. Daily RHID retains the existing renderer and simply stops requesting automatic PDF generation. Attachment-recovery changes are verified independently before the combined release.

**Tech Stack:** JavaScript, DOM/CSS, Node tests, Vite, Capacitor, Python backend patch.

**Spec:** `docs/superpowers/specs/2026-10-13-report-dismissal-rhid-day.md`

## Global Constraints

- Exactly one `❌` close control per report; backdrop also dismisses.
- No writes to real drafts/documents for verification.
- Preserve 14 protected signature blocks and existing print/filter/actions.
- Publish web/Windows, Android internal and iOS TestFlight.

## Review Focus

- Closing during pending load cannot resurrect a report.
- Rotated portrait reports keep the close control reachable without obscuring filters.
- Nested pickers/PDF layers close only their own layer.
- Daily RHID selected date remains correct, including navigation/refresh and failure retry.
- Network/session changes during attachment recovery cannot discard drafts or replay transfers.

### Task 1: Report close controls (independent UI sidecar)

**Files:** `apps/energetico-mobile/src/ui/*report-view.js`, `payment-ledger-view.js`, `attendance-summary-view.js`, `stage-progress-view.js`, `commercial-*-view.js`, `sac-pathologies-view.js`, report styles, and report UI tests. Main agent owns `chat-view.js` and `app-controller.js`.

**Interfaces:** Existing `close()`/`destroy()`/`onClose` contracts unchanged; emoji controls call only the matching report close. Sidecar reports exact changed files to integrate.

- [x] Write DOM behavior tests checking one `❌`, no duplicate close/home exit, correct outside/inside click, loading/error/reopen/destroy cleanup.
- [x] Run tests before implementation and observe intended assertion failures.
- [x] Implement the bounded controls/styles in all report factories, preserving other actions and callbacks.
- [x] Run report-focused tests, expected all pass; visually verify representative table/monthly report in phone and PC fixtures.
- [ ] Commit explicit files with integrated main-agent changes after review.

### Task 2: RHID daily calendar action (main agent)

**Files:** `apps/energetico-mobile/src/app-controller.js`, `src/ui/chat-view.js`, `tests/app-controller.test.mjs`, `tests/chat-view.test.mjs` or focused new tests.

**Interfaces:** `generateRhidAttendanceReport(day, { replaceMessageId })` opens the existing daily table; no `openPdf: true`. Monthly report and explicit daily sharing APIs remain unchanged.

- [x] Add failing tests: lower calendar action requests selected date and displays daily table, never calls media/PDF; monthly action remains wired.
- [x] Run RED; change only lower daily generation binding and duplicate report-popup close actions as needed.
- [x] Run RHID/controller/view tests GREEN and verify isolated calendar-to-day UI.
- [ ] Integrate with Task 1, run signature guard, full root test suite, builds and code review.

### Task 3: Release combined fixes

**Files:** Explicit changes from Tasks 1-2 and current attachment recovery/backend package.

**Interfaces:** Existing GH workflows; guarded backend CAS installer.

- [x] Finish attachment review fixes with RED→GREEN tests for rejected-intent cleanup, legacy renewed IDs and same-account session revision races.
- [x] Verify backend unit tests and reviewed patch; deploy with fresh separate live/mirror hashes, verified backups, unchanged config and healthy service.
- [ ] Stage only intended files; rerun secrets check and diff check; create/attach PR then merge after required checks.
- [ ] Confirm web asset/version, Android internal upload and iOS TestFlight attachment for merged revision. Preserve real signing draft throughout.

### Task 4: Group provisions and improve recurring table readability (report sidecar)

**Files:** Provision report model/view/styles/tests and the provision snapshot loader in spending-reports-data.js. Gallery remains independently owned.

- [x] RED→GREEN: real description ID grouping, original children expansion, decimal sums/deduplication, single lines and filters preserved.
- [x] RED→GREEN: annual dates/total semibold, totals centered, larger tokens fitted without overflow in browser.
- [ ] Independent review and final integrated suite/build/publication.

### Task 5: Description gallery status (gallery sidecar)

**Files:** Registration gallery data/filter/view, description card, description edit form and focused tests.

- [x] Verify actual SharePoint choices without writing records or schema: STATUS is Text; complete parent/child reads prove PAGAMENTO PREVISTO and PAGAMENTO EFETUADO.
- [x] RED→GREEN: default PAGAMENTO PREVISTO, manual Todos/other statuses, displayed status and dropdown editing. Independent review found refresh→close→reopen lost STATUS; added two RED regressions and preserved selection/date bounds during loading, GREEN 36 focused tests.
- [ ] Independent review and final integrated suite/build/publication.

### Task 6: Rotated portrait report parity (main agent)

**Files:** Shared report-landscape JS/static CSS, navigation CSS, contractor responsive CSS, browser fixtures/tests; shared PDF preview caller.

- [x] Reproduce real browser RED: invisible navigation and 3px backdrop; contractor uses physical four-column breakpoint instead of logical seven-column landscape toolbar.
- [x] Implement 16px minimum backdrop and safe-area mapping, logical control size/breakpoints, and one-X PDF layout.
- [x] GREEN in portrait/landscape and asymmetric safe areas; ensure DOM/filter/request retention and keyboard stability. Internal browser confirms margin, arrows, outside dismissal and preserved draft.
- [ ] Visually inspect isolated fixtures, final integrated suite/build/review and three-platform publication.

### Task 7: Printing a large payment report without restarting the app

**Files:** Shared PDF viewer, payment-ledger print snapshot, report-print adapter and focused regressions.

- [x] Diagnose unbounded allocation: every PDF page keeps a canvas; printing mounts every filtered launch into the live report DOM.
- [ ] RED→GREEN: retain only a bounded window of page canvases for large reports, preserve continuous navigation/current employee, cancel cleanly and keep failed pages unsigned.
- [ ] RED→GREEN: capture all filtered ledger rows directly from the loaded model without growing the live DOM or making new SharePoint requests.
- [ ] Verify a large real PDF in the internal browser, exact return to the report and independent review; rebuild and publish all three platforms with the previous tasks.
