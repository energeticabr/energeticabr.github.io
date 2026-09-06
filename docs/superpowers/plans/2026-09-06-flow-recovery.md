# Flow Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover the last flow preview and unsent draft on authenticated PWA reopen without replaying writes.

**Architecture:** VM exposes bounded read-only summary rows and an opaque stable context in existing activeFlow metadata. A small account-scoped browser checkpoint stores only plain preview data and draft; the controller reconciles it with the current VM before restoring editable text. The existing compact chat, composer identity and inactivity rules remain unchanged.

**Tech Stack:** Python bridge, vanilla JavaScript, node:test, Vite, GitHub Pages.

**Spec:** ../specs/2026-09-06-flow-recovery.md

## Global Constraints

- No credentials, media URLs or file bodies in checkpoints.
- No automatic replay of writes. No changes to VM inactivity rules or auth storage.
- Account scope is homeAccountId; sign-out clears only that account.
- No added service or cost; use existing isolated worktree.

### Task 1: VM preview contract

**Files:** backend `scripts/channel_bridge.py` and its tests; guarded one-file deploy script.
**Interface:** Existing portal activeFlow gains contextId and rows[{label,value}].

- [ ] Write tests proving read-only summary, owner authorization, context stability on resume and change on batch/step/data.
- [ ] Run tests red; add bounded projection via existing engine._progress_summary_rows on a copy.
- [ ] Run channel bridge, attachment and transport tests locally and on Linux with fake state.
- [ ] Review and deploy only bridge behind baseline hash, backup, health and unauthorized checks.

### Task 2: Browser checkpoint and reconciliation

**Files:** new `src/web/recovery-storage.js` (including bounded checkpoint projection); modify store, controller, main, lifecycle, view, CSS; new `tests/recovery.test.mjs`.
**Interface:** createRecoveryStorage({storage,delayMs}) -> read(accountId), schedule(accountId,snapshot), flush(), clear(accountId). Controller optional recovery service; flushRecovery() lifecycle hook.

- [ ] Tests red: write a draft, stop real controller, construct another with same persistent storage; assert preview appears before network and draft returns only on same VM context.
- [ ] Tests red: different account, corrupt storage, storage exceptions, changed context, uncertain send, pending files, completed flow, sign-out and late response, hide/close flush.
- [ ] Implement plain bounded checkpoint projection, delayed persistence, controller reconciliation, read-only expandable preview and explicit recover/dismiss actions.
- [ ] Verify preview markup escapes text, does not contain old reply buttons, and draft typing preserves textarea/IME behavior.
- [ ] Run mobile test suite and production PWA build.

### Task 3: Integration and publication

- [ ] Add local UI fixture reopening with persisted storage and slow fake VM; inspect 390px viewport and full reload.
- [ ] Review diff, fix findings; run repository suite from clean staged export (existing unrelated empty OneDrive directory excluded).
- [ ] Deploy backend then frontend using current main baseline; verify Pages completion and freshly downloaded JS/CSS hashes.
- [ ] Report actual result and boundary: selected-but-unsent files must be selected again; local preview depends on browser storage.

### Task 4: Durable VM draft catalogue (new user request)

**Files:** backend `worker/workflow.py`, supporting draft module and focused tests.
**Interfaces:** reply_id draft_menu, draft_resume:<batch_id>, save_draft_main_menu. Results draft_saved:true/draft_resumed:true. Existing public activeFlow context identifies local unsent text.

- [ ] Test save-before-exit, idempotent count, menu selection, exact resume fields/attachments and isolation per conversation.
- [ ] Add durable catalogue in existing state_store with ETag; preserve active state on catalogue failure and catalogue on resume failure.
- [ ] Add save option through central question/list methods, main menu count, exits including inactivation choices without weakening busy guards.
- [ ] Test app sends only navigation command, keeps unsent text out of menu and restores it only with selected flow context.
- [ ] Review workflow/retention changes and stage isolated Windows/Linux suites. Deploy guarded workflow/helper changes with backup and health verification.
