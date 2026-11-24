# Camera Name Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users rename cameras from each card with a pencil button and keep the alias on that account and installation.

**Architecture:** Keep the camera service read-only. Store validated aliases in account-scoped `localStorage` keys using the stable camera ID, and continue passing the effective name through `channel.label`.

**Tech Stack:** JavaScript ES modules, CSS, JSDOM, Node test runner, Vite, Capacitor.

**Spec:** `docs/superpowers/specs/2026-11-24-camera-name-edit-design.md`

## Global Constraints

- Run `pnpm guard:signature-gestures` before mobile edits and before release.
- Do not alter the camera gateway, endpoints, HLS playback, or unrelated camera behavior.
- Publish validated app changes to TestFlight and the Google Play internal track; verify the web deployment for Windows/desktop.
- Do not publish to Google Play production or submit to App Store review.

## Review Focus

- A pencil click must not open the camera or toggle multi-select.
- Empty/whitespace names must be rejected; names must remain text, not HTML.
- Aliases must load for the matching account and camera ID, and remain isolated from other accounts.
- Cancel and Escape must leave the name unchanged and return focus to the right pencil.
- A storage error must not look like a successful persistent save.

---

### Task 1: Rename camera cards

**Files:**
- Modify: `apps/energetico-mobile/tests/cameras-view.test.mjs`
- Modify: `apps/energetico-mobile/src/ui/cameras-view.js`
- Modify: `apps/energetico-mobile/src/ui/cameras-view.css`

**Interfaces:**
- Consumes: `accountKey`, `list()` channels `{ id, label }`, and the existing camera-card render flow.
- Produces: `data-camera-rename` pencil controls, a modal name editor, and account/camera-scoped alias persistence.

- [x] Add tests for pencil placement/accessible name, successful rename and reload, account isolation, cancel/Escape, empty-name rejection, and storage failure; run them and confirm expected failures.
- [x] Implement alias loading/saving and editor interactions with focus restoration; run the focused tests and confirm they pass.
- [x] Style the pencil button and editor for narrow mobile and desktop layouts; preserve the existing camera card actions.
- [x] Run the gesture guard, camera-view tests, camera layout checks, web/PWA build, and platform validation required by the release workflow.

### Task 2: Publish the validated app

**Files:**
- Release: `.github/workflows/energetico-ios.yml`
- Release: `.github/workflows/energetico-android.yml`
- Release: `.github/workflows/pages.yml`

**Interfaces:**
- Consumes: the validated camera-name editing code from Task 1.
- Produces: the updated web app and the internal iOS/Android builds.

- [ ] Push the revision and require the relevant CI checks to pass before distribution.
- [ ] Let the main-push workflows publish TestFlight and Google Play internal; do not dispatch duplicates.
- [ ] Verify each published destination separately and update this plan with the revision and workflow evidence.

### Execution ledger

- Ruling: Keep aliases in account-scoped local storage — the camera endpoint is read-only and adding a gateway write path is outside this UI change — names will need to be entered separately on each installation.
- RED: The new tests failed because camera cards had no rename button.
- GREEN: `tests/cameras-view.test.mjs` passed 13/13; the browser layout check passed at its five configured viewports.
- Builds and guards: `pnpm guard:signature-gestures` passed with 14 protected blocks intact; `pnpm build`, `pnpm build:pwa`, `pnpm ios:verify`, and `pnpm secrets:verify` passed.
