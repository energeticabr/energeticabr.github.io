# Provision Parent and Multiple Products Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add single/multiple provision selection, successive lines and one verified idempotent SharePoint parent per provision group.

**Architecture:** Extend the existing VM payment flow, with provision-specific state rather than reusing launch persistence. A small pure Python module computes parent fields and the public snapshot. The mobile app consumes activeFlow.provisionLines and renders a collapsed summary.

**Tech Stack:** Python WorkflowEngine, SharePoint REST, JavaScript/Vite/Capacitor, Node tests and Python unittest.

**Spec:** docs/superpowers/specs/2026-10-08-provision-parent-multiple-design.md

## Global Constraints

- Never edit SIGNATURE_GESTURE_LOCK blocks or fingerprints.
- Parent list DESCRITIVOPROVISAO; child list PROVISÃO PGTOS; child link DESCRITIVOPROVISAO is text.
- Parent payment/agendamento fields are null, not empty date strings.
- Keep child unit values unchanged; aggregate QTD × unit value + freight exactly.
- Do not submit fictitious records to live SharePoint.
- Existing user instruction authorizes implementation, merge and publication without design approval pauses.

## Review Focus

- Interrupted creation after parent or one child must resume without duplicates.
- Existing single-flow drafts started before the new type question must remain usable.
- Changing branch must not preserve an incompatible property.
- Distinct suppliers must not silently choose a reference.
- Lost attachment or malformed numeric input must not yield false success or a partial group presented as complete.

### Task 1: Pure parent fields and public snapshot

**Files:** local VM candidate worker/payment_provision_group.py; tests/test_payment_provision_group.py.
**Interfaces:** provision_line_total(fields) -> Decimal; provision_parent_fields(lines, reference_supplier=None) -> dict; provision_preview(state) -> dict or None. lines are full snapshots containing fields, answers, selections and display_values. Missing reference with multiple distinct suppliers raises ValueError.

- [ ] Write tests for qty 2 at 10.50 plus freight 1.25 = 22.25, two lines = 44.50, exact 0.1+0.2, null dates, all first-line parent fields, distinct suppliers and malformed numbers.
- [ ] Run unittest and confirm expected RED; implement pure functions; run GREEN.
- [ ] Snapshot tests assert canonical amounts, escaped-at-render data contract, correct supplier detail and no preview in unrelated flows.

### Task 2: VM composition and idempotent group commit

**Files:** local VM candidate worker/workflow.py, worker/workflow_config.json, channel_bridge.py; new focused workflow/portal tests.
**Interfaces:** state.flow remains payment; state.provision_lines stores snapshots; state.answers.tipo_provisao_pagamento stores UNICO or MULTIPLOS. activeFlow.provisionLines uses Task 1.

- [ ] Add RED tests proving type precedes due date, single continues current questions, multiple offers add/variation, inheritance and branch dependency validation.
- [ ] Implement composition, reference supplier choice, resume/navigation and original first-line root metadata.
- [ ] Add RED tests for parent payload, child IDs, confirmed verification, attachment handling, failures after parent/first child, retry idempotency and old-draft compatibility.
- [ ] Implement dedicated commit through ensure_item(..., merge_existing=False), persisted progress and verify_item for all records before success.
- [ ] Expose provisionLines in portal active-flow projection and include group state in context identity.
- [ ] Run focused tests, then complete Python suite in DRY_RUN with current live-source baseline.

### Task 3: Collapsible mobile summary

**Files:** apps/energetico-mobile/src/chat/provision-snapshot.js, conversation-store.js, src/ui/chat-view.js, src/styles.css; focused Node/browser tests.
**Interfaces:** normalizeProvisionSnapshot(value) validates Task 1 contract; state.activeFlow.provisionLines carries the immutable result.

- [ ] Write and run RED tests for response normalization, malformed amounts, unrelated flow behavior and summary before sending controls.
- [ ] Render collapsed Total da provisão and line count; expand supplier/product/quantity/unit/freight/total and other fields.
- [ ] Preserve disclosure state across re-renders and existing launch/measurement rendering; no unsupported edit/delete controls.
- [ ] Verify 390x844, 1024x768 and desktop layouts, focused tests and full pnpm test.

### Task 4: Integrated verification and publication

**Files:** local deployment script and artifacts; public spec/plan and frontend changes only.

- [ ] Review implementation independently; address important findings with RED/GREEN tests.
- [ ] Run signature guard, Python/Node full suites, native/PWA builds, iOS verify and secrets scan.
- [ ] Deploy only changed VM files with pinned baseline hashes, backup, lock, rollback and service/health confirmation.
- [ ] Open actual app, confirm type question and multiple summary without submitting real payment records; save screenshot proof.
- [ ] Commit/push, create PR, attach PR, require green checks and pinned merge.
- [ ] Verify Pages deployment, Google Play internal commit and TestFlight VALID/READY_FOR_BETA_TESTING/ATTACHED.
