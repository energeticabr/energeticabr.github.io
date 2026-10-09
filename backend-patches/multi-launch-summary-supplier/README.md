# Supplier per item in multiple-launch confirmation summaries

The shared workflow previously displayed FORNECEDOR in the common header only.
Different suppliers therefore became DIVERSOS; an individual supplier sometimes
appeared only in the edit history. The six-line patch adds FORNECEDOR immediately
after PRODUTO inside every LINHA, using that snapshot's display name, its own
saved field when the display is blank, or EM BRANCO. It never borrows a supplier
from another line or from the common header.

The same rows feed the confirmation PNG, text fallback and progress summary.
Grouping, quantities, prices, freight, discounts, attachment placement, financial
submission and signature gestures are unchanged. Previously generated PNGs are
not rewritten; newly generated summaries use the updated rows.

## Tests and visual preview

Use a fresh backend snapshot with its worker modules and tests/test_workflow.py:

```powershell
$env:SUMMARY_SUPPLIER_SOURCE = 'C:/path/to/candidate'
python -B backend-patches/multi-launch-summary-supplier/test_summary_supplier.py -v
python -B backend-patches/multi-launch-summary-supplier/export_preview.py C:/path/to/preview
python -B backend-patches/launch-payroll-per-payment/test_deploy.py -v
```

Seven regressions exercise actual summary rows, the textual fallback and the real
PNG/HTML builder with synthetic records. External state/data/messaging fixtures
cannot submit production payments. The inherited workflow tests' two supplier
counts are updated in test_workflow.patch (header plus two items).

The two zero-context patches must be replayed against the exact baseline using
`git -c core.autocrlf=false apply --unidiff-zero`. Replay was checked byte-for-byte
against the tested candidate, including the separate test patch.

## Deployment

Only worker/workflow.py is installed in /opt/energetica-whatsapp and
/home/opc/energetica-build. deploy-manifest.json pins both source versions.
deploy.py reuses the existing shared deployment runner, checks its exact SHA256,
and selects the new isolated /home/opc/multi-launch-summary-supplier-20261009
stage. Copy launch-payroll-per-payment/deploy.py into that stage as
shared_deploy_runner.py, together with the wrapper and manifest; place the
reviewed candidate at candidate/worker/workflow.py.

Validate wrapper, manifest, runner and candidate hashes before calling:

```sh
sudo -n /opt/energetica-whatsapp/.venv/bin/python /home/opc/multi-launch-summary-supplier-20261009/deploy.py --check b2804fbb26d9f2f30ae8577959fab65ce9c3836a7f350cccb2321f056342370b
sudo -n /opt/energetica-whatsapp/.venv/bin/python /home/opc/multi-launch-summary-supplier-20261009/deploy.py --deploy b2804fbb26d9f2f30ae8577959fab65ce9c3836a7f350cccb2321f056342370b
```

The shared lock, source-drift rejection, verified backups, atomic file installs,
attribute preservation, service/health checks and rollback remain in the reused
runner. Its backup directory retains the runner's launch-payroll-per-payment
prefix. No credentials, configuration, SharePoint records or conversation state
are installed or rewritten. Publication of this shared backend serves existing
Android, iOS and Windows/web clients without requiring new native binaries.

See verification.md for the actual deployment and full-suite comparison.
