# Supplier required in payment provisions

Request: remove `0 - EM BRANCO` from supplier selection when creating a payment provision.

The shared backend `sharepoint.payment_flow.steps[fornecedor_pagamento].allow_blank`
changes from `true` to `false`. This is the only production configuration change.
Other optional fields, real suppliers and supplier registration remain unchanged.
Android, iOS and Windows consume the same workflow response; no native binary or
frontend change is required.

## Artifacts

- `supplier.patch`: reviewable one-property source patch.
- `patch_configuration.py`: exact-byte patch of isolated candidates; aborts on baseline drift.
- `test_supplier.py`: real workflow engine with in-memory external services, no SharePoint writes.
- `deploy.sh`: validates both VM copies, preserves backups, installs only the configuration,
  restarts both services and verifies health. ERR/INT/TERM recover both copies and verify
  baseline/workflow hashes and service health before reporting verified recovery.
- `test_deploy.py`: isolated Bash recovery tests; no filesystem or service mutation.
- `verify_ui.mjs`: existing client rendering and supplier-click verification at 320/390/1365 px.

## Verification (2026-10-05)

- Baseline: 3 expected failures across 5 supplier tests. Candidate: 5/5 pass locally
  and in both VM staging copies.
- Recovery regression: 3 expected failures on the original script; 3/3 pass after repair.
- Full backend suite, baseline and candidate: 2320 tests each, 441 failures,
  131 errors, 3 skips. The exact 572 failing/error test names match, not merely counts.
  This legacy suite is **not green**; this scoped configuration change introduced no new failing cases.
- Existing client renders the real engine response without `EM BRANCO`, with enabled
  supplier buttons and registration action. Selecting supplier 273 emits its expected
  reply. No horizontal document overflow at all three widths. Phone screenshot inspected.
- Signature gesture guard: 14 protected blocks intact; no protected code edited.

Configuration hashes (SHA256):

```text
baseline 008558f341ec19930858be622ee11ff4f1ef554e34e4e86694a0298652dddf4d
candidate 5036ce110dcdaa4d3a5a382f804509ad297eae49843ad849cc87a0b2b2ef05f7
unchanged workflow c064da3e06afece45e8ea16b4d1aa05d7ed506b5572b7208dc9be9987c7daf54
```

Run focused tests with `PROVISION_SOURCE` pointing at the backend and optionally
`WORKFLOW_CONFIG_PATH` pointing at the candidate configuration. `PROVISION_TESTS`
can point at the test fixtures when the live backend omits tests. `PROVISION_FIXTURE`
exports a renderer fixture; `node verify_ui.mjs <fixture.json> [phone.png]` checks it.
Run recovery tests with Python on a host providing Bash.

Deployment stages must reside under `/home/opc/provision-supplier-no-blank-*` and
contain these scripts plus `test-fixtures/test_workflow.py`. Run `bash deploy.sh
<stage> validate` first, then `bash deploy.sh <stage> apply`. Do not override drift checks.

Compatibility: messages/options cached **before** deployment are not migrated.
An already-open supplier prompt must be regenerated (return/reopen the flow) to
receive the new options. Existing financial records and user drafts are not rewritten.
