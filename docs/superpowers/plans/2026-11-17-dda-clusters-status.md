# DDA clusters and status layout

Implement the supplied screenshot corrections in dda-report-view.js and dda-report.css.

1. Keep one situation cluster per row. Unpaid scheduled rows show AGENDADO and the existing consultation timestamp inside green. Unscheduled open rows show Em aberto only; preserve paid, unknown and pending-settlement evidence and all filtering rules.
2. Nest boleto number inside the blue bank cluster. Add a dedicated supplier-name cluster and a red nominal-value cluster. Stack the check above the barcode arrow for every width.
3. Update existing report and browser expectations; verify status dates, manual/scheduled payments, unlinked warnings, print and 320/390/844/1365 layouts. Run signature guard, focused DDA suites and standard/PWA builds.
4. Review the finished diff, push a PR, merge after checks, and verify Windows/web, Google Play internal and TestFlight independently.

User explicitly requested execution and publication without further confirmation. Native worktree creation did not return; used a Git worktree to avoid blocking unrelated checkouts. Financial calculations, data sources and protected gesture blocks remain outside scope.
