# Launch Gallery Local Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recalculate only launch results after 3000 ms of text inactivity without hiding or interrupting search/filter controls.

**Architecture:** Keep the shared default loader intact and add optional viewport clipping for a results-only loader. Bind launch text input to a 3000 ms debounce with strict text change handling and preserve latest-query guards.

**Tech Stack:** JavaScript, CSS, Node test runner/JSDOM, Vite browser fixtures, existing Capacitor release workflows.

**Spec:** docs/superpowers/specs/2026-10-25-launch-gallery-local-refresh-design.md

## Global Constraints

- Text input waits at least 3000 ms after the last input.
- Search, filters and navigation remain visible; do not move focus/caret.
- Initial/manual-refresh loading and other galleries retain existing behavior.
- No financial mutations, active draft changes or protected signature edits.
- Verify web/Windows, Android internal and iOS TestFlight publication separately.

## Review Focus

- Native text change/search events or IME composition must not bypass the quiet period.
- A response during a new debounce must not publish stale rows/totals or release the local loader.
- Opening a filter panel, scrolling or rotating while loading must not cover controls.
- Closing/destroying must cancel timers/listeners and ignore late responses.
- Tab navigation and initial/manual-refresh accessibility remain correct.

### Task 1: Implement and verify local launch recalculation

**Files:**
- Modify: apps/energetico-mobile/src/ui/launch-gallery-view.js and launch-gallery.css
- Modify: apps/energetico-mobile/src/ui/gallery-loading-screen.js and gallery-loading-screen.css
- Modify: apps/energetico-mobile/src/ui/auto-filter-form.js
- Tests: launch-gallery-search.test.mjs, gallery-loading-lifecycle.test.mjs, launch-gallery-keyboard-browser.test.mjs, diary-search-browser.test.mjs, gallery-loading-live-layout.test.mjs and their fixtures; auto-filter-form.test.mjs

**Interfaces:**
- Consume: createLaunchGallery({document,request,...}), bindAutoFilterForm(form,apply,options).
- Produce: same APIs; loader accepts optional viewport; auto filter accepts optional strict text debounce while preserving defaults.

- [ ] Write regressions: no snapshot/loader at 2999 ms, timer resets per input, text change does not submit early, latest response only, controls retain identity/focus/caret during a local result mask.
- [ ] Run focused tests and observe expected RED failures before changing implementation.
- [ ] Add optional viewport-clipped loader, launch results container and 3000 ms strict text debounce; preserve default loaders and explicit actions.
- [ ] Run focused tests and browser cases at 320/390/1365 px, initial/manual refresh, scroll/resize, keyboard, errors and teardown. Expected: all pass.
- [ ] Run pnpm test, pnpm build, pnpm build:pwa, pnpm ios:verify, pnpm secrets:verify and pnpm guard:signature-gestures. Expected: zero failures and 14 protected blocks intact.
- [ ] Obtain one fresh whole-branch review and fix substantive findings RED/GREEN. Commit, PR, merge and verify automatic publication and actual target evidence; preserve real active drafts.
