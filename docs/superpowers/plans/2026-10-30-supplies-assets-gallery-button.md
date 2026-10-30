# Supplies Assets Gallery Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a gray `IMOBILIZADOS` gallery button beside the blue supplies asset button and route it to the existing asset gallery.

**Architecture:** Extend the supplies menu option synthesis and pairing in `chat-view.js`. Reuse the established `action_asset_gallery` controller route; no new gallery implementation or CSS class is needed.

**Tech Stack:** JavaScript ES modules, Node test runner, JSDOM, shared Vite/Capacitor mobile app.

**Spec:** `docs/superpowers/specs/2026-10-30-supplies-assets-gallery-button-design.md`

## Global Constraints

- Preserve all `SIGNATURE_GESTURE_LOCK_START`/`SIGNATURE_GESTURE_LOCK_END` blocks unchanged.
- The visible gray label is exactly `IMOBILIZADOS`.
- Reuse `action_asset_gallery`; do not create a duplicate gallery or route.
- The shared change must work at 320px and 390px and in web/Windows, Android and iOS builds.

## Review Focus

- Backend already returns `action_asset_gallery`: render exactly one gray action.
- Menu lacks the principal asset option: render no asset gallery action.
- Busy state: the synthesized gallery button remains disabled consistently.
- Narrow widths: both columns remain usable without horizontal overflow.
- Click routing: dispatch exactly `action_asset_gallery`, never the blue flow action.

---

### Task 1: Pair the asset flow with its existing gallery

**Files:**
- Modify: `apps/energetico-mobile/tests/chat-view.test.mjs`
- Modify: `apps/energetico-mobile/tests/menu-gallery-header.test.mjs`
- Create: `apps/energetico-mobile/tests/fixtures/supplies-assets-gallery-button-browser.html`
- Modify: `apps/energetico-mobile/src/ui/chat-view.js`

**Interfaces:**
- Consumes: existing `pollButton`, supplies pairing markup, and `action_asset_gallery` controller route.
- Produces: one gray button beside the supplies asset option with reply ID `action_asset_gallery`.

- [ ] **Step 1: Write the failing supplies menu test**

Add a test that renders the supplies menu, asserts the asset row IDs are `["action_supply_fixed_assets", "action_asset_gallery"]`, asserts the gray label is `IMOBILIZADOS`, clicks it, and observes one `select-reply` event with `action_asset_gallery`. Also assert deduplication when that action is already present.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern="Suprimentos.*Imobilizados" tests/chat-view.test.mjs`

Expected: FAIL because the gray asset gallery button is absent.

- [ ] **Step 3: Implement the minimal synthesis and pairing**

Add an asset-option predicate and synthetic gallery option, exclude duplicate backend gallery actions, pass the asset gallery through `suppliesMenuChoices`, and render it only beside the principal asset option.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test --test-name-pattern="Suprimentos.*Imobilizados|Galeria Pgtos Previstos" tests/chat-view.test.mjs`

Expected: PASS.

- [ ] **Step 5: Run validation and build**

Run: `pnpm guard:signature-gestures && pnpm test && pnpm build && pnpm build:pwa`

Expected: all commands exit 0 and the signature guard reports 14 intact blocks.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-10-30-supplies-assets-gallery-button-design.md docs/superpowers/plans/2026-10-30-supplies-assets-gallery-button.md apps/energetico-mobile/tests/chat-view.test.mjs apps/energetico-mobile/src/ui/chat-view.js
git commit -m "feat(supplies): add assets gallery shortcut"
```

