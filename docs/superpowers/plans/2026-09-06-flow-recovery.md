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

**Files:** backend `channel_bridge.py` and its tests; guarded one-file deploy script.
**Interface:** Existing portal activeFlow gains contextId and rows[{label,value}].

- [x] Write tests proving read-only summary, owner authorization, context stability on resume and change on batch/step/data.
- [x] Run tests red; add bounded projection via existing engine._progress_summary_rows on a copy.
- [x] Run channel bridge, attachment and transport tests locally and on Linux with fake state.
- [x] Review and deploy only bridge behind baseline hash, backup, health and unauthorized checks.

### Task 2: Browser checkpoint and reconciliation

**Files:** new `src/web/recovery-storage.js` (including bounded checkpoint projection); modify store, controller, main, lifecycle, view, CSS; new `tests/recovery.test.mjs`.
**Interface:** createRecoveryStorage({storage,delayMs}) -> read(accountId), schedule(accountId,snapshot), flush(), clear(accountId). Controller optional recovery service; flushRecovery() lifecycle hook.

- [x] Tests red: write a draft, stop real controller, construct another with same persistent storage; assert preview appears before network and draft returns only on same VM context.
- [x] Tests red: different account, corrupt storage, storage exceptions, changed context, uncertain send, pending files, completed flow, sign-out and late response, hide/close flush.
- [x] Implement plain bounded checkpoint projection, delayed persistence, controller reconciliation, read-only expandable preview and explicit recover/dismiss actions.
- [x] Verify preview markup escapes text, does not contain old reply buttons, and draft typing preserves textarea/IME behavior.
- [x] Run mobile test suite and production PWA build.

### Task 3: Integration and publication

- [x] Add local UI fixture reopening with persisted storage and slow fake VM; inspect 390px viewport and full reload.
- [x] Review diff, fix findings; run repository suite from clean staged export (existing unrelated empty OneDrive directory excluded).
- [x] Deploy backend then frontend using current main baseline; verify Pages completion and freshly downloaded JS/CSS hashes.
- [ ] Report actual result and boundary: selected-but-unsent files must be selected again; local preview depends on browser storage.

### Task 4: Durable VM draft catalogue (new user request)

**Files:** backend `worker/workflow.py`, supporting draft module and focused tests.
**Interfaces:** reply_id draft_menu, draft_resume:<draft_id>, save_draft_main_menu. Normal draft_id is batch_id; embedded flows also include the flow suffix. Results draft_saved:true/draft_resumed:true. Existing public activeFlow context and exact pending question identify local unsent text.

- [x] Test save-before-exit, idempotent count, menu selection, exact resume fields/attachments and isolation per conversation.
- [x] Add durable catalogue in existing state_store with ETag; preserve active state on catalogue failure and catalogue on resume failure.
- [x] Add save option through central question/list methods, main menu count, exits including inactivation choices without weakening busy guards.
- [x] Test app sends only navigation command, keeps unsent text out of menu and restores it only with selected flow context.
- [x] Review workflow/retention changes and stage isolated Windows/Linux suites. Deploy guarded workflow/helper changes with backup and health verification.

## Verification evidence

### Task 5: Multiple-launch expandable panel

- [x] Pure VM projection using existing Decimal line parser, correct first/current-line eligibility, current discount/freight fields, stable opaque batch id and authorized activeFlow response; no I/O or state changes.
- [x] Tests red/green for 60+ lines, fractional quantities, freight once, discount already applied, editing/deleting, inherited/incomplete current line and owner isolation.
- [x] Normalize the separate launch snapshot in the frontend store; render an accessible collapsible bottom panel with all requested fields, monetary strings supplied by the server and a shared height budget with attachments.
- [x] Preserve open/scroll by batch and textarea identity while typing; clear on menu/completion/logout, retain confirmed snapshot on failure, exclude launch rows from recovery storage.
- [ ] Full tests/build, 390px browser QA, root review and guarded VM/Pages publication with fresh asset checks. Independent review unavailable due agent usage limits.

### Completed verification

- Frontend code: f99aff7a65901bff60d51d5c56a232f1cceb7e22 and 344078df4f3dc888c66b9c1d1f0e1f2d6ba86bd7; Pages runs 34057418629 and 34058362996 succeeded. Fresh public asset SHA-256 values, HTML references and manifest content matched the local PWA build.
- Clean frontend repository export: 1,143 tests, 1,138 passed, 5 skipped, 0 failed. Recovery-specific suite: 15 passed. Browser QA used the real view/controller/storage at 390 × 844 with a simulated VM, including reload, delayed resume, typing identity, save and resume. No physical-iPhone test is claimed.
- Bridge preview installed SHA-256: b8f9e43ae9080c279881a14d6f89f29747f74aff235ff625aca0133c037951e0; backup /var/backups/energetica-whatsapp/portal-flow-preview-hswVtO. Health and unauthenticated snapshot rejection were verified.
- VM draft candidate: 471 legacy workflow tests, 43 new draft tests, 9 flow-summary tests, 2 summary-card tests, 61 bridge tests, 36 attachment tests, 2 transport tests and 3 Linux watchdog tests passed in isolated Linux storage (627 total). Independent review cleared the concurrency, completion and attachment-retention findings.
- VM drafts published: backup /var/backups/energetica-whatsapp/workflow-drafts-mrqfXk; workflow SHA-256 489705fc22242a9fee571daacb6a533bcb986b3c5913daaf506ab0d884fd23ec. Gateway reconnected; health ok; unauthorized snapshot returned 401.
- Launch panel: 208 app tests passed; clean repository export 1,151 tests, 1,146 passed, 5 skipped, 0 failed. Isolated Linux projection/bridge/attachments/transport/summary/drafts suites: 162 passed.
- Launch backend published: backup /var/backups/energetica-whatsapp/launch-preview-zIOAHA; bridge SHA-256 1aa3655c7fc4455840bb93edacacb038f797a7d22164a688e7b98dfc81406ae4; helper aba4e0f2778b7b63e0959f52af36faa0d10f7ee28e5de5a83f644f0a6a0e027f. Workflow unchanged; health ok; unauthorized snapshot 401; WhatsApp connected.
