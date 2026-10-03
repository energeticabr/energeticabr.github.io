# Power Apps Report Launch Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproduce the mascot and exact background color of every Power Apps report shortcut 3–17 in the Energético report hub.

**Expanded scope:** Audit and revise each report 3–17 against its Power Apps reference. Keep desktop table hierarchy and palettes while converting narrow layouts to non-clipped cards. Work is split into non-overlapping RH (3–5), operations (6–8), spending (9–10), audit (11–13), and commercial (14–17) code slices.

**Architecture:** Store the original PNG resources locally, define one immutable report-to-asset/color mapping, and render each existing button with a decorative image plus accessible text. The CSS grid adapts without horizontal scrolling; navigation logic stays unchanged.

**Tech Stack:** Vite, vanilla JavaScript/CSS, Node test runner, JSDOM, Chrome headless.

**Spec:** `docs/superpowers/specs/2026-10-03-report-launch-buttons-powerapps.md`

## Global Constraints

- Exact control mapping, image and `Fill` are fixed by the spec; do not substitute a generic mascot.
- Preserve behavior and appearance of report shortcuts 1–2.
- At 740×360 and 844×390, no horizontal document or hub overflow; vertical scrolling is allowed.
- No temporary Power Apps blob URLs in application code.

## Review Focus

- A missing image must not make a report inaccessible; the text remains readable and clickable.
- A report without a loaded extra view remains disabled even when it has a mascot.
- The reused asset for reports 6 and 10 must be stored only once and retain two distinct colors.
- Filenames and image dimensions must survive the production and PWA builds.
- Long report names at 740 px must wrap within their own tiles, not widen the grid.

---

### Task 1: Asset mapping and rendering

**Files:** Create `apps/energetico-mobile/src/ui/report-launch-button-assets.js`; add original assets under `assets/report-mascots/`; modify `apps/energetico-mobile/src/ui/contractor-reports-view.js`; test `apps/energetico-mobile/tests/contractor-reports-view.test.mjs`.

**Interfaces:** `REPORT_LAUNCH_BUTTONS[number]` provides `{ imageUrl, color, group, control }` for 3–17. The view consumes it but keeps the existing click handlers.

- [ ] Add failing assertions for 15 distinct report mappings, exact colors, decorative images, accessible text, disabled behavior, and unchanged clicks.
- [ ] Run `node --test tests/contractor-reports-view.test.mjs` and observe the new assertions fail.
- [ ] Extract the 14 unique image files from the user-supplied `.msapp`, then implement the mapping and button markup.
- [ ] Run the focused test and confirm every case passes.

### Task 2: Responsive visual layout

**Files:** Modify `apps/energetico-mobile/src/ui/contractor-reports.css`; create a report-hub browser fixture and test under `apps/energetico-mobile/tests/`.

**Interfaces:** The tile contains `.cr-report-tile-image` and `.cr-report-tile-copy`, with `data-report-id` unchanged.

- [ ] Write a browser test for asset loading and no clipping at 740×360 and 844×390; verify it fails before CSS is complete.
- [ ] Style the original 79×76-like image control, exact fill, grouped desktop tiles, focus state and responsive text wrapping.
- [ ] Run focused browser and hub tests; inspect screenshots for reports 3–17.

### Task 3: Integration and publication

**Files:** No further source files expected.

- [ ] Run `pnpm test`, `pnpm run build`, `pnpm run build:pwa`, `pnpm run secrets:verify`, `pnpm run guard:signature-gestures`, and `git diff --check`.
- [ ] Review the diff, commit, open a PR, verify CI, merge, and confirm Pages, Android internal and iOS TestFlight outcomes.
