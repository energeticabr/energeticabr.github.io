# Management forecast totals implementation plan

**Goal:** Align the management summary and accumulated branch table with the paid/forecast expense table and its previous-month comparison.

**Architecture:** Reuse selectedExpenses and expenseBranchesFor. Sum the displayed branch amounts for the summary, preserving incomplete totals and currency rounding. Leave the other ranking tables and their launch-date semantics intact.

**Tech Stack:** JavaScript, Decimal, jsdom, Vite, Capacitor.

**Constraints:** Preserve filters, previous-month rollover, paid-provision exclusions, signature gesture blocks and existing product details. Publish validated code on web/Windows, Android internal and iOS TestFlight.

**Review focus:** A forecast-only branch must appear; zero previous totals retain existing infinity notation; incomplete totals stay incomplete; January compares with December; all-period views must not imply a monthly comparison.

- [ ] Add failing model and view tests for summary/branch financial amounts, percentages, rounding and monthly comparisons.
- [ ] Return financial summary from buildSpendingReport9; render summary and branch table using the same amounts as expense types. Remove branch row count and summary launch count.
- [ ] Run report tests, browser layouts, signature guard and both builds. Review the diff, merge and verify publication independently for each platform.

Execution: User explicitly requested autonomous execution and publication, so no design approval handoff. Native worktree creation did not return; git fallback created an isolated branch and attached it successfully.
