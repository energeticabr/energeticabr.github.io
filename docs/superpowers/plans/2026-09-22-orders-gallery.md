# Orders Gallery Implementation Plan

> **For agentic workers:** Use the TDD cycle for each task and verify the full mobile/web build before release.

**Goal:** Add a read-only, cross-platform Orders Gallery based on Power Apps Screen10 / SharePoint `NOTASPENDENTES`, and place it beside the existing launch galleries in Suprimentos.

**Architecture:** Build an isolated orders data service on the authenticated Microsoft Graph and SharePoint repository already used by the portal. Add a separate accessible gallery overlay and controller route; keep launch-gallery operations untouched. Extend only the Suprimentos menu presentation to add a second gallery action and the requested launch-button sizing/colors.

**Tech Stack:** Vanilla ES modules, existing Graph/SharePoint repository, Capacitor MSAL authentication, DOM/CSS, Node test runner, JSDOM, Vite.

**Spec:** `docs/superpowers/specs/2026-09-22-orders-gallery.md`

## Global Constraints

- Preserve all existing worktree and signature-gesture protections; do not edit protected gesture blocks.
- Never modify the original dirty main checkout; all work remains isolated in `.worktrees/orders-gallery`.
- SharePoint reads and attachments use the signed-in Microsoft account. Never pass Microsoft tokens to the chatbot VM.
- Orders gallery is read-only and does not reuse or modify launch gallery state/actions.
- Render all SharePoint values with `textContent`/escaped markup; do not trust list data as HTML.
- Preserve mobile, iOS, Android, and desktop-browser behavior.

## Review Focus

- Matching only the verified Screen10 fields and filters; no G28-derived fields.
- Delegated scope behavior and ACL enforcement on list and attachment reads.
- Large list pagination, stale async requests, responsive layout, and attachment viewer navigation.
- The menu only grows the Lançamentos button while both gallery buttons retain their current size.

---

### Task 1: Authenticated SharePoint orders data service

**Files:**
- Add: `apps/energetico-mobile/src/chat/orders-gallery-data.js`
- Modify: `apps/energetico-mobile/src/config.js`
- Test: `apps/energetico-mobile/tests/orders-gallery-data.test.mjs`
- Modify: `apps/energetico-mobile/tests/auth-service.test.mjs`

1. Add failing tests for site/list resolution, paginated loading, normalized Screen10 fields, SharePoint attachment metadata/downloads, and safe errors.
2. Run the targeted test file and confirm RED.
3. Implement the injected data service using the existing Graph client, repository, REST attachment transport, and delegated `Sites.Read.All` scope.
4. Run the targeted tests and confirm GREEN.

### Task 2: Read-only Screen10 Orders Gallery

**Files:**
- Add: `apps/energetico-mobile/src/ui/orders-gallery-view.js`
- Add: `apps/energetico-mobile/src/ui/orders-gallery.css`
- Modify: `apps/energetico-mobile/src/main.js`
- Test: `apps/energetico-mobile/tests/orders-gallery-view.test.mjs`

1. Add failing tests for initial sort, exact filters, indicators, pagination, `dd/mm/yyyy`, safe rendering, details table, and attachment collection opening.
2. Run the targeted tests and confirm RED.
3. Implement a standalone read-only overlay, including list, filters, counters, details, retry/empty/error states, and SharePoint attachment collection support.
4. Run targeted tests and confirm GREEN.

### Task 3: Suprimentos menu and controller routing

**Files:**
- Modify: `apps/energetico-mobile/src/ui/chat-view.js`
- Modify: `apps/energetico-mobile/src/styles.css`
- Modify: `apps/energetico-mobile/src/app-controller.js`
- Modify: `apps/energetico-mobile/src/demo/native-bootstrap.js`
- Test: `apps/energetico-mobile/tests/chat-view.test.mjs`
- Test: `apps/energetico-mobile/tests/app-controller.test.mjs`

1. Add failing tests proving the two gallery actions are side-by-side to Lançamentos, have gray/white styles, and open separate instances; ensure Apps stays hidden and old launch-gallery behavior survives.
2. Run targeted tests and confirm RED.
3. Add orders gallery factory/route/data wiring and direct SharePoint media viewer callbacks. Only the Lançamentos button gets the taller visual treatment; the existing field-visit action and secondary flows remain available.
4. Run targeted tests and confirm GREEN.

### Task 4: Platform verification and release

1. Run targeted tests, complete mobile test suite, production web build, PWA build, signature gesture guard, iOS project verification, and secret scan.
2. Review diff, route/focus/lifecycle behavior, and menu responsive screenshots.
3. Run native Android/iOS build and signing/distribution workflows that are available; deploy Windows Web/PWA through existing Pages workflow.
4. Integrate the tested branch with `main` following repository release rules; report exactly which distribution channels completed versus any store review/publishing gate.
