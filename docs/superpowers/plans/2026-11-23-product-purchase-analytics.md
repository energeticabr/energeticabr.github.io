# Product Purchase Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 12-month purchase charts to the selected-product detail popup and make that popup fill the report height.

**Architecture:** Extend `buildManagementProductDetail` with an analytics snapshot built from exact product/branch launch rows. Render accessible SVG charts and supplier bars inside the existing scroll region; adjust only the product dialog/backdrop layout so it fills the report vertically.

**Tech Stack:** Existing JavaScript modules, Node test runner, jsdom, Vite, Chrome layout harness, CSS and inline SVG.

**Spec:** `docs/superpowers/specs/2026-11-23-product-purchase-analytics.md`

## Global Constraints

- Preserve every block between `SIGNATURE_GESTURE_LOCK_START` and `SIGNATURE_GESTURE_LOCK_END`; run `pnpm guard:signature-gestures` before and after app changes.
- Build the charts from the already loaded `LANCAMENTOS` snapshot; do not issue a new SharePoint request.
- Match the selected product and branch with the same rules used by the existing detail table.
- Exclude provisions from purchase charts; ignore date and supplier filters for the 12-month analytics.
- Keep the existing popup close/focus/return behavior and internal scrolling.
- Publish the validated main revision to Pages, Google Play internal, and TestFlight; avoid duplicate dispatch when the main push has already started release workflows.

## Review Focus

1. A date window crossing January includes exactly 12 calendar months — model test with a November 2026 anchor.
2. A supplier filter does not hide other suppliers in analytics — model test with multiple vendors and a selected supplier.
3. Product and branch variants do not mix chart data — model test with neighboring product and branch records.
4. An incomplete amount or quantity never becomes a partial total — model test for null propagation and UI label.
5. A long chart on a narrow or rotated viewport does not push the close button away or overflow horizontally — browser fixture at the four required viewport sizes.

---

### Task 1: Build monthly purchase analytics

**Files:**
- Modify: `apps/energetico-mobile/src/chat/spending-reports-model.js`
- Test: `apps/energetico-mobile/tests/management-product-detail.test.mjs`

**Interfaces:**
- Add `analytics` to the existing detail return value, containing a 12-element `months` series and supplier totals.
- Accept an `asOfDate` option so the UI's injected clock determines the end month.

- [ ] Write tests for the twelve-month boundary, supplier aggregation, exact product/branch matching, filter independence, exclusions and incomplete values.
- [ ] Run the focused model test and confirm it fails for the missing analytics behavior.
- [ ] Implement minimal aggregation from launch rows; do not include provision rows.
- [ ] Re-run focused model tests and the existing product detail tests.

### Task 2: Render charts and fill the popup

**Files:**
- Modify: `apps/energetico-mobile/src/ui/management-product-detail-view.js`
- Modify: `apps/energetico-mobile/src/ui/management-report-view.js`
- Modify: `apps/energetico-mobile/src/ui/management-report.css`
- Test: `apps/energetico-mobile/tests/management-product-detail-browser.test.mjs`
- Test: `apps/energetico-mobile/tests/fixtures/management-product-detail.html`

**Interfaces:**
- Render the analytics passed by the model in the current scroll region after the existing table.
- Use SVG for the smoothed monthly value chart and monthly quantity chart; render a supplier bar chart with all supplier totals.

- [ ] Extend the browser fixture with deterministic 12-month purchases and assertions for all three charts, headings, values, scrolling, and full-height geometry.
- [ ] Run the focused browser test and confirm the new chart and height assertions fail.
- [ ] Implement chart DOM and responsive styles; keep the header/close control outside the scroll region.
- [ ] Re-run the browser fixture at 320×568, 390×844, 844×390, and 1365×768.
- [ ] Run the signature guard, focused model/UI tests, required app builds, and CI workflows.
- [ ] Merge the validated PR and independently verify Pages, Play internal, and TestFlight for the same revision.
