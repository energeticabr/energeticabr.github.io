# Power Apps Gallery Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all portal galleries mapped from the current Power Apps export searchable, contract-driven, attachment-capable, and edit-preselection correct.

**Architecture:** Refresh the generated Canvas contracts, add a reusable searchable gallery-filter adapter, enforce gallery/form/attachment parity through generated coverage tests, then exercise every mapped route in the authenticated production portal. Keep SharePoint metadata authoritative for list and column names.

**Tech Stack:** Power Apps CLI, Canvas YAML, ECMAScript modules, Microsoft Graph/SharePoint, Node test runner, Chrome browser automation.

**Spec:** `docs/superpowers/specs/2026-09-05-powerapps-gallery-parity-design.md`

## Global Constraints

- Do not embed Power Apps in the portal.
- Read list and column names from SharePoint metadata.
- Do not mutate gallery state until the corresponding SharePoint write succeeds.
- Do not perform destructive production validation.

---

### Task 1: Refresh And Prove The Gallery Inventory

**Files:**
- Modify: `portal/catalog/powerapps-gallery-contracts.generated.js`
- Modify: `docs/analysis/powerapps-gallery-field-parity.md`
- Test: `tests/powerapps-gallery-contracts.test.mjs`

- [ ] Download the current published Canvas app into a fresh directory.
- [ ] Run the generator against the fresh `Src` directory.
- [ ] Run the generated-contract tests and resolve every unexpected drift.
- [ ] Record counts for all galleries, resolved mappings, and auxiliary galleries.

### Task 2: Searchable Gallery Filters

**Files:**
- Create: `portal/ui/gallery-filter-select.js`
- Modify: `portal/ui/entity-page.js`
- Modify: `portal/styles/admin.css`
- Test: `tests/gallery-filter-select.test.mjs`
- Test: `tests/entity-pages.test.mjs`

- [ ] Write failing tests for accent-insensitive option search, keyboard selection, clear-to-All behavior, and query restart.
- [ ] Implement the adapter over the existing accessible searchable-select control.
- [ ] Mount it for every single-value gallery filter and gallery variant/sort option where appropriate.
- [ ] Run focused gallery and browser tests.

### Task 3: Gallery, Attachment, And Form Parity Contracts

**Files:**
- Modify: `portal/catalog/powerapps-ui-contract.js`
- Modify: `portal/ui/entity-page.js`
- Modify: `portal/ui/attachments-panel.js`
- Modify: `portal/ui/dynamic-form.js`
- Test: `tests/powerapps-gallery-runtime.test.mjs`
- Test: `tests/attachment-preview.test.mjs`
- Test: `tests/dynamic-form-searchable-select.test.mjs`

- [ ] Add coverage tests for mapped gallery filters, search, sort, actions, and visible fields.
- [ ] Add viewer tests for PDF, image/JFIF, navigation, download, backdrop close, and edit upload.
- [ ] Add edit tests for preselected Choice, Lookup, Person, multi-value, date, and dependent controls.
- [ ] Correct only failures demonstrated by those tests.

### Task 4: Complete Verification And Production Audit

**Files:**
- Create: `docs/analysis/portal-gallery-production-validation.md`
- Modify: `admin.html`
- Modify: `portal/app.js`

- [ ] Run every Node test and require zero failures.
- [ ] Publish the versioned assets and wait for production propagation.
- [ ] Traverse every mapped gallery route in the authenticated portal.
- [ ] Exercise search, each filter, sort, pagination, attachment view, details, and edit-cancel where available.
- [ ] Compare form preselection to the opened SharePoint item and capture any remaining blocker precisely.
- [ ] Repeat layout checks at desktop and mobile widths and confirm no failed HTTP requests.
