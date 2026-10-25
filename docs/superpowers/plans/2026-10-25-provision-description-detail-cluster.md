# Provision Description Detail Cluster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a clickable description cluster on provisions and all its linked provisions in a read-only detail dialog.

**Architecture:** Extend the existing gallery data with an exact-link, complete-paging reader. A dedicated read-only dialog uses existing modal/loading styles and is owned by the payment gallery lifecycle.

**Tech Stack:** Existing JavaScript ESM, DOM, SharePoint repository, CSS, Node test runner/JSDOM and Vite browser fixtures; no new dependencies.

**Spec:** docs/superpowers/specs/2026-10-25-provision-description-detail-cluster-design.md

## Global Constraints

- Somente leitura: não modificar registros, vínculos, anexos, status ou esquema.
- Não alterar os 14 blocos protegidos da assinatura.
- Prazo de 30 segundos; 100 páginas de 100 registros; texto escapado.
- Publicação em web/Windows, Play interna e TestFlight na mesma revisão; sem lojas de produção.

## Review Focus

- Current gallery filters/pages must never omit linked paid or off-page provisions.
- Partial/cyclic pagination and contradictory IDs must never look like a complete list.
- A late response after close/reopen/logout must not expose stale information.
- Missing or changed description relationships must not become a guessed relationship.
- Narrow widths, keyboard focus and failed queries must retain a usable close/retry path.

### Task 1: Deliver the read-only cluster end to end

**Files:**
- Create: `apps/energetico-mobile/src/chat/provision-description-detail-data.js`
- Create: `apps/energetico-mobile/src/ui/provision-description-detail-view.js`
- Modify: `apps/energetico-mobile/src/chat/orders-gallery-data.js`
- Modify: `apps/energetico-mobile/src/ui/payment-programming-gallery-view.js`
- Modify: `apps/energetico-mobile/src/ui/orders-gallery.css`
- Modify: `apps/energetico-mobile/src/app-controller.js` (pass existing assertSession only)
- Test: `apps/energetico-mobile/tests/provision-description-detail-data.test.mjs`
- Test: `apps/energetico-mobile/tests/provision-description-detail-view.test.mjs`
- Create: `apps/energetico-mobile/tests/fixtures/provision-description-detail.html`

**Interfaces:**
- Consumes: existing repository `resolveList`, `getColumns`, `getItem`, `getItemsPage`, item normalization, session assertion and abort signal.
- Produces: gallery `data.loadDescriptionGroup(id, { signal }) -> { description, provisions }`; modal `open(id, trigger)`, `close()`, `destroy()`.

- [x] Add failing reader tests: exact parent 33 includes children 350 and 371 from separate pages, including paid rows; exclude parent 34; never call writes.
- [x] Add invalid/missing parent, opaque link metadata, partial/duplicate/cyclic paging, 100-page bound, abort and expired-session tests. Run and observe RED.
- [x] Implement read-only reader and expose it only on provision payment data. Run reader tests GREEN.
- [x] Add failing gallery/dialog tests for cluster ID, absent link, off-page rows, original totals, safe text, loading/error/retry, timeout, focus, Escape and stale replies after close/reopen/reload/destroy.
- [x] Implement gallery cluster and read-only modal using existing styles/loading patterns; keep existing cards/actions unchanged. Run tests GREEN with baseline gallery tests.
- [x] Add fictitious browser fixture; check 320px/390px/Windows gallery and detail, actual navigation and close. Record screenshots privately.
- [ ] Run full app suite, builds and signature guard; obtain one independent whole-branch review and resolve Important/Critical findings with RED/GREEN regressions.
- [ ] Commit/push/PR, integrate and monitor actual web, Play internal and TestFlight distribution. Verify the live read-only detail; record final evidence without business data in PR.

**Verification:** Focused reader/dialog + payment gallery tests: zero failures; `pnpm test`: zero failures; `pnpm build`/`pnpm build:pwa`: exit 0; `pnpm guard:signature-gestures`: 14 blocks intact. Published detail must visibly list exact linked provisions without mutating any.
