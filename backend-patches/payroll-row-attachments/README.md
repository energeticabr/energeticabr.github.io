# Payroll row attachments at settlement

Reviewed backend patch only. No deployment was performed by this task.

At settlement, enumerate persisted attachments from the individual `PROVISÃO PGTOS` child. Copy them to that child's verified `LANCAMENTOS` and to the shared `NOTASPENDENTES` order before writing the child's paid status. A group keeps its existing single order and per-child launches. Session/description-parent aggregate files are never enumerated as child originals.

The completed-child journal branch also reconciles missing copies, including recovered in-flight child writes. Copying never writes files to a source child or creates financial records. A settlement that chooses no new launch reuses its freshly verified existing `IDLANCAMENTOS`/`IDPEDIDO` pair. Only no-new-launch with both links empty leaves files solely on the provision. Incomplete, malformed, foreign, changed or unsupported multi-ID links stop visibly before the paid write; the helper never chooses one ID from an ambiguous value. Adding files after an entirely completed payment is handled by the separate mobile attachment service.

Live supplier/branch on the provision and both targets, provision parent, launch `IDPGTOAGENDADO` and `AGRUPAR`, and the provision's expected financial-link pair must match. The existing-link path reads the current provision even when the reviewed context has empty links, so stale empty context cannot silently bypass copies. The generated-record path still accepts its unchanged old or exactly recovered new link pair; replacement authorization remains in the existing settlement flow. Existing ETag updates and group locks remain intact. SHA-256 verifies reused and uploaded bytes; identical content reuses an existing target file. New names contain the child ID and full content hash, preserving same-name files with different bytes. A collision at the deterministic name fails without overwriting. A lost upload response succeeds only after reading back matching bytes.

## Scope

Exactly three deployment files:

- `worker/workflow.py`
- `worker/provision_description_settlement.py`
- `worker/payroll_row_attachments.py` (new)

The existing `worker/provision_attachment_sync.py` supplies the paginated, scoped attachment reader, ID validator and safe copy-name builder. Its child-to-parent mirror behavior is unchanged. No background sync, schema change, financial repair or mobile change is included here.

`source.patch` and `deploy-manifest.json` pin source, production/mirror baselines and the private archive. Keep LF bytes when copying these artifacts. The complete `source-files.tar` must remain outside the public repository. `package.py` requires an explicit archive destination outside its public output directory.

## Local validation and packaging

Set `ENERGETICA_BACKEND_TEST_ROOT` to the private candidate root and `PYTHONPATH` to the local test dependencies. Run:

```powershell
python -m pytest backend-patches/payroll-row-attachments/tests -q
python backend-patches/payroll-row-attachments/package.py --baseline <private-base> --candidate <private-candidate> --output backend-patches/payroll-row-attachments --mirror-hashes backend-patches/payroll-row-attachments/mirror-hashes.json --archive-output <private-root>/source-files.tar
```

Tests use real settlement/attachment logic with in-memory remote boundaries and synthetic documents. Installer tests use temporary local directories and fake service health/restarts. Do not run the broad suite on the small VM.

## Integration handoff (not executed)

Stage only the three package files `deploy.py`, `source.patch`, `deploy-manifest.json`, the private `source-files.tar`, and the canonical helper as `shared-deploy.py` in `/home/opc/payroll-row-attachments-20261019`. Obtain the helper from the existing remote `/home/opc/provision-settlement-amount-20261017/shared-deploy.py`; require SHA-256 `01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2`. Do not substitute an older repository helper.

The main integrator must review and authorize the actual rollout after integration. The staged installer accepts `sudo -n python3 deploy.py --check <manifest-sha256>` and then `--deploy` with that same hash. Both source roots must still match the manifest, or it refuses. `--check` validates/assembles staged files and reads health, without replacing live sources or restarting services. Actual rollout uses `/var/backups/energetica-whatsapp/payroll-row-attachments/payroll-row-attachments-<UTC>` for per-root backups and rollback receipts. The global deploy lock coordinates with other backend installers. Verify both roots' installed hashes and service health after rollout. Never perform a real payroll payment to test this patch.

The backend serves Android, iOS and web/Windows through the existing runtime; this package itself does not build or publish any client.
