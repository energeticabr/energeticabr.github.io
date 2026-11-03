# Monthly depreciation correction

Execution inline, as requested. Skills: systematic-debugging, writing-plans,
executing-plans, test-driven-development, verification-before-completion.

**Goal:** Run depreciation only on day 01, one order per month across branches
and suppliers, sum linked financial entries, display DIVERSAS for multiple branches.

**Architecture:** Patch the existing shared cloud flow, retaining financial,
asset-history and PDF connectors. Monthly recurrence anchored to the next day 01
at 07:00 Sao Paulo, serial execution, unique month and asset-month keys. Reuse
financial/history records after partial failures. Overdue assets post once for the
current month and advance directly to next month, preventing daily catch-up.

**Scope:** Backend only; immediately shared by Android, iOS and Windows. No native
binary changes. Preserve historical financial entries and original competence dates.
Delete only depreciation orders with no financial or asset-history links; recycle
rather than permanently erase. Repair existing totals from all linked entries.

- [x] Add failing tests for monthly trigger, grouping, totals, zero amounts,
      overdue assets, repeated executions, partial failures and cleanup safety.
- [x] Implement deterministic builder and repair planner; run focused regression suite.
- [x] Validate actual WDL runtime with fictitious inputs and no external writes.
- [x] Review complete change; preserve live backups, enforce schema and ETags.
- [x] Publish flow, repair totals, recycle proven empty orders, read back everything.
- [ ] Commit and integrate backend patch and verification documentation.

Observed current snapshot: 47 assets, 276 history rows, 3187 financial entries,
394 orders. Seven depreciation orders; all seven have linked financial entries.
Orders 489 and 494 are late postings with original January/March competence;
they must not be deleted merely because VALORTOTAL is blank.

Verified: 17 backend tests; three actual WDL probes (new monthly order with
multiple branches/suppliers, existing financial/history reuse, completed rerun,
and an empty month); no probe external writes. Independent review findings fixed:
PDF rows rebuilt from all linked financials, publication connection checks,
attachment-preserving cleanup. Tenant pagination maximum is 5,000; added guards
against silent truncation. Server recurrence readback normalization is strict.
Production is Started, next recurrence 2026-12-01 at 07:00 São Paulo. Five blank
order totals repaired; two were already correct. No empty orders existed, so zero
were recycled. All 47 assets, 276 history records and 3187 financial records were
verified unchanged. No production manual trigger or app binary changes.
