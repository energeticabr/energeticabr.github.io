# DDA individual provision matching

**Goal:** Recommend a provision description when one unpaid child provision has the current DDA amount, even when its parent total covers other DDAs.

**Architecture:** Extend the existing read-only option loader with a complete repository read of PROVISÃO PGTOS. Resolve the parent-link column from metadata and group children by the real parent ID. Calculate child amounts using the existing quantity/freight calculation. Keep parent-total matching and the existing supplier weights; use matching child due dates for tie breaking. Explain the matching child in the picker without selecting or saving automatically.

**Constraints:** Preserve the signature gesture blocks, unpaid-parent restriction, manual choice, confirmation, ETag check and idempotent save. Publish web/Windows, Android internal and iOS TestFlight. User explicitly requests execution without approval pauses.

## Steps

- [x] Add tests for a larger parent with an individually matching child; quantity/freight and Brazilian decimals; matching-child due dates; paid, unrelated and invalid children; fail-closed child reads; unchanged manual save.
- [x] Observe the new tests fail, then implement the loader, ranking and matching-line explanation.
- [ ] Run focused tests, browser regressions, full suite, signature guard and both builds. Review final diff.
- [ ] Commit, create PR, integrate after CI, verify public web assets and both native distributions.

## Execution record

- Baseline: 5 DDA linking tests pass; 14 signature blocks intact.
- Native worktree creation did not return; used a dedicated Git worktree in this task's app folder to proceed without touching the existing checkout.
- Three new tests failed before implementation, then all 9 focused unit/browser tests passed. Browser verifies the matching-line explanation at 320/390/844/1365 px and with safe areas. Native/PWA builds passed; signature guard confirms all 14 protected blocks.
- Independent review found the child due-date alias/metadata gap. Added failing regressions for DATAPREVISTOPGTO in Brazilian date format and a renamed metadata column; fixed normalization with provisionDateKey and metadata-based field reads. All 10 focused unit/browser tests now pass. Child rows explicitly marked paid are also excluded. Builds and signature guard passed after the fixes.
