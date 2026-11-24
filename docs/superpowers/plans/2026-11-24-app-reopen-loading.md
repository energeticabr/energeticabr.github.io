# Faster App Reopen Implementation Plan

> **For agentic workers:** Use the native implementation workflow and complete each task in order.

**Goal:** Remove the unnecessary diary-status round trip from ordinary app reopen.

**Architecture:** `resumeConversation` retains its existing safe default. Only the automatic cold-start menu resume supplies an explicit opt-out when current state, saved recovery, and pending files show no diary or uncertain work. Manual retries keep the preflight.

**Tech Stack:** JavaScript ES modules, Node.js test runner, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-24-app-reopen-loading-design.md`

## Global Constraints

- Preserve the authoritative `input_continue` request and current retry limits.
- Preserve saved drafts, attachment recovery, cancellation, and diary PDF progress checks when needed.
- Run `pnpm guard:signature-gestures` before and after mobile changes.
- Publish web, Android internal, and TestFlight for the same revision when required checks pass.

## Review Focus

- Main-menu startup skips the unnecessary preflight; cover with a controller test.
- Manual retry still waits for the diary-evidence check; cover with the existing PDF-pending controller test.
- Active diary startup keeps the preflight; cover with a controller test.
- Direct `resumeConversation` callers keep the safe default; cover with a unit test.
- Uncertain recovery and pending uploads keep the preflight; cover with controller tests or explicit assertions.
- Retries still issue only `input_continue`; retain and run existing recovery tests.

---

### Task 1: Make diary preflight conditional on saved recovery state

**Files:**
- Modify: `apps/energetico-mobile/src/chat/resume-conversation.js`
- Modify: `apps/energetico-mobile/src/app-controller.js`
- Test: `apps/energetico-mobile/tests/resume-conversation.test.mjs`
- Test: `apps/energetico-mobile/tests/session-reconnection.test.mjs`

**Interfaces:**
- `resumeConversation(client, { checkDiaryEvidence = true, ...options })` skips only `client.waitForDiaryEvidence` when explicitly passed `false`.
- The app controller passes `false` only when the current and saved state have no active construction diary, uncertain write, or pending file.

- [ ] Add tests for an ordinary main-menu startup that skips preflight and a diary recovery that retains it.
- [ ] Run the focused recovery tests and confirm the new expectations fail for the current implementation.
- [ ] Implement the opt-out flag and derive it from current/saved recovery state plus pending files.
- [ ] Rerun focused recovery tests, the signature guard, and the mobile production build.
- [ ] Inspect the diff and publish the verified revision to the requested channels.
