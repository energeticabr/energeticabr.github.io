# Provision settlement amount implementation plan

> Execute inline with executing-plans; use TDD and a final independent review.

**Goal:** Enter previously unknown provision amounts within settlement, choose the line for multi-line descriptions, and recompute the parent total on confirmation.

**Architecture:** Extend the existing complete-group query with an explicit settlement-only tolerant read. Keep ordinary reads strict. Reuse the existing quantity/unit-price review and durable parent/child settlement journal. Add a temporary line-choice step only for unknown-amount multi-line groups.

**Tech Stack:** Python VM workflow, SharePoint REST, pytest; shared by Android, iOS and Windows clients.

**Spec:** User request in this task: single child opens automatically; multiple children ask which line receives payment value; parent total equals the complete sum of linked lines.

## Constraints and review focus

- No financial writes before final confirmation; no synthetic zero for unknown values.
- Preserve paid children, attachments, retry journal, ETags, exact decimal arithmetic and unrelated local changes.
- Invalid paid-child totals must still block; pending unknown totals can be completed.
- Refresh source on selection and preflight; stale choices cannot target a different line.
- Child VALOR TOTAL is a unit price: preserve QTD × unit + FRETE semantics and explicit prompts.

## Task 1: Complete amounts in the existing settlement workflow

Files: private candidate worker/provision_description_query.py, clients.py, provision_description_settlement.py, workflow.py; public backend-patches/provision-settlement-amount/tests/test_amount_entry.py.

- [x] Write tests for single/multi unknown amount, line choice/filter, complete aggregate, paid invalid child, concurrent edits and retry.
- [x] Run tests against baseline and verify expected failures.
- [x] Add settlement-only fresh read, unknown-line choice and normal child review; keep original snapshots for concurrency.
- [x] Run focused and historical query/settlement regression tests, then full backend suite and report baseline limitations.
- [x] Package exact diff, hash-pinned backup/rollback deploy and documentation; commit after independent review.

## Task 2: Publish shared runtime

- [ ] Review patch scope and credentials exclusion; create PR and merge when checks pass.
- [ ] Deploy only pinned Python files to production and mirror with backups, restart and health verification.
- [ ] Confirm installed hashes and synthetic prompt behavior without mutating live financial data.

## Ledger

- Baseline origin/main 9532fc07; clean isolated fix/provision-settlement-amount-20261017 worktree. Protected signature guard: 14 blocks intact.
- Design: reuse existing amount entry rather than create a second money parser; normal draft/confirmation boundary remains unchanged.
- Task 1 complete: 110 focused tests passed; broader-suite limitations and baseline reproduction recorded in backend-patches/provision-settlement-amount/verification.md.
- Final review: independent Euclid found invalid paid-child guidance and stale line-choice refresh; both fixed with failing regression tests observed before fixes, then focused suite green.
- No deferred review findings. Deployment check verified four files and health ok.
