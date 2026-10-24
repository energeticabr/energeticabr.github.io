# Meal Voucher Tray Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Submit tray attachments once to the order and last launch, without false confirmation errors or technical codes in OBS.

**Architecture:** Preserve the existing posting/recovery coordinator. Move operation markers to a dedicated hidden column, normalize legacy records only inside the current operation, and verify uploads by bytes. Expose the authoritative controller tray to the local wizard.

**Tech Stack:** JavaScript, SharePoint Graph/REST, JSDOM, Node tests, Vite, Capacitor.

**Spec:** `docs/superpowers/specs/2026-10-23-meal-voucher-tray-design.md`

## Global Constraints

- Attach each file to PEDIDO and only the last LANÇAMENTOS row in this batch.
- No file picker in the OBS step; use the shared attachment tray.
- No technical operation/revision identifiers in persisted user OBS.
- Preserve idempotence, concurrency guards, ETags, partial recovery and IDFOLHA ownership.
- Do not modify protected signature blocks or real financial postings for QA.
- Publish validated code to web/Windows, Google Play internal and iOS TestFlight; verify each target explicitly.

## Review Focus

- Lost upload response or reopen before local progress was saved must not duplicate or reject identical bytes.
- Same file name with different content must fail without overwriting.
- A changed tray or session must invalidate confirmation rather than submit stale files.
- Legacy revisions and audit notes must remain recoverable, including Title-as-FILIAL.
- Multiple batches in an existing order must retain independent controls and add totals only once.

### Task 1: Correct posting, metadata and attachment reconciliation

**Files:** modify `apps/energetico-mobile/src/chat/meal-voucher-data.js`, `portal/data/sharepoint-repository.js`; create `apps/energetico-mobile/src/chat/meal-voucher-schema.js`, `apps/energetico-mobile/src/chat/meal-voucher-attachments.js`; test corresponding schema/attachment unit files and `tests/meal-voucher-data.test.mjs`.

**Interfaces:** `ensureMealVoucherSchema({repository,graph,assertSession,siteKey})`; export `MEAL_VOUCHER_CONTROL_COLUMN = 'VALECONTROLE'`. `getColumns(...,{includeHidden:true})` explicitly discovers hidden fields. `createMealVoucherAttachments({repository,assertSession})` prepares a content manifest and submits to explicit order/launch targets.

- [ ] Add RED tests using the real `{name}` metadata contract, identical/different content, lost response, only-last-launch delivery, clean OBS, migration, stale revision and missing/incompatible technical schema before financial writes.
- [ ] Run `node --test tests/meal-voucher-data.test.mjs tests/meal-voucher-schema.test.mjs tests/meal-voucher-attachments.test.mjs`; observe the expected missing behavior.
- [ ] Implement the minimal schema migration and hidden-column selection, technical control compatibility, stable last destination, and content-based reconciliation; preserve existing checks.
- [ ] Run all meal-voucher tests and root `node --test tests/sharepoint-repository.test.mjs`; expect zero failures.
- [ ] Commit the task with its tests.

### Task 2: Connect the wizard to the shared tray

**Files:** modify `src/app-controller.js`, `src/ui/meal-voucher-view.js`, `src/ui/meal-voucher.css`, `tests/app-controller.test.mjs`, `tests/meal-voucher-view.test.mjs`, browser fixtures/tests under `apps/energetico-mobile`.

**Interfaces:** `attachmentTray` supplied by the controller: `snapshot()`, `subscribe(listener)`, `pickFiles()`, `capture()`, `open(id)`, `remove(id)`, `read(snapshot,expectedFiles)`, `consume(snapshot)`. Sources carry stable IDs and source identity; only unsubmitted user files are eligible. View consumes files only after `data.post` succeeds.

- [ ] Add RED tests proving no OBS file picker, automatic tray inclusion, clip/camera actions, pending/failed upload blocking, changed-source/session rejection and exact successful cleanup.
- [ ] Run focused view/controller tests and observe expected failures.
- [ ] Implement the tray access and fixed bottom bar; freeze and recheck selection on review/confirm; preserve recovery metadata and success receipt if cleanup fails.
- [ ] Run focused controller/view and browser tests at 320/390px and desktop. Expect no overflow, no posting before confirmation, exact files and destinations.
- [ ] Commit the task with its tests.

### Task 3: Verify and publish

**Files:** verification evidence outside tracked product files; update browser fixture schema as required.

- [ ] Run signature guard, full app tests, web/PWA builds, iOS/secret verification and touched root tests on immutable final sources; record counts and any skips.
- [ ] Obtain independent whole-branch code review; fix important findings with RED/GREEN tests before integration.
- [ ] Push PR, verify CI, merge, verify main workflows for web/Windows, Android internal and TestFlight and open the published app.
- [ ] Report the root cause, completed behavior, release versions and verification limits.
