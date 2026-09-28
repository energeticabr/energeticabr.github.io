# Launch Gallery Modern Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize each launch card to match the reference while retaining the left attachment rail and adding interactive supplier and order-cluster summaries.

**Architecture:** Keep launch data in the existing launch-gallery snapshot service. Load supplier launches through its paginated `snapshot` operation; resolve order header data through the existing SharePoint orders-gallery data factory and match all launch rows by `AGRUPAR`. Render both views in accessible modal overlays owned by the launch gallery.

**Tech Stack:** JavaScript ES modules, DOM UI, CSS Grid, Node test runner, jsdom, existing Graph/SharePoint repository.

**Spec:** User request and screenshots in the conversation (current launch card, target layout, and order-detail popup).

## Global Constraints

- Preserve the attachment icon/count rail at the far left of every launch card.
- Keep sort options and existing gallery filters/attachment/detail behaviors intact.
- Match by `AGRUPAR` to an order ID without adding unsupported Power Automate operations.
- Never touch signature gesture lock blocks; run `pnpm guard:signature-gestures` before mobile edits.
- Keep interaction responsive on iOS, Android, and desktop-width Windows layouts.

## Review Focus

- Supplier has more than one page of launch records: collect all pages and show no duplicates.
- AGRUPAR is blank, malformed, or has no corresponding order: report it safely rather than showing another order.
- Order has no linked launches or some optional fields are blank: keep the modal readable and totals correct.
- User closes the gallery/account session while a modal data load is pending: do not reopen or update stale UI.
- Narrow viewport or long supplier/observation text: preserve card and modal readability without hiding attachment count.

---

### Task 1: Modern launch-card layout and cluster controls

**Files:**
- Modify: `apps/energetico-mobile/src/ui/launch-gallery-view.js`
- Modify: `apps/energetico-mobile/src/ui/launch-gallery.css`
- Test: `apps/energetico-mobile/tests/launch-gallery-view.test.mjs`

**Interfaces:**
- Consumes existing snapshot row `{ id, total, hasAttachments, fields }`.
- Exposes buttons for `FORNECEDOR` and `AGRUPAR` that open the appropriate detail modal.

- [x] Add failing tests for the new card sections, AGRUPAR and supplier buttons, and unchanged left attachment rail/count.
- [x] Run the focused gallery tests and confirm the new assertions fail.
- [x] Render status/date/info/value groups following the target card, with responsive CSS and the existing attachments rail unchanged.
- [x] Run focused gallery tests and confirm all pass.

### Task 2: Supplier and order-cluster modals

**Files:**
- Modify: `apps/energetico-mobile/src/ui/launch-gallery-view.js`
- Modify: `apps/energetico-mobile/src/app-controller.js`
- Test: `apps/energetico-mobile/tests/launch-gallery-view.test.mjs`
- Test: `apps/energetico-mobile/tests/app-controller.test.mjs`

**Interfaces:**
- Launch view accepts `loadOrderSnapshot(): Promise<{ rows: Array<{ id, fields }> }>`; the controller supplies it from the existing SharePoint orders gallery data factory.
- Supplier modal paginates existing `snapshot` requests filtered by supplier; order modal joins launch rows on normalized `AGRUPAR` and SharePoint order ID.

- [x] Add failing tests for supplier pagination, order-header fields and linked-launch totals, empty/missing clusters, modal close, and the controller’s SharePoint data-provider wiring.
- [x] Run focused tests and confirm the new assertions fail.
- [x] Implement modal loading, safe empty/error states, cached SharePoint snapshot access scoped to the current account, and join by `AGRUPAR`.
- [x] Run focused tests and confirm all pass.

### Task 3: Full verification and release readiness

**Files:**
- Verify: `apps/energetico-mobile/src/ui/launch-gallery-view.js`, `apps/energetico-mobile/src/ui/launch-gallery.css`, related tests.

- [x] Run signature gesture guard, focused tests, and full app test suite.
- [x] Run web/PWA and Android/iOS build or release checks available in the repository.
- [x] Review the diff for scope and ensure no unrelated working-tree changes are included.
