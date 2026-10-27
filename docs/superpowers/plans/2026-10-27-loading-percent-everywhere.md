# Loading Percentage Everywhere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every mascot loader includes the percentage cluster immediately to the spinner's right, including intermediate screens.

**Architecture:** Keep the existing shared markup/DOM component and measured progress inputs. Default omitted progress to zero, retain explicit unknown progress and label-only updates, and reuse existing CSS.

**Tech Stack:** JavaScript, node:test, JSDOM, Vite and the existing isolated browser fixture runner.

**Spec:** docs/superpowers/specs/2026-10-27-loading-percent-everywhere-design.md

## Global Constraints

- Initial omitted progress is0%; explicit unknown is—% without aria-valuenow.
- Spinner precedes the badge in one row; measured values remain authoritative.
- No simulated timers, premature100%, protected signature changes or real-user fixture data.
- Publish validated revision to Windows/PWA, Android internal and TestFlight.

## Review Focus

- Markup and DOM factories must produce the same initial and unknown states.
- Label-only updates retain the current value and nodes without duplicating badges.
- Actual chat processing and next-question transitions show the badge without an attachment-progress object.
- Compact and full loaders fit narrow screens in light/dark mode, with the badge on the right.
- Attachment download/upload completion and error behavior retain their current measured semantics.

### Task1: Default percentage in the shared loader and verify its consumers

**Files:** modify apps/energetico-mobile/src/ui/loading-indicator.js and the chat loader's accessibility context in src/ui/chat-view.js; add tests/loading-indicator.test.mjs, tests/loading-percentage-browser.test.mjs and tests/fixtures/loading-percentage.html; update tests/diary-attachment-progress.test.mjs and tests/gallery-loading-screen.test.mjs. All paths are under apps/energetico-mobile.

**Interfaces:** preserve loadingIndicatorMarkup(label, options), createLoadingIndicator(documentRef, label, options), updateLoadingIndicator(root, options). All loading consumers inherit the default without per-screen patches.

- [ ] Add literal DOM tests for default0%, explicit37%, unknown/invalid inputs, generic accessible labels and label-only updates; update the old omit-badge contract. Run node --test tests/loading-indicator.test.mjs tests/diary-attachment-progress.test.mjs and observe RED from absent badges.
- [ ] Add real chat transition and all-gallery initial-loader assertions plus a browser fixture measuring spinner/badge geometry at320/390/1365px and light/dark. Observe RED against the current component.
- [ ] Implement the shared default and always-present row, retaining unknown semantics. Expect the named tests, attachment progress regressions and gallery tests to pass.
- [ ] Run pnpm test, pnpm guard:signature-gestures, pnpm build, pnpm build:pwa, pnpm ios:verify and pnpm secrets:verify. Expect zero failures,14 intact gesture blocks and successful builds/checks; inspect a fictitious mobile screenshot.
- [ ] Commit and obtain one fresh whole-branch review; address substantive findings with regression tests. Push a PR, wait for required checks, merge and verify all three publication targets explicitly.
