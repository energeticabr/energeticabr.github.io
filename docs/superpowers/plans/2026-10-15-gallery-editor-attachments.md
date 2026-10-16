# Gallery Editor Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show and stage existing attachments in every gallery editor, persist removals only on submit, and style editor field titles red/white.

**Architecture:** Reuse the portal dynamic form's attachment draft for shared gallery editors, with a context-bound SharePoint attachment service and resumable save sequence. Preserve special IDFOLHA and custom launch editor paths while extending their staging behavior. Scope CSS to editors.

**Tech Stack:** JavaScript ES modules, SharePoint repository, Node test runner, jsdom, CSS, Vite.

**Spec:** `docs/superpowers/specs/2026-10-15-gallery-editor-attachments-design.md`

## Global Constraints

- Never change signature gesture locked blocks; run `pnpm guard:signature-gestures` before mobile edits.
- X and Restaurar are draft-only; no delete request before SUBMETER/confirmation.
- Preserve IDFOLHA receipt rule and launch gallery's existing attachment upload flow.
- Publish validated revision to web, Google Play internal and TestFlight.

## Review Focus

- Attachment list read failure must not silently masquerade as an empty list.
- Saving fields followed by attachment failure must not repeat field writes on retry.
- Cancel after marking a deletion must leave SharePoint untouched.
- An existing filename replaced concurrently must not be silently removed.
- Mobile editor must keep every title readable without horizontal overflow.

---

### Task 1: Shared form draft and presentation

**Files:** `portal/forms/form-attachments.js`, `portal/ui/dynamic-form.js`, `tests/powerapps-form-attachments.test.mjs`, `apps/energetico-mobile/src/ui/gallery-record-actions.css`

**Interfaces:** Existing `formAttachmentRowsMarkup` and `bindFormAttachments` gain a restore action; `renderDynamicForm(..., { attachments })` remains the host interface.

- [ ] Add failing markup/binding tests: X marks an existing file, row remains visible with Restaurar, restoring removes it from `changes().deletions`.
- [ ] Run focused tests and confirm expected RED.
- [ ] Implement minimal restore UI and red/white field-title CSS scoped to gallery editors.
- [ ] Run focused tests and confirm GREEN.

### Task 2: Shared gallery data persistence

**Files:** `apps/energetico-mobile/src/chat/gallery-record-data.js`, `apps/energetico-mobile/src/ui/gallery-record-actions.js`, `apps/energetico-mobile/tests/gallery-record-data.test.mjs`, `apps/energetico-mobile/tests/gallery-record-actions.test.mjs`

**Interfaces:** `loadEditor` exposes context-bound attachments; `saveEditor(context, fields, { attachments, signal })` persists staged changes with resumable progress.

- [ ] Add failing tests for list display, no deletion on cancel/X, deletion on submit, same-item binding, retry after partial failure, and attachment-only save.
- [ ] Run focused tests and confirm RED.
- [ ] Implement context loading, form attachment options and safe save/verification.
- [ ] Run focused tests and confirm GREEN.

### Task 3: Special editors

**Files:** `apps/energetico-mobile/src/ui/payroll-sheet-attachments.js`, `apps/energetico-mobile/src/chat/payroll-sheet-attachments.js`, `apps/energetico-mobile/src/ui/launch-gallery-view.js`, `apps/energetico-mobile/src/ui/launch-gallery.css` and their tests.

**Interfaces:** Sheet binding returns staged uploads/deletions; launch editor uses existing `request('attachment_delete', { id, fileName })` only after confirmation.

- [ ] Add failing tests for sheet X/restore and STATUS INATIVO guard, plus launch X/restore/review/commit.
- [ ] Run focused tests and confirm RED.
- [ ] Implement minimal changes without changing existing uploads or field-save semantics.
- [ ] Run focused tests and confirm GREEN.

### Task 4: Integration and publication

**Files:** No further product files unless tests expose defects.

- [ ] Verify provision cluster location after DATAEXECUCAOAGENDAMENTO and responsive title styling.
- [ ] Run full test suite, web/PWA builds, signature guard, secrets check and diff check.
- [ ] Commit, push, create PR, merge after green CI, and verify web/Android internal/TestFlight delivery on the merged SHA.
