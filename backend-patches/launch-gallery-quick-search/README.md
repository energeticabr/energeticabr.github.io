# Launch gallery quick search backend

The versionable candidate is candidate/worker/launch_gallery.py. No other backend
module is included in the candidate. Frontend/shared matcher and releases belong
to the main agent.

## Live verification and rebase

Read-only SSH confirmed distinct baselines, last checked at 2026-10-09T03:13:26Z:

| Destination | SHA-256 |
| --- | --- |
| /opt/energetica-whatsapp/worker/launch_gallery.py | a38c6a37f321f7d5c30d8319237176ac68d7f21b652a6dee71bfbd965f6f76d1 |
| /home/opc/energetica-build/worker/launch_gallery.py | 308e083427f9ac0f97f9db2f958e55c7c2b9df3662a01073892924667c9a2f15 |
| Candidate for both | 7f680cd0271b04142831eb5cbcbfd802d937873fc0755570f8dd4353c9c12c26 |

Only launch_gallery.py was fetched from the mirror, to
.superpowers/gallery-quick-search-live/worker/launch_gallery.py.
An exact copy was retained at
.superpowers/gallery-quick-search-live/baseline/worker/launch_gallery.py.
No financial records, credentials, configurations or other VM modules were fetched.

The mirror is older: it omits the CONTA catalog, ADIANTAMENTO/TIPO TRANSAÇÃO fixed
choices and the product catalog's real SATUS field. The candidate preserves these
existing production changes while rebasing search onto the fetched module.
The older mirror failed the existing editor regression (product returned as text);
the preserved production behavior passes it.

launch_gallery.patch is relative to the fresh mirror and carries the preserved
production changes. launch_gallery.runtime.patch is relative to production and
adds only search and description text extraction. Both produce the same candidate.

## Search contract

filters.search is an optional string of at most 512 characters. Absent/blank
search preserves the production snapshot projection/behavior. Invalid types,
unsafe controls and lone surrogates fail before SharePoint I/O without echoing
the input. All whitespace-separated terms must occur in one launch, though they
can match different fields. Matching is literal, case/accent insensitive, and
intersects all existing structured filters.

Search covers supplier, product, description, account, status, approval, branch,
stage, IDs including optional IDFOLHA, dates, quantities, prices, freight, totals
and explicitly allowed launch text. Signatures and arbitrary metadata are excluded.
Only DESCRIÇÃO is extracted as inert visible text with HTMLParser/html.unescape.
Tags, attributes, comments and script/style content are excluded; block boundaries
separate words and inline markup preserves words. No HTML executes/fetches resources.

Date aliases use the rendered civil day in America/Sao_Paulo. Full timestamps keep
raw ISO but do not create a Brazilian alias from the UTC prefix:
2026-10-09T02:59:59Z matches 08/10/2026 and raw ISO, not 09/10/2026.
Numbers support decimal points/commas, Brazilian grouping and R$.

All authorized SharePoint pages are consumed before search, sorting, totals,
filter options, count and UI pagination. Search is never interpolated into
Graph/OData queries, projections, endpoints or mutations.

## Focused verification

From the shared worktree root on this Windows host:

```powershell
$env:PYTHONPATH = 'C:/Users/Bernardonotini/AppData/Local/Temp/energetica-gallery-search-python-deps'
$taskPython = 'C:/Users/Bernardonotini/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
& $taskPython backend-patches/launch-gallery-quick-search/test_quick_search.py
& $taskPython backend-patches/launch-gallery-quick-search/test_deploy.py
& $taskPython backend-patches/launch-payroll-per-payment/test_deploy.py -v
```

Search tests exercise the versionable candidate. GALLERY_SOURCE can select another
root containing worker/. GALLERY_FIXTURE_SOURCE selects existing offline tests;
its default is apps/energetico-mobile/.superpowers/single-launch-candidate.
Only the existing SharePoint boundary fixture is reused; no VM test files are fetched.

Focused validation: 25 search tests, 38 existing launch tests, 5 existing HTTP
bridge tests, 13 new wrapper tests and 7 unchanged shared-runner tests.
Search failed on the freshly fetched baseline before rebasing; HTML entity/
markup/script/style regressions failed before extraction. The UTC-prefix negative
regression already passed the backend's civil-date logic. Unrelated full suites
were not run.

## Wrapper and deployment authority

deploy.py imports the unchanged backend-patches/launch-payroll-per-payment/deploy.py
runner and checks its SHA-256:
01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2.
The remote bundle supplies the same runner as shared_deploy_runner.py.
FILES is only worker/launch_gallery.py; NEW_HELPERS is empty.
STAGE is /home/opc/gallery-quick-search-20261009/candidate.

deploy-manifest.json pins a before hash for each exact root and a common candidate
after hash. A per-target digest guard enforces those pins through pre-write
checks; the other target's known hash is not accepted. The unchanged shared runner
owns the manifest digest CLI gate, lock, verified backups, atomic installation,
owner/mode preservation, restart, health checks, independent rollback and receipts.
Its existing launch-payroll-per-payment backup prefix is retained.

Local wrapper tests cover differing/swapped baselines, target/candidate drift,
manifest scope/metadata, mid-check/late drift, install/restart failure, complete/
incomplete rollback and unrelated-file preservation. Service and health boundaries
are replaced only in these temporary-directory tests.

See commands.md for the main agent's staging/check/deploy commands.
This agent performed only read-only VM hashes/stat/source reads; no remote stage,
lock, bytecode, backup, restart or deployment was created/executed. No commit.
