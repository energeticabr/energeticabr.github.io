# Multiple Document Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register successive documents while reusing editable context and isolating each persisted row and attachment.

**Architecture:** Add a focused backend document_batch module and narrow WorkflowEngine hooks. Existing single-document form, validation, summary and attachment handling remain authoritative. Durable row checkpoints protect retries and restored drafts.

**Tech Stack:** Python workflow engine, existing SharePoint client, Node test runner and existing chat view.

**Spec:** docs/superpowers/specs/2026-10-21-multiple-document-entry.md

## Global Constraints

- Single path and signing/existing-item attachment paths unchanged.
- One DOCUMENTOS item and fresh attachment set per document.
- Existing gesture locks immutable; no private config, data or credentials in Git.
- Server-side behavior shared by Android, iOS and Windows/web.
- Execute inline without approval pauses per the user's standing instruction.

## Review Focus

- Unknown POST outcome must reconcile without another POST.
- Restored draft and stale menu cannot overwrite or recreate an already submitted row.
- Context edits must invalidate dependent fields, not retain unrelated person's contract/property.
- Embedded type registration must return to the same multi-document row and attachments.
- Cancellation/back/reconnect must not return to an editable previously submitted document.

### Task 1: Entry and repeated context

**Files:** backend-patches/multiple-document-entry/{document_batch.py,patch_backend.py,tests/test_document_batch.py}

**Interfaces:** patch_backend.apply(source, candidate) returns a patched private snapshot. document_batch.start/handle_text/resend/after_fields/confirmation/commit are called by narrow WorkflowEngine hooks.

- [ ] Write tests against the real engine for entry mode, unchanged single path, add/finish, isolated attachments, editable defaults, dates and dependency invalidation.
- [ ] Run against baseline and observe missing mode/continuation failures.
- [ ] Implement document_batch and guarded patch hooks. Reuse existing form processing.
- [ ] Run focused tests; all pass. Commit feature and spec/plan.

### Task 2: Durable safety and deployment package

**Files:** same module/tests; backend-patches/multiple-document-entry/{package.py,deploy.py,tests/test_deploy.py,README.md,source.patch,deploy-manifest.json}

**Interfaces:** Row checkpoints use state_store.load/save; deployment uses exact source pins and existing trusted installer.

- [ ] Reproduce unknown POST, attachment/verification failure, stale draft, cancellation, reconnect, and embedded registration using controlled external boundaries.
- [ ] Watch failures, implement checkpoint freeze/reconciliation and guard transitions, then run all backend tests and root suite.
- [ ] Add exact-file package and installer tests for drift, backup/rollback and candidate validation.
- [ ] Generate private bundle and public source diff; no secrets or business records. Commit.

### Task 3: Review, verify, publish

**Files:** local synthetic chat fixture and backend-patches/multiple-document-entry/verification.md.

**Interfaces:** Use public chat messages emitted by the tested backend and existing client renderer.

- [ ] Validate actual chat on desktop and mobile viewport without real SharePoint writes.
- [ ] Fresh independent whole-branch review; fix important findings RED/GREEN.
- [ ] Full root tests, backend tests, signature guard and applicable builds pass.
- [ ] Push PR, merge exact verified tree, deploy same backend with drift checks and recoverable backup.
- [ ] Verify health, installed hashes and all client compatibility; verify actual web publication. Native releases only if native/client code changes require them.
