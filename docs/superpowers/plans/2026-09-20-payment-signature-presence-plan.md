# Auditoria de pagamento, linhas e assinatura — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the four confirmed pending mobile behaviors without touching the protected signature gesture blocks.

**Architecture:** Keep the VM message contract backward compatible. Add focused presentation helpers in `chat-view.js`, normalize the date fallback in `presence-date-scope.js`, and update only the caption/layout math outside protected gesture regions in the signature modules. The controller will auto-advance only the known intermediate product-line question, then the view will prepend a local `FINALIZAR` option to product selectors.

**Tech Stack:** JavaScript ES modules, Node test runner, JSDOM, pdf-lib, Vite.

**Spec:** `docs/superpowers/specs/2026-09-20-payment-signature-presence-design.md`

## Global Constraints

- Do not edit any `SIGNATURE_GESTURE_LOCK_START`/`SIGNATURE_GESTURE_LOCK_END` block.
- Preserve existing message escaping and `FINALIZAR` command semantics.
- Do not implement the already-confirmed items 1, 2 or 3 from the audit.

## Review Focus

- Payment audit values may arrive as object rows, cell rows, or strings; all must be escaped and remain readable on a phone.
- A product selector that already includes a finalizer must not receive a duplicate finalizer.
- An intermediate “outro produto?” prompt must auto-advance at most once and only in the document-signing flow.
- Signature captions must remove the old label in both preview and generated PDF while retaining signer/date.
- A no-match presence date must preserve the complete option set for the “VER OUTRAS DATAS” action.

### Task 1: Payment audit table

**Files:**
- Modify: `apps/energetico-mobile/src/ui/chat-view.js`
- Modify: `apps/energetico-mobile/src/styles.css`
- Test: `apps/energetico-mobile/tests/chat-view.test.mjs`

- [ ] Write failing render tests for structured payment audit rows and totals.
- [ ] Run the focused tests and confirm the table is absent.
- [ ] Add escaped table markup and responsive styles.
- [ ] Run focused tests and the full suite.

### Task 2: Direct product finalization

**Files:**
- Modify: `apps/energetico-mobile/src/ui/chat-view.js`
- Modify: `apps/energetico-mobile/src/app-controller.js`
- Test: `apps/energetico-mobile/tests/chat-view.test.mjs`
- Test: `apps/energetico-mobile/tests/app-controller.test.mjs`

- [ ] Write failing tests for `FINALIZAR` above product options and intermediate prompt advancement.
- [ ] Run focused tests and confirm failure.
- [ ] Implement the narrow flow detection and one-step auto-advance.
- [ ] Run focused tests and the full suite.

### Task 3: Signature caption and scale

**Files:**
- Modify: `apps/energetico-mobile/src/web/pdf-signing.js`
- Modify: `apps/energetico-mobile/src/web/signature-placement.js`
- Modify: `apps/energetico-mobile/src/styles.css`
- Test: `apps/energetico-mobile/tests/pdf-signing.test.mjs`
- Test: `apps/energetico-mobile/tests/signature-placement.test.mjs`

- [ ] Write failing tests requiring no old label and a larger signature area.
- [ ] Run focused tests and confirm failure.
- [ ] Reduce caption to name/date and increase the signature region without protected edits.
- [ ] Run focused tests and the full suite.

### Task 4: Presence no-match summary

**Files:**
- Modify: `apps/energetico-mobile/src/chat/presence-date-scope.js`
- Modify: `apps/energetico-mobile/src/ui/chat-view.js`
- Test: `apps/energetico-mobile/tests/app-controller.test.mjs`
- Test: `apps/energetico-mobile/tests/chat-view.test.mjs`

- [ ] Write failing tests for count/date summary when the selected date has no options.
- [ ] Run focused tests and confirm failure.
- [ ] Add the summary while preserving the expand-to-all-dates behavior.
- [ ] Run focused tests and the full suite.

### Final verification

- [ ] Run `pnpm guard:signature-gestures`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm build`.
- [ ] Review the diff for protected-block changes and publish the branch.
