# RHID Multiple Employees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Select several active contractor employees and preview one monthly PDF with one page per employee.

**Architecture:** Reuse the searchable multi-select already implemented in the app. Read and validate the supplier list and monthly attendance once, build a report per selected supplier, and render all reports into the same PDF with unique employee and company signature fields. Keep single-employee behavior compatible; signing uses the currently displayed employee page.

**Tech Stack:** JavaScript, DOM, pdf-lib, pdfjs-dist, node:test.

**Spec:** User request in this chat: multiple employees in monthly attendance generation; one page per employee. Preserve existing month/year inputs, active contractor eligibility, read-only preview and signatures.

## Global Constraints

- Do not modify any SIGNATURE_GESTURE_LOCK blocks; all 14 must remain intact.
- No automatic attendance document submission, signature, or business writes.
- Publish the validated revision to web/Windows, Google Play internal, and TestFlight.
- Preserve eligibility revalidation and cancellation/account lifetime protections.

## Review Focus

- Searching or deselecting names must not erase other selections.
- Reject the whole generation if any selected supplier becomes ineligible.
- Every employee needs separate canonical signature fields on their own page.
- A multi-person PDF must never silently omit overflowing notes or add another person's data.
- Signature actions must target the displayed page, not always the first employee.

### Task 1: Complete multi-employee monthly generation

**Files:**
- Modify: apps/energetico-mobile/src/ui/rhid-monthly-report-view.js and rhid-monthly-report.css
- Modify: apps/energetico-mobile/src/chat/rhid-monthly-pdf.js
- Modify: apps/energetico-mobile/src/app-controller.js
- Modify: apps/energetico-mobile/src/web/attachment-preview.js and pdf-preview.js only outside protected blocks if needed
- Test: tests/rhid-monthly-view.test.mjs, rhid-monthly-pdf.test.mjs, rhid-monthly-controller.test.mjs and attachment-preview.test.mjs

**Interfaces:**
- Consumes: existing suppliers, monthly snapshot, searchable select, signature placement.
- Produces: onReport(reportOrReports, options), buildRhidMonthlyPdf(reportOrReports), PDF actions with current page context.

- [x] Write behavioral tests for multiple selection/search/deselection, one monthly read, atomic eligibility rejection, PDF page isolation and distinct canonical signature fields, invalid batches, and signing page 2.
- [x] Run focused tests and verify expected RED results.
- [x] Implement the minimal changes; preserve single-person interfaces.
- [x] Run focused and browser layout tests. Expected: all pass, seven options visible, no clipped controls.
- [x] Render an unsigned synthetic three-person PDF and inspect all pages and fields.
- [x] Run complete mobile suite, signature guard, iOS/secrets verification, native and PWA builds. Expected: success.
- [ ] Obtain fresh whole-branch code review, fix important findings with RED/GREEN tests, then commit and publish.

Verification: 91/91 focused, 9/9 browser layout, all three synthetic PDF pages visually inspected. Full run: 5,235/5,237 passed; two existing browser fixtures timed out waiting for dataset.ready. Both passed an isolated serial rerun (2/2) without source changes. Guard (14), iOS/secrets verification and native/PWA builds passed. Fresh review approved after failed-page signing, bounded export filename and singleton-array corrections. Publication pending.
