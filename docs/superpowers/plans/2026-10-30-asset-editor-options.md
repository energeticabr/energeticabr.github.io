# Asset editor catalog options

**Goal:** All eight dropdowns in the asset gallery editor must offer their valid alternatives and support selecting a replacement.

**Architecture:** Keep the existing Form16 contract and searchable selector. Correct catalog browsing and validate replacement values through the same SharePoint repository used in production. Preserve ETags, pagination, cancellation, and closed option validation.

**Scope:** Five remote catalogs (function, supplier, group, asset product, branch) and three literal dropdowns (status, condition, depreciate). No real record mutations during testing; no protected signature changes.

## Work

- [x] Trace Form16 sources through the editor, selector, and SharePoint repository.
- [x] Add regressions using the real frozen repository for browsing, second-page options, filtering, and saving each catalog field.
- [x] Compare production metadata and read-only catalog queries.
- [x] Omit empty prefix searches when browsing, retaining authorization and fixed/dependent restrictions.
- [x] Use a supported limit when revalidating replacement values.
- [x] Verify literal alternatives, empty results, clear search, stale requests, and mobile interaction with fictitious data at 320/390 px.
- [ ] Run appropriate tests, signature guard, builds, and independent review.
- [ ] Merge and verify PC/web, Android internal, and iOS TestFlight publication.
