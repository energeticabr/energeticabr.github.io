# Payment gallery loading implementation plan

> **For agentic workers:** Use superpowers:executing-plans for this single bounded correction.

**Goal:** Center the existing mascot, spinner and loading message above the payment gallery while its controls stay in the background.

**Architecture:** A positioned flex body holds the scrollable gallery and a sibling loading layer. Only snapshot loading dims and makes the background inert; the header navigation remains available. Refresh retains the old cards behind the layer; success, failure and close remove it.

**Tech Stack:** JavaScript DOM, CSS, Node tests with JSDOM and Chrome.

**Spec:** Latest user screenshot and request in this conversation; center loading and leave remaining content behind.

## Global constraints

- Preserve all 14 protected signature gesture blocks.
- Use existing mascot assets and spinner; no new dependencies.
- Publish the same validated revision to web/Windows, Android internal and iOS TestFlight.

## Review focus

- Slow initial load: controls remain inert behind centered feedback.
- Refresh after scroll: layer stays centered in the visible body, not the scroll content.
- Failure: retry remains accessible and background is restored.
- Close/reopen: stale requests cannot hide the newer loader.
- Small/landscape screens: feedback fits and header navigation remains usable.

### Task 1: Payment loading layer

**Files:** Modify payment-programming-gallery-view.js and orders-gallery.css; test payment-programming-gallery-view.test.mjs and payment-programming-gallery-live-layout.test.mjs with its responsive fixture.

**Interfaces:** Consume createLoadingIndicator(document, label); preserve open/close/destroy/reload.

- [ ] Add deferred-load tests for separate feedback, inert background, retained refresh cards, error cleanup and stale close/reopen.
- [ ] Run focused Node tests and observe missing-layer failures.
- [ ] Implement sibling loading layer and scoped positioning/dimming styles.
- [ ] Extend actual Chrome fixture to hold a request pending; assert centering, overlay hit testing, viewport fit, restored controls at 320/390/1365px and landscape.
- [ ] Run focused tests, full pnpm test, native/PWA builds and signature guard.
- [ ] Independent whole-branch review, commit, PR checks, merge, and verify all publication steps.
