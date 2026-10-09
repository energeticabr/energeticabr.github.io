# Verification and publication — 2026-10-09

## Change verified

Every multiple-launch LINHA now includes its own FORNECEDOR immediately after
PRODUTO. The common DIVERSOS header does not replace the line's supplier.
Own display label takes precedence; blank labels fall back to the same saved
line's field, then EM BRANCO. No grouping, money, attachment assignment,
financial submission or signature behavior was changed.

Only six production lines were added to worker/workflow.py. Both archived
zero-context patches were replayed byte-for-byte against the fresh baseline.

## Tests actually run

- Seven new cases against the exact original VM snapshot: RED, nine failed
  assertions including three blank-display subcases, all proving the omission.
- Same seven cases against the candidate: GREEN, 7/7 on Windows and Linux.
- Same seven against /opt/energetica-whatsapp after installation: GREEN, 7/7
  in 1.671s. Workflow and summary renderer module paths are asserted to be the
  installed target, not the staging fixture's modules. The test-only fixtures
  come from staging because production intentionally does not contain tests.
- Real SummaryCardBuilder PNG/HTML, escaping, missing/current/inherited labels,
  same product with different suppliers, unchanged R$ 80,00 total and empty
  synthetic SharePoint writes are covered.
- Existing exact-file installer's seven unit cases: GREEN, 7/7, covering source
  drift, unlisted files, candidate hash, check-only, verified backup, rollback
  and partial restore reporting.
- Existing attachment-preview and flow-summary-layout tests: GREEN, 44/44,
  including tablet width/scroll, phone fit/zoom, original sharing blob and focus.
- Signature-gesture guard: 14 protected blocks intact, checked twice.
- Independent review reproduced RED/GREEN with the real renderer and found no
  actionable issue in the six-line change or the hash-pinned installer reuse.
- Completed isolated legacy group: 23 cases on each version; both have the same
  19 passes, 2 failures and 2 errors. Full discovery was interrupted on both
  versions due to substantial legacy failures and memory growth. Neither is
  reported green. Every observed failed case is named in regression-comparison.md.

The final test harness preloads the requested workflow/renderer and asserts
their paths before importing the inherited memory-only fixtures. This prevents
those fixtures from silently selecting a staging worker during installed-source
verification. No tests or fixtures are installed in the production directory.

## Server publication

Published 2026-10-09 at 10:22:40 UTC (07:22:40 America/Sao_Paulo), using the
existing shared locked atomic installer through the SHA-pinned wrapper.
Check-only succeeded before installation. Both deployment roots changed from:

`c080270856b1f592adf497ef986e2ae8177ddc516e9dc3ea5bce929f5b180534`

to the tested candidate:

`d3ea7abb5957302b0c1f6a3dd0156a25014d9d054fa7a229344040fba3b18133`

Exact file targets:

- /opt/energetica-whatsapp/worker/workflow.py
- /home/opc/energetica-build/worker/workflow.py

Both hashes were read back after deployment. The verified recoverable backup is:

`/var/backups/energetica-whatsapp/launch-payroll-per-payment-20261009T102240637571Z`

The reused runner's original backup prefix is deliberately retained. It restarts
only energetica-channel-bridge.service. Channel bridge and whatsmeow services
both report active; local /health returns status=ok, channel=generic, and the
public backend /health returns ok. No secrets, configuration, SharePoint rows,
real payments or user conversation state are rewritten by the deployment.

## Visual proof and client scope

The installed workflow generated a fresh real 1080 x 3029 PNG from three
synthetic suppliers A/B/C with total R$ 95,00. It was opened in the app's actual
attachment-preview component. Supplier names are visible immediately below the
product in the matching item, including LINHA 3 / FORNECEDOR TESTE C. Desktop
uses full content width with vertical scroll; phone 390 x 844 has no horizontal
overflow. This is a safe synthetic preview, not a submitted real financial flow.

Local screenshot:

`C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr/multi-launch-summary-supplier-installed-20261009.png`

The public app was opened after deployment and signed in using the existing
Microsoft session. It visibly showed Bernardo, conectado à VM in SUPRIMENTOS.
Only startup notices were dismissed; no genuine flow was started, reset or
submitted. That read-only live-app proof is saved alongside the preview as
multi-launch-summary-supplier-live-app-20261009.png. Temporary browser viewport
overrides were reset and both task-created test tabs were closed.

The shared server generates the PNG consumed by all existing Android, iOS and
Windows/web clients. No frontend or native code was changed, so there is no new
APK, App Store/TestFlight build or Windows installer for this backend-only
release. Newly generated summaries use the updated rows; old generated PNGs
remain unchanged. Native-device visual execution was not claimed.

## Reproduction against installed source

```sh
sudo -n env SUMMARY_SUPPLIER_SOURCE=/opt/energetica-whatsapp SUMMARY_SUPPLIER_FIXTURES=/home/opc/multi-launch-summary-supplier-20261009/candidate /opt/energetica-whatsapp/.venv/bin/python -B /home/opc/multi-launch-summary-supplier-20261009/test_summary_supplier.py -v
sudo -n env SUMMARY_SUPPLIER_SOURCE=/opt/energetica-whatsapp SUMMARY_SUPPLIER_FIXTURES=/home/opc/multi-launch-summary-supplier-20261009/candidate /opt/energetica-whatsapp/.venv/bin/python -B /home/opc/multi-launch-summary-supplier-20261009/export_preview.py /home/opc/multi-launch-summary-supplier-20261009/installed-preview
```
