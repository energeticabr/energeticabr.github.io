# Gantt stage period cost implementation plan

> Execute inline with superpowers:executing-plans; the user explicitly requested execution without approval pauses.

**Goal:** Clicking a stage bar offers Dias por profissão or Custo por período; activity bars open professions directly.

**Architecture:** Reuse the spending source and expense aggregation from the management report. Scope every cost row to the selected branch and stage. A dedicated cost renderer uses the existing Gantt modal lifecycle, with available year/month filters and expense-type/product breakdowns.

**Tech stack:** JavaScript, existing SharePoint data source, Decimal aggregation, DOM, node:test, JSDOM and browser fixtures.

**Constraints:** Read only. Preserve chronology, dates/durations, profession calculations, session cancellation and protected signatures. Release the same revision to web, Android internal and TestFlight. The user screenshot defines paid/forecast/total breakdown; paid uses actual payment date and forecast uses unpaid provision due date, consistent with the management report.

**Review focus:** Other branches/stages must never contribute periods or totals; paid provisions must not duplicate launches; missing amounts remain incomplete; stale requests cannot replace a new selection; only periods with nonzero or unknown cost rows are selectable, including provision-only periods.

## Tasks

- [ ] 1. Add failing cost-model tests: branch/stage isolation, available periods, latest default, year/month changes, paid/forecast exclusion, zero-only periods and incomplete snapshots. Implement shared expense-period discovery and a scoped Gantt cost model.
- [ ] 2. Add failing modal tests: stage choice makes no reads, profession selection retains old flow, activity bypasses choice, cost filters recalculate, retry/close/late responses and focus behavior. Add a cost renderer and explicit stage selection from the Gantt parent flag. Route cost reads through existing session authorization to spending report 9.
- [ ] 3. Verify focused regressions and controller lifecycle; browser test at 320/390/844/1365 with selectable periods and expense expansion. Run guard, builds, repository checks and full suite; request fresh review.
- [ ] 4. Commit, create/merge PR, verify exact published web assets and same-revision Android/TestFlight receipts and artifacts.

## Execution ledger

- Baseline: existing linked worktree reused on feat/gantt-stage-period-cost from origin/main. Signature guard passed, 14 blocks intact. No approval questions per explicit user instructions.
