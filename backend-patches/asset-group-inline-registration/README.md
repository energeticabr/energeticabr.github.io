# Inline asset group registration

The first asset-product group question now offers `➕ CADASTRAR GRUPO IMOBILIZADO`
before existing groups. It opens the existing asset-group wizard. Only a confirmed
group submission writes a group; completion selects its name in the preserved
product draft and asks for the product name. It never submits the product.

## Bounded source change

Only these deployed files change:

- `worker/financial_catalog_registration.py`: explicit routing for
  `fixed_asset_product_registration` / `grupo_produto_imobilizado`, with the exact
  `GRUPO IMOBILIZADOS` source and `GRUPOIMOBILIZADOS` label/value. The child is fixed
  to `fixed_asset_group_registration`. The control is inserted before other
  terminal controls, and this question uses existing `terminal_options_first`.
- `worker/workflow.py`: allow the asset-product parent to use the existing
  embedded-registration mechanism.

`FINANCIAL_FLOWS`, generic financial matching and workflow configuration remain
unchanged. No create button is added to the function question or the group wizard.
The existing wire contract remains `financial_catalog_create` and
`financial_catalog_registered: true`.

The existing option pagination path retains the first control for empty results,
filters, filter clearing, refresh and later pages. Entering the child clears the
parent pagination cache as the existing helper already does. Returning reloads
the catalog; it does not promise restoration of the previous filter/page.
The existing parent snapshot preserves pending fields, answers, files,
idempotency token, history, edit indices and an ancestor return context.

## Verification

The private `work/asset-group-inline-20261030/runtime-live` contains freshly read
production Python source/configuration, with the existing mirror test fixtures
copied into `tests/` because the production archive contained no workflow tests.
No production client, stored workflow state, credential or real record is used.
Only external services use the existing fake SharePoint, messenger and media
fixtures; navigation, selection, child startup, review, commit, retry and completion
execute the real engine.

All runtime provision methods come from the current production
`PaymentProvisionFlow` mixin. There are **no missing-hook shims**. The earlier
private runtime had stale mixins; the final tests use the fresh complete runtime.
A regression checks the actual mixin method identity to prevent accidental
substitution. The production and mirror provision modules differ, but neither is
included in this deployment payload.

The preview executes the actual unchanged `ChannelMessenger` class parsed from
the current `channel_bridge.py`, with its real presentation helper imports. This
avoids importing unrelated HTTP/signature services. It does not reimplement poll
serialization or start a channel server. The synthetic catalog contains
`FERRAMENTAS DE TESTE` and `MÁQUINAS FICTÍCIAS`.

Use the explicit Python executable on this Windows workstation:

```powershell
$python = 'C:/Users/Bernardonotini/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
$privateTask = 'C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr/work/asset-group-inline-20261030'
$env:PYTHONPATH = 'C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr/work/back-navigation-20261030/test-deps'
$env:ASSET_GROUP_SOURCE = "$privateTask/runtime-live"
$env:ASSET_GROUP_CANDIDATE = "$privateTask/candidate"
& $python -X utf8 -B -m pytest -q -p no:cacheprovider backend-patches/asset-group-inline-registration/tests
& $python -X utf8 -B backend-patches/asset-group-inline-registration/export_fixture.py "$privateTask/preview-poll.json"
```

Unset `ASSET_GROUP_CANDIDATE` to exercise the unchanged baseline. The expected
12 failures demonstrate the missing entry point and child route. See
`verification.json` for final results and hashes. No full controller/backend suite
is run by this package; frontend validation and visual QA belong to the main task.

## Deployment handoff

Public review material: `source.patch`, `deploy-manifest.json`, `deploy.py`,
`package.py`, tests and this documentation. Full sources and `source-files.tar`
remain only in the private task directory. The assembled local package is
`work/asset-group-inline-20261030/package`.

The exact remote stage is `/home/opc/asset-group-inline-20261030/package`. Its files
are `source-files.tar`, `deploy-manifest.json`, `source.patch`, `deploy.py` and
`shared-deploy.py`. The shared runner is the LF-normalized
`backend-patches/launch-payroll-per-payment/deploy.py`, pinned by the installer.

The manifest SHA256 is
`9097f7b9fa2bcadfddabe1bb49182236ef5d8ca3c30c5be72f94b705e67c70a4`.
After staging, the release owner runs:

```sh
sudo python3 /home/opc/asset-group-inline-20261030/package/deploy.py --check 9097f7b9fa2bcadfddabe1bb49182236ef5d8ca3c30c5be72f94b705e67c70a4
sudo python3 /home/opc/asset-group-inline-20261030/package/deploy.py --deploy 9097f7b9fa2bcadfddabe1bb49182236ef5d8ca3c30c5be72f94b705e67c70a4
```

The installer permits exactly these two files in the two fixed runtime roots.
It checks separate production/mirror baseline hashes, manifest/patch/archive
hashes, exact regular archive members, candidate hashes and Python compilation.
It uses the deployment lock, verified backups, atomic installs, service health
checks and rollback that preserves concurrent source changes. Guard tests use
temporary local fake roots and never contact the VM.

No VM writes, deployment, service restart or shared-branch commit was performed
for this handoff. Main owns frontend integration and Android/iOS/Windows release.
