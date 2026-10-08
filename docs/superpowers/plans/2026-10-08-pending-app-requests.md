# Pending app requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Independent backend and media slices may run in parallel under dispatching-parallel-agents.

**Goal:** Finish and publish the user's unexecuted frontend requests, with a verified inventory of historical requests.

**Architecture:** Reuse gallery loaders and shared footer styling; serialize payment fields from SharePoint column metadata. Summary viewing receives a semantic layout option without resizing the source image. Backend has a separate deployment plan.

**Tech Stack:** JavaScript, CSS, Node test runner, browser layout fixtures, Capacitor, GitHub Actions.

**Spec:** docs/superpowers/specs/2026-10-08-pending-app-requests.md

## Global Constraints

- No real financial records in QA.
- Preserve all unrelated tracked and untracked changes.
- Signature guard: 14 blocks intact.
- Publish web/Windows, Android internal, iOS TestFlight only.
- Preserve gallery filters and original media bytes.

## Review Focus

- Text-backed numeric fields must retain locale-independent decimal values; test actual metadata.
- Lost create response must not generate a second financial item; test recovery.
- Long product names and large totals must fit a 320px screen; layout fixture.
- Manual refresh while editing or after session change must not discard a draft or show stale data; gallery tests.
- Tall summaries and orientation changes must remain readable without changing ordinary photo fitting; media fixture.

### Task 1: Fix payroll payment payload

**Files:** src/chat/payroll-payment-data.js; tests/payroll-payment-data.test.mjs.
**Interfaces:** createPayrollPaymentData().save(draft,{operationId}) keeps its signature and selection identity.

- [ ] Add tests for text-backed VALORUNITARIO/QTD/IDFOLHA/IDLANCAMENTO, numeric metadata, saved-item verification and lost-response recovery.
- [ ] Run node --test tests/payroll-payment-data.test.mjs; observe new failures.
- [ ] Serialize by actual column metadata in create and recovery paths; prevent a second create after uncertain submission.
- [ ] Run the same tests; expect all pass.
- [ ] Commit scoped files.

### Task 2: Align action footers

**Files:** src/ui/gallery-record-actions.css; relevant payroll/task footer CSS; tests/payroll-payment-layout.test.mjs and layout fixtures.
**Interfaces:** Shared .dynamic-form-actions and matching cancel/submit footer classes; no action-handler changes.

- [ ] Assert cancel touches the left and submit the right footer edges at 320/390/1024/1365 widths, including create/edit payroll forms.
- [ ] Run the affected layout tests; observe failures.
- [ ] Apply consistent flex alignment and right margin pushing, retaining minimum touch sizes and wrapping safety.
- [ ] Run focused layout tests; expect pass.
- [ ] Commit scoped files.

### Task 3: Launch amount cluster

**Files:** src/ui/launch-gallery-view.js; src/ui/launch-gallery.css; applicable shared card CSS; tests/launch-gallery-layout.test.mjs.
**Interfaces:** recordActions.render(item) retains pencil/delete callbacks and native media rail.

- [ ] Add layout assertions: amount cluster left of pencil; real status below controls; no overflow with long names/amounts.
- [ ] Run layout tests; observe failures.
- [ ] Move total into actions/header cluster, move status into its prior place.
- [ ] Run launch/gallery tests; expect pass.
- [ ] Commit scoped files.

### Task 4: Refresh every gallery

**Files:** src/ui/gallery-create-shortcut.js or dedicated gallery-refresh.js; the seven *gallery-view.js families; tests/gallery-refresh.test.mjs and relevant layout fixtures.
**Interfaces:** attachGalleryRefreshButton({document,root,container,onRefresh,isAvailable}) returns destroy(); existing loaders remain authoritative and receive forced refresh where caches exist.

- [ ] Test every gallery exposes refresh, reads current data, preserves filters, coalesces busy clicks and cleans listeners.
- [ ] Run tests; observe missing-button failures.
- [ ] Reuse existing refresh controls or attach one visible button outside collapsed filters and call only the current loader.
- [ ] Run refresh + toolbar regressions; expect pass.
- [ ] Commit scoped files.

### Task 5: Readable tablet summary viewer

**Files:** src/web/attachment-preview.js; attachment-preview.css; src/app-controller.js (only media-summary routing); tests/attachment-preview.test.mjs and summary-layout fixture.
**Interfaces:** viewer.open(blob,fileName,{layout:'flow-summary',...existingOptions}); ordinary media defaults unchanged.

- [ ] Test tall summary fills tablet width with vertical scrolling, ordinary photos remain fitted, return/share behavior unchanged.
- [ ] Run focused tests; observe new failure.
- [ ] Add summary-only layout option and filename fallback for generated resumo-* PNGs; preserve pinch zoom and source bytes.
- [ ] Run media/controller regressions; expect pass.
- [ ] Commit scoped files.

### Task 6: Reconcile, review and publish

- [ ] Audit every historical request; document confirmed code/release and any missing migrations.
- [ ] Run pnpm test, native build, PWA build, signature guard, portal tests and secrets scanner; inspect actual output.
- [ ] Visually inspect synthetic phone/tablet/Windows fixtures.
- [ ] One independent whole-branch review; important fixes RED to GREEN and full green suite.
- [ ] Rebase onto the verified PR356 merge, then PR/CI/merge/publication with exact head SHA and all three platform evidence.
