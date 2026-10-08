# Launch gallery creation performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent background attachment counting from delaying the existing launch-creation workflow.

**Architecture:** Keep the existing authenticated creation request and workflow unchanged. Cancel attachment-count tasks when the launch gallery closes, forward their abort signals to the request layer, and limit background counting in this gallery to one request at a time.

**Tech Stack:** JavaScript, Node test runner, JSDOM, Capacitor.

**Spec:** User request in this conversation: optimize the launch-gallery plus button until the new/existing-order question appears.

## Global Constraints

- No real launch or payment records during validation.
- Preserve signature gestures, workflow authorization and financial mutations.
- Publish web/Windows, Android internal and iOS TestFlight after verification.

## Review Focus

- Reset before a scheduled request starts: no network request.
- Reset during a request: signal aborted and queued work settled.
- Delayed response after reset: no stale count updates.
- Reopen gallery: attachment counting works again.
- Plus button: cancellation precedes onCreate; mutations are unaffected.

### Task 1: Cancel background counting on gallery exit

**Files:**
- Modify: `apps/energetico-mobile/src/ui/gallery-attachment-counts.js`
- Modify: `apps/energetico-mobile/src/ui/launch-gallery-view.js`
- Test: `apps/energetico-mobile/tests/gallery-attachment-counts.test.mjs`
- Test: `apps/energetico-mobile/tests/launch-gallery-view.test.mjs`

**Interfaces:**
- Consumes: `request(operation, payload, {signal})`; existing gallery close/onCreate lifecycle.
- Produces: `loadAttachments(row, {signal})`; `reset()` aborts active work and drains pending work.

- [x] Step 1: Add regressions for all five Review Focus cases.
- [x] Step 2: Run focused tests. Expected: new regressions fail on uncancelled requests.
- [x] Step 3: Track cancellable count tasks; check cancellation before starting loaders. Reset on launch-gallery close; set launch counting concurrency to 1 and forward signal.
- [x] Step 4: Run focused tests, signature guard, secret scan, complete root tests and both builds. Expected: pass, no signature changes.
- [x] Step 5: Independent branch review, then commit only scoped files.
- [ ] Step 6: PR, required CI, merge and automatic releases. Verify actual published UI and release logs; do not create a launch.
