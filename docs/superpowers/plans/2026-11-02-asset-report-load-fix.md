# Asset report loading and launch title button

> Implementation: superpowers:executing-plans; user already authorized execution and publication without design questions.

**Goal:** Open the complete report from either gallery through the production repository and make the launch title an obvious button.

**Cause:** The report requests maxPages=1000 and $top=200; the repository rejects values above 100 for both. Earlier report tests replaced this repository boundary and missed its validation.

**Approach:** Keep existing repository safety limits. Read history in batches of 100 through at most 100 pages, preserving failure on incomplete/cyclic pagination. Wrap title, row ID and report cue in the existing styled native button in both galleries. Keep the other fields outside the target.

- [x] Add regression exercising createRegistrationGalleryData with the real frozen SharePoint repository and three history pages; observe failure.
- [x] Correct the report request limits and prove full history/total, retaining cancellation and cross-asset isolation.
- [x] Add failing native title-button expectation for launches; reuse existing cluster style and test native keyboard/touch at 320/390/1365px.
- [x] Verify against fresh live metadata/items via the read-only SharePoint v2 endpoint, using the production repository.
- [ ] Run focused tests, guard and builds; request independent branch review; merge and verify web, Android internal and TestFlight for the same revision.

No production data, financial calculation, flow or permission changes are required.

