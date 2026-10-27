# Provision detail accordion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, followed by one fresh whole-branch review.

**Goal:** Replace large expanded provision cards with the compact accordion from the user's first reference.

**Architecture:** Add presentation-only toggle state to the shared provision detail modal and responsive styles to its existing stylesheet. Keep all reads, totals and mutation boundaries intact.

**Tech Stack:** JavaScript DOM, CSS grid, existing SVG icons, Node tests, JSDOM and Chrome.

**Spec:** docs/superpowers/specs/2026-10-27-provision-detail-accordion-design.md

## Global Constraints

- First item open; at most one item expanded; every header can collapse or expand.
- Keep all provision fields, group totals, original values and both gallery entry points.
- No writes or extra read on toggle; preserve modal close/focus, all14 signature blocks and alternating colors.
- Publish web/Windows, Android internal and iOS TestFlight with verified target receipts.

## Review Focus

- Long supplier/description, status and amounts stay readable at320/390px.
- Keyboard focus includes accordion buttons and remains inside the dialog.
- Missing/invalid values remain explicit rather than changing totals.
- A toggle neither reloads the group nor invokes an editor/mutation.
- Closing/reopening and changing groups never retains another group's expansion or late data.

### Task 1: Shared compact provision accordion

**Files:** apps/energetico-mobile/src/ui/provision-description-detail-view.js; src/ui/orders-gallery.css; tests/provision-description-detail-view.test.mjs; tests/provision-description-detail-browser.test.mjs; tests/fixtures/provision-description-detail.html.

**Interfaces:** Preserve createProvisionDescriptionDetail(options), loadGroup(id,{signal,onProgress}) and row fields. Add native button[data-action="toggle-provision-detail"] controlling div[data-provision-panel]; keep article[data-provision-id].

- [ ] Add RED cases for initial/open/collapse state, all data, no extra IO and dialog keyboard focus.
- [ ] Build compact summaries and labeled field panels; reuse existing formatting/icons.
- [ ] Add responsive grouped detail rows, status tones, chevron and first-open styling.
- [ ] Verify real touch/keyboard at320/390/1365px and inspect mobile previews.
- [ ] Run focused shared data/view/gallery/browser/loading tests, signature guard and builds.
- [ ] Obtain one fresh review, address concrete findings, commit and integrate through required checks.
- [ ] Require full main CI and exact-source/CSS plus Play/TestFlight delivery receipts before completion.
