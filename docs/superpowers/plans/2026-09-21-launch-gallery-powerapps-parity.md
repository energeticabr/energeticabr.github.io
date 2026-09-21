# Launch Gallery PowerApps Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chatbot launch gallery reproduce the PowerApps launch-history screen's filters, counters, dense record content, status hierarchy, and responsive presentation.

**Architecture:** Keep the existing authenticated gallery service and mutation flows unchanged. Add presentation-only normalization helpers inside the standalone gallery view, render PowerApps-equivalent summary bands and record sections from tolerant field aliases, and restyle the overlay as the red/blue dense history surface with a mobile card fallback.

**Tech Stack:** Vanilla ES modules, DOM APIs, CSS, Node test runner, JSDOM.

**Spec:** `docs/superpowers/specs/2026-09-21-launch-gallery-powerapps-parity.md`

## Global Constraints

- Preserve every existing edit, delete, payment, measurement, attachment, signature, retry, focus, and stale-response behavior.
- Insert service content with `textContent`; never attach server-provided HTML.
- Keep the existing request keys and operation contracts backward compatible.
- Desktop/tablet must resemble the PowerApps dense grid; mobile must preserve all data without mandatory horizontal scrolling.

## Review Focus

- Payloads using alternate field names must render the same semantic field.
- Missing optional fields must not create empty labels or literal `undefined`.
- Legacy totals containing only monetary values must remain readable.
- Long supplier/product names must wrap without covering actions.
- Opening details from a dense row must keep the current stale-request and edit locks.

---

### Task 1: PowerApps-equivalent semantic rendering

**Files:**
- Modify: `apps/energetico-mobile/src/ui/launch-gallery-view.js`
- Test: `apps/energetico-mobile/tests/launch-gallery-view.test.mjs`

**Interfaces:**
- Consumes: existing `snapshot` payload `{ rows, totals, filterOptions, sortOptions }` and existing `detail` operation.
- Produces: tolerant summary normalization and `.lg-record-*` DOM structure while preserving `createLaunchGallery(options)`.

- [ ] **Step 1: Write failing tests**

Add tests that provide a full PowerApps-shaped row, assert that every reference field is visible in the card, assert that aliases and missing fields are handled, assert the filter formerly labelled `Contrato` is shown as `Medição`, and assert that clicking `Detalhes` still requests the selected ID.

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test tests/launch-gallery-view.test.mjs`
Expected: the new parity assertions fail because the current card renders only seven fields and the old filter label.

- [ ] **Step 3: Implement minimal semantic layout**

Add field-alias lookup, ordered summary groups, status/attachment/approval/evaluation badges, PowerApps quantity counters in totals, and the dense row DOM. Keep the existing `Detalhes` action and all service calls unchanged.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `node --test tests/launch-gallery-view.test.mjs`
Expected: all gallery tests pass.

- [ ] **Step 5: Commit**

Run: `git add apps/energetico-mobile/src/ui/launch-gallery-view.js apps/energetico-mobile/tests/launch-gallery-view.test.mjs docs/superpowers && git commit -m "feat: align launch gallery content with PowerApps"`

### Task 2: Faithful responsive visual system

**Files:**
- Modify: `apps/energetico-mobile/src/ui/launch-gallery.css`
- Test: `apps/energetico-mobile/tests/launch-gallery-view.test.mjs`

**Interfaces:**
- Consumes: `.lg-record`, `.lg-record-main`, `.lg-record-side`, `.lg-record-badge`, and enhanced total classes from Task 1.
- Produces: PowerApps-inspired desktop/tablet grid and complete mobile reflow.

- [ ] **Step 1: Write failing stylesheet tests**

Add assertions for the blue/red palette, alternating rows, dense desktop record grid, mobile single-column reflow, 44px actions, overflow wrapping, and hidden-overlay hit testing.

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test tests/launch-gallery-view.test.mjs`
Expected: new class and media-query assertions fail against the green card stylesheet.

- [ ] **Step 3: Implement the stylesheet**

Restyle the header, filters, totals, records, badges, detail panel, and responsive breakpoints using the PowerApps navy/red/light-blue hierarchy while retaining accessibility focus rings and safe-area handling.

- [ ] **Step 4: Run tests and production build**

Run: `node --test tests/launch-gallery-view.test.mjs && pnpm test && pnpm build`
Expected: gallery tests, all tests, and production build pass.

- [ ] **Step 5: Commit**

Run: `git add apps/energetico-mobile/src/ui/launch-gallery.css apps/energetico-mobile/tests/launch-gallery-view.test.mjs && git commit -m "style: reproduce PowerApps launch gallery"`
