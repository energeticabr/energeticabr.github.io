# RHID Single Page Signing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A readable one-page monthly RHID PDF with existing in-app signing.

**Architecture:** Compact the existing PDF table without altering its data model or signature fields. Opt-in preview buttons route through the controller's existing signature pad, placement and evidence pipeline; report output returns to the local preview instead of posting chat/document records.

**Tech Stack:** JavaScript, pdf-lib, PDF.js, Node tests, jsdom, Vite/Chrome.

**Spec:** docs/superpowers/specs/2026-10-10-rhid-single-page-signing.md

## Global Constraints

- E, S, E2, S2; 31 ordinary days on one portrait A4 page.
- Keep complete data and genuine unsigned employee/company signature widgets.
- No SIGNATURE_GESTURE_LOCK edits or fingerprint changes.
- No automatic DOCUMENTOS submission or actual signature.
- Publish validated revision on web, Android internal and TestFlight.

## Review Focus

- February/leap year and missing/adjusted punches retain dates and totals.
- Long employee names and unusually long notes never clip or lose characters.
- Cancel drawing/placement restores the previous PDF and monthly panel.
- Closing/sign-out during signing cannot reopen stale PDF or use new credentials.
- Signing twice preserves the first signature and exports the latest PDF.

### Task 1: Compact monthly PDF and opt-in report signing

**Files:**
- Modify: apps/energetico-mobile/src/chat/rhid-monthly-pdf.js
- Modify: apps/energetico-mobile/src/app-controller.js
- Modify: apps/energetico-mobile/src/web/attachment-preview.js
- Modify: apps/energetico-mobile/src/web/attachment-preview.css
- Modify: apps/energetico-mobile/src/ui/rhid-monthly-report-view.js
- Test: apps/energetico-mobile/tests/rhid-monthly-pdf.test.mjs
- Test: apps/energetico-mobile/tests/rhid-monthly-controller.test.mjs
- Test: apps/energetico-mobile/tests/attachment-preview.test.mjs
- Test: apps/energetico-mobile/tests/rhid-monthly-view.test.mjs
- Test: apps/energetico-mobile/tests/rhid-report-pdf-fit.test.mjs

**Interfaces:**
- Consumes: buildRhidMonthlyPdf(report), previewMedia(blob, fileName, options), view.openSignaturePad(fileId), existing signature placement/evidence handlers.
- Produces: opt-in preview options onSign/onStamp; panel suspend/resume; signed report preview without modifying conversation flow.

- [x] Write PDF tests asserting seven column headers, aligned four slots, all 31 dates/totals/signature widgets on exactly one page, leap-month and long-data preservation.
- [x] Write preview/controller/view tests for opt-in buttons, capture/cancel, field positioning, evidence, latest signed export, stale-session rejection and suspended-panel restoration.
- [x] Run focused tests; expected failures are missing columns, two pages, absent callbacks.
- [x] Implement compact table and local report signing using existing protected gesture APIs unchanged.
- [x] Run focused tests; expected all pass (87/87 after review fixes).
- [ ] Render a real sample PDF and inspect its single page; inspect AcroForm fields and signed output. Verify phone/tablet/PC controls in real browser.
- [ ] Run entire suite, guards, secrets, build/PWA and iOS project checks; expected all pass.
- [ ] Fresh-context whole-branch review, then commit and PR; merge only after required checks pass.
- [ ] Confirm actual web assets, Play internal upload and TestFlight readiness for the merged revision.
