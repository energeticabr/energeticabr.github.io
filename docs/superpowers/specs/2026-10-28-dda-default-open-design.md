# DDA gallery default situation

Open GALERIA DDA with `SITUACAO=Em aberto`, including reopening a cached gallery.
Keep that option selected when no matching rows exist. Users can explicitly
select Todos, Pago or another situation; refresh preserves their current choice.
Other filters and the separate DDA report retain their current behavior.

Use the existing model-driven `defaultFilters`/`filterChoices` and a small
opt-in `resetFiltersOnOpen` list for the situation control. This avoids forcing
the default during refresh or modifying every other gallery's defaults.
The requested behavior is fully specified; execution/publication is authorized
by the user's standing instructions without an additional approval question.

Validate actual rendered controls, row visibility, empty results, refresh,
reopen, manual payment and unchanged full-base metrics. Publish web/Windows,
Android internal and iOS TestFlight after the applicable checks succeed.
