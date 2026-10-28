# DDA Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Execution is directly authorized by the user.

**Goal:** Open a dedicated DDA report beneath the first left HOME mascot, defaulting to Em aberto.
**Architecture:** Reuse registration-gallery-data with kind dda and its complete authenticated read. Add a report model and view; keep its controller instance separate from the existing gallery while reusing gallery session/disposal/media handling.
**Tech Stack:** JavaScript, existing DOM report helpers, Decimal, SharePoint authenticated REST.
**Spec:** ../specs/2026-10-28-dda-report-design.md

## Global constraints
- Initial status Em aberto, no date cutoff; unknown status is not open.
- New button immediately after open-pending-provisions in the left rail.
- Read-only source; no new public financial data, credentials, or API permissions.
- Preserve protected signature blocks and the existing DDA gallery.
- Publish web/Windows, Google Play internal, TestFlight; verify each target.

## Review focus
- Missing money/date/status, duplicate IDs and malformed/incomplete snapshots.
- All pages included in totals and printing, filtering does not alter bank status.
- Closing/logout/navigation during data/attachment loading cannot reopen stale UI.
- Auth retry and gallery/report coexistence; no create/edit/delete callbacks.
- Narrow screens, rotated phones, long names, focus restoration and PDF preview.

## Tasks
### 1. Report data model and presentation
Files: src/chat/dda-report-model.js, src/ui/dda-report-view.js, src/ui/dda-report.css; tests/dda-report.test.mjs.
- [x] Write failing tests for default open-only, sorting, full totals, invalid values, reset on reopen, pagination/print and stale reads.
- [x] Implement normalizeDdaReportRows(snapshot), buildDdaReport(rows, filters, now), createDdaReportView({data, document, openMediaCollection}).
- [x] Reuse existing listAttachments/downloadAttachment for explicit mirror clicks; reject late replies after close.
- [x] Verify model/view tests.

### 2. HOME/controller integration
Files: src/app-controller.js, src/ui/chat-view.js, src/styles.css, src/ui/report-navigation.js, src/ui/report-print.js, src/web/main.js, src/main.js; integration tests and a fictitious browser fixture.
- [x] Test new shortcut position/action, isolated data kind dda and report instance, authenticated media and stale session disposal.
- [x] Add action_dda_report mapping, open-dda-report handler/factory using a separate registrationGalleries key; decorate report for navigation and printing.
- [x] Insert marked DDA mascot under pending provisions and shift remaining left shortcuts by one 56px row.
- [x] Add title/navigation and CSS imports to web/native.
- [x] Verify focused regressions, signature guard, PWA build, iOS project and secret scan; inspect 320/390 and Windows fixture.

### 3. Review and publication
- [x] Independent whole-change review; fixed the malformed-source P2 with strict DDA page validation and regression tests.
- [ ] Commit, PR, required checks, merge; wait for main workflows without duplicate dispatch.
- [ ] Open the published report with authenticated data and confirm default filter; verify Android internal and TestFlight receipts.

Validation: 320/390/1365 browser inspection with fictitious data; default/status/bank filters, direct shortcut, full print capture and missing-mirror state checked. Guard 14 intact; native/PWA builds and iOS/secret checks passed. Release evidence will be recorded privately.
