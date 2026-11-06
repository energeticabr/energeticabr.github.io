# Payment Type Registration Implementation Plan

> Execute inline with superpowers:executing-plans, following the user's direct-execution instruction.

Goal: Offer inline payment-type registration backed by SharePoint on all existing clients.
Architecture: Extend financial_catalog_registration.py with isolated payroll catalog helpers; hook workflow.py payment prompts, selection and active draft navigation; use protected deployment for exactly those two live files.
Spec: docs/superpowers/specs/2026-11-06-payment-type-registration-design.md

## Constraints and review focus
Preserve financial fields, pending rows, attachments, draft tokens, shared/individual assignment and retry checkpoints. Check empty names, normalized duplicates, unavailable SharePoint, delayed controls, repeated saves, cancelled drafts and catalogs exceeding a page. No new binary is needed when only the backend changes.

## Task 1: Catalog and inline registration
- Write behavioral tests for actual WorkflowEngine with synthetic SharePoint, proving first button, catalog data, create/confirm/cancel, uniqueness, pagination, context preservation and custom type selection in shared/individual mode.
- Watch feature tests fail against the current snapshot.
- Add isolated helpers in worker/financial_catalog_registration.py and minimal hooks in worker/workflow.py through a reproducible patcher.
- Pass targeted behavioral tests and run preserved related payroll/default tests where applicable.

## Task 2: SharePoint and protected release
- Add idempotent list/schema/seeding script with readback and exact list scope; verify against synthetic requests then execute on server.
- Adapt the existing pinned installer, gate and regression checks to current baseline/mirror hashes and two-file scope. Run installer tests.
- Review final diff; verify signature lock and responsive synthetic UI at 320/390/1200px.
- Commit, push, create PR, pass CI, merge, deploy with backup/gate/rollback, rerun behavioral checks against installed source and verify live SharePoint options and health.
- Record publication evidence for Android/iOS/Windows shared backend.
