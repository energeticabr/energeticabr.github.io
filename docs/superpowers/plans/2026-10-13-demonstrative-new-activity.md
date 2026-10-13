# Demonstrative new activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create an activity inside the current demonstrative and automatically continue with it selected.

**Architecture:** Reuse the confirmed hr_activity_registration child flow, preserving the parent snapshot and any outer return. Add a scoped terminal action dynamically, without editing root-specific configuration.

**Tech Stack:** Python WorkflowEngine, SharePoint connector boundary, shared channel bridge.

**Spec:** docs/superpowers/specs/2026-10-13-demonstrative-new-activity.md

## Global Constraints

- Exact label: "➕ CRIAR NOVO DEMONSTRATIVO ETAPA".
- Child target: ATIVIDADE EXECUTADA. Parent target: DEMONSTRATIVOETAPA.
- FILIAL and ETAPA are inherited, not new questions or editable child context.
- Do not submit real test activities, demonstratives or presences.
- Preserve protected signature blocks and root-specific configurations.
- Publish to the shared backend consumed by Android, iOS and Windows.

## Review Focus

- Empty activity catalog must still offer creation.
- A demonstrative already nested inside attendance must retain its outer return.
- Cancelling or navigating back must preserve the parent and not create a record.
- A failed or duplicate child submission must not advance the parent or duplicate writes.
- Editing child confirmation must not change inherited FILIAL or ETAPA.

### Task 1: Embedded activity creation and automatic continuation

**Files:**
- Modify private candidate worker/workflow.py; ship as backend-patches/demonstrative-new-activity/source.patch.
- Create backend-patches/demonstrative-new-activity/test_demonstrative_new_activity.py.
- Create package.py, deploy.py and deploy-manifest.json in that directory.
- Record validation in artifacts/demonstrative-new-activity-20261013/verification.md.

**Interfaces:**
- Consumes _selection_options, _start_embedded_launch_registration, _apply_selected_option, _notify_completed and _restore_embedded_supply_ancestor.
- Produces scoped action start_embedded_demonstrative_activity_registration and return type demonstrative_activity_registration.

- [x] Step 1: Write real-engine tests for menu ordering/empty catalog, creation/continuation, preserved fields/attachments/outer return, cancellation/back, duplicate/retry and locked inherited context.
- [x] Step 2: Run unittest test_demonstrative_new_activity -v against baseline on the VM sandbox. Expected: behavior failures because the new terminal action does not exist.
- [x] Step 3: Add the dynamic terminal action and scoped child start/restore handlers; use confirmed child item ID and description in atividade_demonstrativo_etapa.
- [x] Step 4: Run focused tests against candidate. Expected: all pass; compare full legacy suite against identical baseline and ensure no new failures/errors.
- [ ] Step 5: Review, package hash-pinned source, check backup/rollback deployer, publish both server roots and re-run installed-source tests.
- [ ] Step 6: Commit, create PR, merge and verify publication at the merged revision; preserve unrelated files and the user's signing draft.
