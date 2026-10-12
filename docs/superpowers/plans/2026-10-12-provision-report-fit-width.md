# Provision report: fit the available screen width

The user's explicit no-horizontal-drag follow-up supersedes PR406's scrollable minimum-width layout. Existing landscape requirement, financial calculations, source queries, filters, report navigation and PDF contents remain unchanged.

Design: use 100% of the available report content width, preserving safe areas and navigation gutters. Keep ordinary seven-column provision and eight-column inactive tables when readable. At narrower actual content widths, present labelled cells as row cards. For the fourteen-column annual table, use labelled month tiles below the width needed for twelve readable months; keep every month, including empty months, and supplier/total visible. Preserve complete dates/money, all status colors and HTML table semantics. Screen-only labels must not duplicate PDF text or remove PDF column headers.

Execution (inline, no approval pause per user instructions):

1. Add failing browser no-overflow/full-cell coverage and labelled-cell/PDF capture regressions.
2. Implement bounded view metadata and report-only responsive CSS; no shared report, gesture, or financial-write changes.
3. Verify eight viewports including iPhone safe areas, narrow landscape and desktop; visual local and published verification, complete PDF/filter/navigation regressions, full mobile suite, signature guard, production build.
4. Independent scoped review, fix any findings, commit only scoped files, PR/merge, publish web for Windows plus Android internal and iOS TestFlight; verify deployed report and native publication outcomes.

No historical financial migration or Power Automate changes are part of this layout task.
