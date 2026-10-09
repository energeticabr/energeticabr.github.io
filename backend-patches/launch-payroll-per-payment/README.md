# Link each selected launch payment to its own payroll sheet

The previous workflow iterated distinct suppliers and applied one IDFOLHA answer to every selected launch for that supplier. This repair iterates selected payments instead. Each question identifies its position, launch ID, supplier and total (unit price × quantity + freight). Even when the supplier or available sheet is the same, each payment needs its own answer.

The option key includes the launch ID, so a late button from a previous payment cannot assign the next payment. Typed sheet IDs remain supported; supplier and month eligibility are unchanged. Financial creation, verification and idempotency remain in the existing per-launch type handler.

Legacy supplier-wide choices are re-questioned for unfinished entries. Verified FOLHAPGTO checkpoints are preserved and skipped, never relinked. No production financial records or conversation-state files are modified by deployment.

For uncertain legacy writes, migration first uses the existing token lookup and strict field verification, both read-only. A payment that was already created is recovered as a verified checkpoint on its original sheet; the remaining payments get individual questions. Failed lookups, verification failures or conflicting fields retain the original bindings and allow a reconciliation retry without a create/merge.

## Verification

Use a fresh matching backend snapshot containing runtime modules and its tests/test_workflow.py external-data fixtures:

```sh
PER_PAYMENT_SOURCE=/path/to/backend python -B test_per_payment.py -v
python -B test_deploy.py -v
PER_PAYMENT_SOURCE=/path/to/backend python -B export_fixture.py /path/to/ui-fixture.json
node serve_fixture.mjs /path/to/ui-fixture.json
```

The per-payment tests exercise real ChannelBridge, WorkflowEngine and LocalStateStore with synthetic records and external SharePoint/media fakes. The UI fixture uses actual exported channel messages and the app's unchanged conversation store and renderer; it cannot submit real payments.

See regression-comparison.md for all inherited full-backend failures and the additional diagnosed Windows socket error with successful exact-case reruns. The full backend suite is not green.

## Deployment

The exact baseline and candidate hashes are pinned in deploy-manifest.json. The only installed file is worker/workflow.py at /opt/energetica-whatsapp and /home/opc/energetica-build. The installer rejects source drift under the shared lock, verifies backups, preserves file attributes, installs atomically, restarts the bridge and checks both services and health. All changed roots are restored on a failed rollout, with incomplete restoration reported explicitly.

The archive is a zero-context diff. On Windows disable Git line-ending conversion to reproduce the tested Linux candidate byte-for-byte:

```sh
git -c core.autocrlf=false apply --check --unidiff-zero workflow.patch
git -c core.autocrlf=false apply --unidiff-zero workflow.patch
```

The shared backend serves the installed Android, iOS and Windows/web clients, so this correction does not require new native binaries. See verification.md for installed hashes and publication evidence.
