# Single launch order supplier implementation plan

> **For agentic workers:** Use superpowers:executing-plans. Execute without approval pauses as explicitly requested by the user.

**Goal:** After choosing the supplier of a single launch, ask whether its new order uses the same supplier; allow a different supplier while preserving launch payroll ownership.

**Architecture:** Reuse the existing supplier-pending-check step as a persisted subquestion. Keep step indexes and configuration unchanged for active conversations. Store the order-only supplier outside financial launch fields; override only the related new-order payload. Existing orders and multiple launches retain their behavior.

**Tech Stack:** Python WorkflowEngine, existing SharePoint catalog and shared channel renderer.

**Spec:** The user's 2026-11-03 request and two attached screenshots.

## Global constraints

- Payroll eligibility, IDFOLHA, pending provisions, branch recommendations and launch supplier remain attached to the launch supplier.
- Use the full existing supplier catalog with filtering; preserve attachments and navigation.
- Never modify business records during verification or protected signature blocks.
- Publish the shared backend for Android, iOS and Windows/web; client binaries are unnecessary if the existing protocol suffices.
- Production and build mirror differ. Preserve the mirror and patch only pinned active source files.

## Review focus

- Replayed controls after supplier changes must not select a different supplier.
- Filtering an exact numeric ID must remain a search.
- A same-supplier answer after a previous alternate choice must discard that alternate.
- Back/reopen and legacy states must preserve drafts and step numbering.
- Order supplier must never leak into payroll contractor metadata or an existing order.

## Task 1: Workflow and tests

- [ ] Add failing behavioral tests against the production snapshot with synthetic fixtures: same/different supplier, filters/clear/empty, independent pending provisions and payroll payload, scope, stale controls, navigation and summary.
- [ ] Run RED, implement the subquestion and order-only payload override in `worker/workflow.py`, run GREEN and relevant backend regression comparisons.
- [ ] Archive a narrowly scoped patch, tests and release evidence in `backend-patches/single-launch-order-supplier/`.

## Task 2: Review and publish

- [ ] Obtain independent review and address meaningful findings with RED/GREEN tests.
- [ ] Verify mobile protocol rendering with fictitious data and signature guard.
- [ ] Commit and integrate the reviewable package. Install active source with hash pins, backup, shared deployment lock, health checks and rollback; do not synchronize the divergent mirror.
- [ ] Independently confirm installed hashes and service health; report shared availability on all three platforms.
