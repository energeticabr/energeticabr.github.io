# Replace a selected gallery filter with a fresh search

The shared searchable dropdown begins a new query on beforeinput/compositionstart
after a committed selection (frontend PR #366). Live verification then exposed a
second cause: launch snapshot options were built from the already-filtered rows,
so another supplier could no longer be offered.

The versionable worker remains in
`../launch-gallery-quick-search/candidate/worker/launch_gallery.py`. Only the option
catalog source changes. Rows, count, ordering, pagination, filtered monetary
totals, validation, permission context and all mutations are unchanged.

Unfiltered and text-only snapshots reuse the existing unfiltered row read before
local matching. Structured/date filters add one unfiltered, fully paginated read
projecting only ID and the six filter columns, not signatures, attachments,
descriptions or financial amounts. Dropdown options therefore cover the current
authorized list even when the current filter matches no rows. This is not a
stale client cache and does not discard any other selected filter.

## Verification

Five behavior regressions failed before the change and passed afterward, including
Marcos -> Helison replacement, all six catalogs, no matches, text-only search and
options across SharePoint pages beyond the visible UI page. Additional checks
assert the minimal projection and no extra read for unfiltered/text-only requests.
Run `../launch-gallery-quick-search/test_quick_search.py` with the existing offline
SharePoint boundary fixture. The combined existing search/gallery/HTTP bridge/
guarded-deploy suites pass 96 tests. This directory's `test_deploy.py` runs the
actual new wrapper against all 15 existing deployment contracts plus two bundle
and CLI checks, using temporary local targets only.

## Exact rollout scope

Both live targets were checked read-only and match SHA-256
`7f680cd0271b04142831eb5cbcbfd802d937873fc0755570f8dd4353c9c12c26`:
`/opt/energetica-whatsapp/worker/launch_gallery.py` and
`/home/opc/energetica-build/worker/launch_gallery.py`.
The new candidate hash is
`b4011552cacd3bff50ae7103a84e8ac86cec6315f373dd82f8ec8de90ee322f3`.

The new stage is `/home/opc/gallery-filter-options-20261009/candidate`. The previous
quick-search stage, manifest and backups are retained. The wrapper imports the
unchanged gallery guard pinned to
`79d2e31cea242e7256124e89a0efe447e51548f24277d6b9c2beac9c62011248`, which imports
the unchanged shared rollout runner pinned to
`01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2`.
Only STAGE changes; exact roots, single-file scope, manifest digest gate, deployment
lock, copy-time drift protection, verified backups, atomic owner/mode-preserving
copy, service restart, health checks and independent rollback receipts are retained.
The shared runner's historical backup prefix is retained.

No financial records, checkpoints, credentials, configuration or workflow modules
are written. This backend is shared by PC/PWA, Android and iOS; native frontend
builds from PR #366 already contain the fresh-query behavior.

See `commands.md` for the reproducible staging/check/deployment steps. Confirm
the exact hash and health receipt and then test replacement in the published app.
