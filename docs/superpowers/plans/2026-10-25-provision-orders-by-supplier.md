# Provision orders by supplier implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline and request an independent code review before merge.

**Goal:** Complete grouped provision settlements with different suppliers safely.
**Architecture:** Partition pending entries by normalized supplier/branch in the existing Python coordinator, preserving legacy single-order journals. Freeze order plans before writes and reuse the existing child settlement writer.
**Tech Stack:** Python 3.9, unittest, SharePoint REST, hash-pinned backend installer.
**Spec:** ../specs/2026-10-25-provision-orders-by-supplier.md

## Constraints and review focus

- Never merge suppliers or branches into one order.
- No writes before final confirmation; no duplicate create after lost responses.
- Preserve legacy one-order token, paid rows, attachments and all linkage checks.
- Keep source snapshots and actual records private; publish only code diff/tests.
- Shared backend deployment serves Android, iOS and Windows without client rebuilds.

## Task: Partition orders and deploy the verified fix

- [ ] Reproduce five-supplier failure using real workflow and synthetic connectors.
- [ ] Add regressions for supplier/branch partitions, totals, unchanged paid rows,
  legacy key, no-launch decision, lost order/child responses and summary.
- [ ] Implement partition plans and durable per-order checkpoints in
  worker/provision_description_settlement.py; verify with focused/inherited tests.
- [ ] Compare wider tests against the exact live baseline and review the patch.
- [ ] Generate a hash-pinned package, test installer drift/rollback, merge and
  deploy only the verified source file to production and mirror.
- [ ] Verify installed hashes, health, and the preserved real draft through the
  application, without guessing data or authorizing a bank transaction.
