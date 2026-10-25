# INSS FGTS Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the employee register/gallery integration and audit/complete the
authorized INSS/FGTS operations without financial assumptions or duplicate records.

**Architecture:** Rebase only the missing feature from PR556 onto current main;
preserve shared Graph/REST adapters and separate live/mirror workflow variants.
Use target-only RH data, narrowly scoped source status actions and durable recovery.
Parent owns real-data operations and publication; workers use synthetic data only.

**Tech Stack:** JS/Node/Graph/SharePoint REST, Python workflow engine, Capacitor,
Power Automate and existing authenticated service.

**Spec:** `docs/superpowers/specs/2026-10-24-inss-fgts-completion-design.md`

## Global Constraints

- FUNCIONARIOSRH: 27 explicit fields; IDFORNECEDORORIGEM unique/indexed.
- Eight roles; cargo/admission for every EMPREITEIRO=SIM; discharge required on
  linked inactivation, with date-only semantics and no source RH columns.
- Only future registrations automatically; historical bootstrap is a separate
  parent-owned one-off, limited to the seven explicitly requested people.
- No blind retry, broad import, source attachment fallback, scope/ACL changes,
  financial allocation assumptions or real QA records.
- Do not edit any protected signature block or remove recent app/backend fixes.
- Parent alone deploys, merges, operates real data and publishes all three platforms.

## Review Focus

- Partial source/destination saves and 412 must recover across page recreation.
- Actual Graph/REST source readbacks must stay field-restricted.
- Missing files, uncertain creation or pre-cutover sessions must not duplicate or import.
- Wrong/ambiguous employee or month must not acquire a payroll link.
- Shared-file integration must preserve the current scanner, filters and binary menus.

### Task 1: Employee gallery and linked lifecycle editor

**Files:** New contractor-employment data/view/CSS and portal form/store/helper;
integrate app-controller.js, chat-view.js, main.js, web/main.js, browser-auth.js,
portal/forms/entity-submit.js and portal/ui/item-detail.js. Add restricted optional
readback to portal/data/sharepoint-repository.js and focused tests in both trees.

**Interfaces:** `createContractorEmploymentData(options)` wraps
`createContractorEmploymentStore(options)`; `createContractorEmploymentView(root,
options)` integrates kind `contractorEmployment`, action `action_hr_gallery_funcionarios`.
Target schema and source STATUS protocol match the spec; no backend API is added.

- [ ] Reproduce missing menu/default factory wiring and the actual-adapter source
  readback/partial-412/recreated-editor failures with synthetic transport tests.
- [ ] Bring forward feature-only changes from ce4097db; implement the scoped
  adapter readback and explicit durable recovery without altering other editors.
- [ ] Test destination pagination/search, all 27 fields, audit metadata, eight roles,
  invalid dates/cancel/no-link paths, safe recovery and session/account boundaries.
- [ ] Run focused tests, signature guard, relevant root tests and PWA/native builds;
  parent runs the complete repository command at the integrated final tree.
- [ ] Commit only owned app/portal/tests files, report RED/GREEN and review the diff.

### Task 2: Backend future-registration integration and guarded package

**Files:** `backend-patches/contractor-employment-register/` (rebased package/tests),
private captured app/mirror candidate workflow/config/modules in the parent output.

**Interfaces:** `contractor_employment.register_from_submission(client,supplier_id,
fields,files,state_store=...)`; supplier_registration_checkpoint positive flow and
first-POST receipts. Install exactly workflow.py, workflow_config.json and the two
new helper modules in each independent root (8 explicit destinations).

- [ ] Test captured engine RED: all SIM links reach eight roles and admission;
  sessions with old menu/indices do not skip required data or gain cutover proof.
- [ ] Adapt only the original scoped worker changes to the fresh captured variants;
  preserve unrelated code/config, especially homologação/WhatsApp and posting fixes.
- [ ] Exercise real engine/client/media/state store with synthetic HTTP: one source
  and RH POST, no source reads for future RH creation, frozen/reuploaded files,
  uncertain creation/restart and complete destination readback.
- [ ] Provide reproducible hash-pinned candidates/manifest and a check/apply rollout
  with both shared deployment locks, create-only helpers, backups and non-clobbering
  rollback. Do not deploy or access business records as a worker.
- [ ] Run the reused 77-test package plus adaptation guards on both candidates;
  rerun current homologação/WhatsApp behavioral tests with version-2 fixtures.
- [ ] Commit owned backend-patches files and report exact commands/results.

### Task 3: Parent-owned audit, bootstrap, monthly closure and publication

**Files:** Private audit/manifests/receipts under output/inss-fgts-completion-20261024;
sanitized public verification documentation; monthly flow artifacts only once their
inputs/connection contract is evidenced.

**Interfaces:** Consume the reviewed package, deployed target schema and existing
unique financial origin/competence contracts. Use GET-only audits before writes.

- [ ] Refresh and validate source/target/folha/financial schemas and paginated rows;
  enumerate every prior request, current receipt and remaining data dependency.
- [ ] Validate the seven authorized bootstrap identities/roles/admission dates,
  freeze the private manifest and execute target-only idempotent registration;
  verify all seven actual links without copying unrelated suppliers.
- [ ] Verify current INSS/FGTS competence and automatic posting paths with synthetic
  tests. Apply historical association only when individual source/amount/month is
  authoritative; otherwise record the exact blocking origin and required evidence.
- [ ] Inspect the Power Automate environment for an existing flow/connection and
  duplicate schedules. Prepare the requested day-01 flow, per-employee provisions
  and PDF path using confirmed salary/incidence rules; activate only after safe
  inputs and idempotent posting have been verified. Preserve existing aggregates.
- [ ] Complete task reviews and whole-branch review, run the repository command,
  signature guard and builds; merge and deploy the reviewed sources with receipts.
- [ ] Verify installed backend behavior, live gallery and each Windows/web,
  Play internal and TestFlight publication separately; report remaining blockers
  as blockers, not completed work, and give the exact decision/data required.
