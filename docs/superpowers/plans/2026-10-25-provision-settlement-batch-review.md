# Provision settlement batch review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-line quantity/unit-price confirmation after description selection with one editable table and an explicit batch submit.

**Architecture:** Extend the existing grouped Python coordinator, retaining its final commit/journal. Add a typed optional detail table to existing polls and a small shared responsive renderer; normal reply controls drive all transitions.

**Tech Stack:** Python VM workflow, Decimal, unittest/pytest; JavaScript DOM/CSS, Node tests and browser fixtures.

**Spec:** docs/superpowers/specs/2026-10-25-provision-settlement-batch-review-design.md

## Global Constraints

- QTD × unit price + freight; preserve exact Decimal and unit precision.
- No writes before existing final confirmation, no unknown-to-zero coercion.
- Paid children read-only; preserve old drafts, blank-field review, common questions, attachments, ETags and durable retry.
- No dependency/schema/credential changes; signature guard14 intact.
- Fresh private backend source only; public exact diff/manifest excludes full source/config/records.
- Publish VM, web/Windows, Play internal and TestFlight; never settle real records as a UI test.

## Review Focus

1. Mixed paid/pending or invalid amounts: complete total, clear pending total, readonly paid rows and submit refusal (Task1 tests).
2. Stale/forged line IDs or changed links: no wrong-row edits and unchanged final concurrency protection (Task1 tests).
3. Edit/back/draft resume: preserve other entries and return to updated table, retain legacy unmarked drafts (Task1 tests).
4. Large groups and missing optional fields: no recursive silent per-line loop or skipped existing blank-field decisions (Task1 tests).
5. Narrow/long/hostile UI values: no page overflow, truncation, injected markup, duplicate table or dead reply button (Task2 tests).

## Task1: Durable grouped review and edit transitions

**Files:** Private candidate worker/provision_description_review.py (new table formatting), worker/provision_description_settlement.py, worker/workflow.py, channel_bridge.py. Public backend-patches/provision-settlement-batch-review/tests/test_batch_review.py and tests/test_deploy.py, package/deploy/README/verification.

**Interfaces:** Consumes existing grouped source/entries and existing edit/common/final-commit APIs. Produces detail_table contract from spec, `description_review_submit` and `description_review_edit` replies, dynamic `description_review` step and a versioned review marker on new groups.

- [x] Run current grouped query/settlement tests on the fresh baseline with synthetic connectors.
- [x] Write real-conversation tests: selection shows every row+grand total; submit reaches payment date without per-line numeric confirmations; edit asks line then field and changes only that row, returns table with updated total; no remote writes.
- [x] Run tests against baseline and observe missing-review failures, not import/setup failures.
- [x] Add the smallest versioned draft transition and table builder. Reuse existing edit selection; accept all valid quantities/prices once, retain blank-field prompts and final coordinator.
- [x] Add RED/GREEN cases for fractional prices/freight, paid/unknown rows, invalid/forged submit, stale IDs, legacy state, back/resume, large groups and final synthetic confirmation/retry.
- [x] Run focused plus historical coordinator tests. Generate a four-file hash-pinned package and exercise drift, scope, install and rollback using temporary directories.
- [x] Prepare the backend deliverable for the shared feature commit after evidence/review; no runtime deploy before review.

## Task2: Shared responsive table

**Files:** Create apps/energetico-mobile/src/ui/provision-settlement-review.js and .css; modify src/ui/chat-view.js and src/styles.css. Tests: provision-settlement-review.test.mjs, provision-settlement-review-browser.test.mjs, fixtures/provision-settlement-review.html.

**Interfaces:** Consumes only typed detail_table from Task1, using existing option buttons and reply handler. Produces a semantic4-column table with tfoot total and readable paid/freight/pending notes; no arithmetic or new mutation APIs.

- [x] Write failing real-renderer tests for rows/headers/footer, escaped product, unknown/paid display, preserved metadata and submit/edit reply events.
- [x] Observe RED, implement isolated renderer/hook/CSS, verify GREEN; invalid metadata keeps the original textual fallback.
- [x] Add browser checks at320/390/1024/1365px for table-only horizontal scrolling if needed, readable text and reachable controls. Visually inspect a fictitious preview.
- [x] Run focused UI/controller tests, full mobile suite, native/PWA builds, iOS and secrets checks, guard14; record every failure/conditional skip accurately.
- [x] Complete one fresh whole-branch review before the shared feature commit with this spec/plan and ledger. Fix Important/Critical in one verified RED/GREEN pass, no automatic re-review loop.

## Task3: Publish and verify one revision

**Interfaces:** Same reviewed source tree and exact VM manifest; existing release workflows.

- [ ] PR/CI and merge with matched head; verify no main drift changed the tested tree.
- [ ] Exact VM check then backup/deploy to production and mirror; verify health/hash and synthetic read-only prompt, no real payment.
- [ ] Main-push Pages/Android/iOS workflows only once. Confirm Pages+actual app boot/new bundle, Play internal commit and Apple processed internal build association.
- [ ] Record private evidence and sanitized PR release notes; retain user data and recoverable backups; deliver concise result and fictitious screenshot.
