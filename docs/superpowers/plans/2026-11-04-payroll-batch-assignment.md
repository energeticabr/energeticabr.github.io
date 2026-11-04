# Payroll batch assignment implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. The user explicitly requests autonomous implementation and publication.

**Goal:** Ask whether to assign payroll sheets and payment types individually or collectively when multiple payments remain.

**Architecture:** Extend the existing shared backend payroll stages in `worker/workflow.py`. Preserve per-payment IDs, eligibility, verified checkpoints, idempotency tokens and the frozen settlement guard. Use existing channel actions/options so Android, iOS and Windows/web receive the same behavior without new client binaries.

**Tech Stack:** Python WorkflowEngine, ChannelBridge, LocalStateStore; existing JavaScript app renderer.

**Spec:** User request and attached screenshot. Sheet collective assignment means one reference month resolved separately for each supplier; payment type means one exact type for all selected payments. The two mode choices are independent. One payment keeps the existing direct path.

## Global constraints

- Do not change protected signature blocks, financial records or stored conversations during installation.
- Preserve already answered sheets and verified FOLHAPGTO checkpoints on resumed drafts.
- Missing or ambiguous supplier/month sheets require an individual choice; never borrow another supplier's ID.
- Batch payment writes use existing tokens and save progress after each verified payment. Retry retains the chosen type.
- Publish shared backend with hash pins, backup, ingress drain, health checks and rollback.

## Review focus

- Multiple suppliers have different sheet IDs for the same month, including year boundaries.
- A supplier has no sheet or multiple sheets in the selected month.
- Old buttons, duplicate messages, resumed drafts and already verified payments.
- Failure after a batch write succeeds but before verification; retry without duplicates.
- Individual and collective modes can be combined independently; single-line behavior remains direct.

### Task 1: Backend behavior

**Files:** private baseline/candidate `worker/workflow.py`; public `backend-patches/payroll-batch-assignment/tests/test_batch_assignment.py` and `patch_backend.py`.

- [x] Write real ChannelBridge tests covering both modes, suppliers/months, persistence, invalid replies and retries.
- [x] Run against baseline and confirm expected missing-mode failures.
- [x] Add mode prompts inside the existing sheet/type stages. Resolve shared month independently and reuse verified per-line writes.
- [x] Run focused tests and compare full backend baseline/candidate failures.

### Task 2: Review, publish and verify

**Files:** public `backend-patches/payroll-batch-assignment/{deploy.py,deploy.sh,deployment_gate.sh,deploy-manifest.json,source.patch,README.md,verification.md}`.

- [x] Package only reviewed workflow changes with independent production/mirror hashes.
- [x] Exercise installer drift/rollback and actual app renderer with synthetic channel messages at 320/390 pixels.
- [x] Review the complete diff and fix material issues with reproducing tests.
- [x] Commit, push, merge and verify CI where applicable.
- [x] Deploy with ingress gate and verify installed digest, services and health; rerun focused tests using installed runtime.
