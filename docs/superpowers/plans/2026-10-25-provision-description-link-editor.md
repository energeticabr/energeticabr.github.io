# Provision description link editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select and safely save another existing provision description in Edit provision.

**Architecture:** Add an optional column-preparation hook to the existing gallery data loader. The provision editor supplies a closed, fully paginated selector and persists relinks with both parent totals reconciled through its existing ETag/readback pattern.

**Tech Stack:** JavaScript ES modules, node:test, JSDOM, existing Vite/Capacitor release workflows.

**Spec:** docs/superpowers/specs/2026-10-25-provision-description-link-editor-design.md

## Global Constraints

- Use label Descritivo da provisão and store the actual positive text ID.
- Preserve supplier, branch, IDFOLHA, provision ID and attachments on link-only edits.
- No new descriptions, financial settlements, schema or signature-gesture changes.
- Recalculate old/new totals; reject missing targets, stale links and incomplete pages before writes.
- Use fictitious data for saving tests; publish Android internal, iOS TestFlight and Windows/web.

## Review Focus

- Retrying after the child move but failed parent synchronization must not repeat the child write.
- A stale editor must not steal a provision moved to a third parent in another session.
- A missing/newly deleted target or incomplete catalog must not create a dangling link.
- Moving a sole child must zero its old parent, including fractional quantity/freight totals.
- Existing amount/date edits and locked supplier/branch fields must remain unchanged.

### Task 1: Description selector and synchronized relink

**Files:** Modify `portal/forms/provision-payment-edit.js`, `apps/energetico-mobile/src/chat/orders-gallery-data.js`, `apps/energetico-mobile/src/chat/gallery-record-data.js`, `apps/energetico-mobile/tests/provision-payment-edit-integration.test.mjs`; add focused fixture/UI tests as needed.

**Interfaces:** `createProvisionPaymentEditor().prepareColumns({columns,rawColumns,item,signal})` supplies selector metadata. `createGalleryRecordData({prepareEditColumns})` awaits this optional hook after resolving form columns. Existing `save({list,item,fields,signal})` validates and reconciles the new link. No changes to `saveEditor(context,fields,options)` callers.

- [ ] Write failing integration tests for selector/current value/pagination, source and target totals, sole-child and unlinked cases, missing/invalid targets, stale links and partial-save retry.
- [ ] Run `node --test tests/provision-payment-edit-integration.test.mjs`; expect new behavior assertions to fail against the blocked link.
- [ ] Implement selector and minimum safe relink behavior while retaining the amount/date path.
- [ ] Run focused integration/gallery tests; expect all pass. Check fictitious selector at 390px and 320px.
- [ ] Run `pnpm guard:signature-gestures`, `pnpm test`, `pnpm build`, `pnpm build:pwa`; expect intact protected blocks and passing suites/builds.
- [ ] Commit, obtain independent whole-branch review, fix important findings with RED/GREEN tests, then push/PR/CI/merge.
- [ ] Publish and independently verify the same revision in web/Windows, TestFlight and Google Play internal; open the live editor without saving a real relink.
