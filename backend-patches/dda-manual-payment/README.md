# Manual DDA payment confirmation

Records a user's declaration that a DDA was already paid. It never initiates a banking payment and never writes `SITUACAO` or `STATUS_DDA`.

The existing authenticated portal chat transport receives:

```json
{"action":"dda_payment_confirm","itemId":7,"key":"<64 lowercase hexadecimal characters>"}
```

Successful response:

```json
{"status":"processed","messages":[],"ddaPaymentConfirmation":{"status":"confirmed","itemId":7,"key":"<same key>","confirmedAt":"2026-10-28T13:45:00Z","confirmedBy":"owner@example.com"}}
```

The bridge validates its Microsoft bearer token and existing CORS policy before dispatch. The handler applies the same private owner allowlist as `dda_refresh`. The audit email comes exclusively from that validated server identity. Extra request fields are rejected.

Only `PGTO_CONFIRMADO` (Boolean, default false), `PGTO_CONFIRMADO_EM` (UTC DateTime), and `PGTO_CONFIRMADO_POR` (Text) are merged. The server checks the item ID, exact DDA key and configured company before every write. A version-specific `IF-MATCH` prevents overwriting a concurrent first confirmation. Three bounded attempts handle collector concurrency. Successful writes require a readback of the identity, flag, actor and timestamp. Repeated requests return the original audit without writing again. An ambiguous network failure can safely be retried.

## Private configuration

Site, list and company identifiers are supplied by `/var/lib/energetica-whatsapp/dda-sync/manual-payment-scope.json`. The configuration is server-controlled, inaccessible through the request body, and pinned by SHA-256 in the package manifest. `scope.json`, credentials, source bridge snapshots and actual identities must never be committed here. Tests use fictional identities and company/list identifiers.

## Verification and installation

Run `python -m unittest discover -s backend-patches/dda-manual-payment -v` from the repository root. The private workspace contains `dda-monitor/Install-DdaManualPaymentColumns.ps1` and `Install-DdaManualPaymentBackend.ps1`.

1. The columns script idempotently creates and reads back the three fields without modifying items.
2. `Install-DdaManualPaymentBackend.ps1 -Mode Prepare` creates the reviewed manifest and private scope. It verifies the current bridge source against the pinned base before building the candidate.
3. `Install-DdaManualPaymentBackend.ps1 -Mode Check -ExpectedManifestSha256 <reviewed hash>` stages a private package, verifies hashes in both live and build trees, runs tests, verifies actual SharePoint schema/access/ETag with read-only requests, and checks bridge health. It does not install the hook or restart the service.
4. After coordinated review, `-Mode Deploy -ExpectedManifestSha256 <same reviewed hash>` repeats preflight, backs up both bridge sources, atomically installs the module/hook and private scope, restarts the service, verifies health and installed bytes, and prints a hash receipt. Failures restore both bridges and remove newly installed module/scope.

The production dependency is `worker/clients.py`; the build dependency is `clients.py`. Their separately pinned hashes intentionally differ. Both expose the verified SharePoint interface used here. Existing source drift, another installed module, mismatched scope or a different candidate hash aborts installation.

No live boleto was marked paid during verification. Read-only preflight proves read access and field compatibility; fake-repository tests cover write semantics and audit races. `verification.json` records the completed pre-deployment checks; it is not a deployment receipt.
