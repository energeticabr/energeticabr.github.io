# Gallery edit dropdown audit

**Goal:** Find and correct the only-current-option failure in editable dropdowns throughout the app.

**Architecture:** Audit gallery entry points, extracted form contracts, and live column schemas. Keep the shared editor and its proven sources; correct empty browsing queries at the repository boundary, retaining typed queries, pagination, permissions, cancellation and conditional saves.

**Constraints:** No real record mutations during testing; no changes to protected signature blocks, read-only fields or ambiguous source restrictions. Publish PC/web, Android internal and TestFlight from the validated revision.

## Work

- [x] Reproduce empty-prefix queries in Graph lookup, REST lookup and REST person providers with failing regressions.
- [x] Omit only empty search predicates; retain nonempty searches and safety checks.
- [x] Inventory all app gallery edit entry points and option sources.
- [x] Inspect live schemas without reading item values; distinguish genuine missing alternatives from derived/read-only fields.
- [x] Reproduce and correct any additional proven editor-specific failures.
- [x] Verify opening, pagination, filtering, clearing, replacement, stale responses and conditional saving at 320/390 px using fictitious data.
- [ ] Run focused tests, builds, signature guard and independent review; complete CI checks.
- [ ] Integrate and verify publication separately for PC/web, Google Play internal and TestFlight.

## Audit findings

The active app has 38 gallery actions, 35 editable gallery kinds and two read-only sources (DDA has two presentations). The shared editor covers 34 distinct list contexts, including the secondary launch editor in the supplier report. The main launch editor and employee RH editor have separate implementations; their existing option loaders/static alternatives were inspected separately. The shared editor changes must not be presented as a replacement for those implementations.

Read-only live schema inspection resolved all 34 shared sources and checked all 108 selected remote source occurrences. Cross-checking the source Update formulas distinguishes indexed text values, ID values and computed display labels: display formulas do not determine the persisted selection. The same extraction failure also affected five equivalent ID selectors in property forms. No eligible editable native Lookup/Person fields were found; the native provider changes are defensive regression coverage. No real item values or edits were needed for this inspection.

Additional confirmed failures involved numeric IDs, ID selections incorrectly extracted as computed persisted labels, availability-derived queries, availability revalidation on save, a valid conditional source with an intentionally empty fallback, and complete browsing of a 3,163-row source beyond the former 2,000-row bound. Empty browsing now uses 100 rows per page with the existing 100-page ceiling; the UI accepts that same 10,000-row bound and still fails explicitly beyond it. Interactive queries retain their smaller bound. Exact-value validation is separate from interactive text search and preserves source/dependency restrictions.

Presence payment labels retain their proven Brazilian date format. Recurring expenses resolve their legacy logical name to LOCACOES only after exact resolution fails; the current VM workflow target and all 16 owned business fields plus Attachments confirmed this mapping. Tests verify exact logical names remain authoritative.

Browser fixtures use the real editor/repository pipeline with fictitious Graph/REST data and simulated conditional writes. Screenshots at 320/390 px were visually checked. Local signature guard, secret scan, native/PWA builds and focused tests passed; full suites and independent review are recorded with the release evidence outside the repository.
