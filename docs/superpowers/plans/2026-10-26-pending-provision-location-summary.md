# Pending Provision Location Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show supplier first and branch/property together in the home due-payment report, with attachment-only disclosure.

**Architecture:** Update existing chat report markup/CSS and its attachment-toggle controller guard. Preserve the existing report data and financial actions; expose a separate lookup retry when attachment discovery fails.

**Tech Stack:** JavaScript, CSS, Node/JSDOM, Vite/Chrome fixtures, existing native/web CI.

**Spec:** docs/superpowers/specs/2026-10-26-pending-provision-location-summary-design.md

## Global Constraints

- Supplier appears once above the due date; blue summary has one FILIAL field with branch (property).
- The arrow is selectable only with at least one confirmed named attachment.
- No financial records, active drafts or protected signature blocks are changed.
- Publish and independently verify Windows/web, Android internal and iOS TestFlight.

## Review Focus

- Empty/malformed available lists, loading/errors and stale expanded IDs must not expose a selectable disclosure.
- Failed attachment discovery must remain retryable without using the disabled arrow.
- Grouped and legacy rows, missing location values, and untrusted text remain readable and safe.
- Long suppliers and locations fit 320px/390px/desktop and print without duplicated/hidden location values.
- Existing edit, settlement, delete, open/share and discovery/session guards keep their behavior.

### Task 1: Update report summary and attachment-only disclosure

**Files:**
- Modify: apps/energetico-mobile/src/ui/chat-view.js, src/styles.css, src/app-controller.js.
- Tests: tests/chat-view.test.mjs, tests/app-controller.test.mjs, tests/pending-provision-location-summary-browser.test.mjs and tests/fixtures/pending-provision-location-summary.html.

**Interfaces:**
- Consume existing pendingProvisions rows, pendingProvisionAttachments and pendingProvisionExpandedPaymentId.
- Produce the same state/events, with toggle rejecting unavailable/empty attachment lists and retry using existing retry-pending-provision-attachments.

- [x] Write rendering/controller tests for supplier order, one visible FILIAL value, missing/unsafe values, valid/invalid disclosure states and explicit error retry; run and observe RED.
- [x] Implement minimal renderer/style/toggle/error-message changes; update legacy expectations/fixtures to the new attachment-only contract. Expected: focused tests GREEN.
- [x] Verify synthetic browser geometry/touch/print at320/390/1365px, plus existing deletion/date tests. Expected: controls usable, no overflow, supplier above date, location never concealed.
- [ ] Obtain one fresh whole-branch review while running builds. Fix substantive findings RED/GREEN once, then run pnpm test, build/build:pwa, ios:verify, secrets:verify and guard:signature-gestures. Expected: no failures,14 intact blocks.
- [ ] Commit/push/PR, verify CI, merge and follow automatic publication to all targets without duplicate dispatch; confirm live module and store/beta upload evidence. Preserve worktree and user state.
