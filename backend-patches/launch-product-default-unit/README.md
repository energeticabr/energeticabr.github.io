# Product default unit in launches

The shared launch flow fills `UN` from the selected product and proceeds directly to quantity. The rule applies to single launches and each line of multiple launches. Product changes recompute the unit; the summary exposes the resulting value and its edit menu keeps unit selection automatic.

The catalog lookup uses the selected product ID. A missing or invalid default blocks submission and offers recovery. Pending lines are checked before their first write. Resuming an old unit question or using its old pagination controls advances through the automatic step.

This is a shared VM change for Android, iOS and Windows/web. Existing clients consume the updated questions and fields immediately.

## Deployment package

`package.py` generates a source diff and a SHA-256 manifest for exactly `worker/workflow.py` and `worker/workflow_config.json`. Its complete source archive remains in the private workspace. The manifest pins production and source-mirror baselines independently.

`deploy.py` validates the manifest, source archive and pinned installer, assembles and compiles the candidate, checks current service health, and supports a read-only `--check` before `--deploy`. Deployment holds the existing lock, retains recoverable backups, installs atomically, verifies hashes and health, and restores the originals if publication fails. Rollback preserves concurrent foreign changes.

Run package contract tests:

```sh
python -B -m pytest backend-patches/launch-product-default-unit/tests/test_deploy.py -q
```

The regression suite in `regression/test_launch_default_product_unit.py` runs with the private backend's existing `tests/test_workflow.py` fixtures. Set `PYTHONPATH` to that backend's `worker` and `tests` directories and use its production dependencies with `DRY_RUN=true` and an isolated `LOCAL_DATA_DIR`. All 29 cases passed against the production-derived candidate; all 16 deployment contract tests passed. These checks use fictitious records and make no SharePoint writes.

Generate the package using verified private snapshots:

```sh
python backend-patches/launch-product-default-unit/package.py \
  --baseline <production-snapshot> --candidate <reviewed-candidate> \
  --mirror-hashes <mirror-hashes.json> --output <public-package-directory> \
  --archive-output <private-directory>/source-files.tar
```

Stage the manifest, diff, private source archive, `deploy.py` and the already pinned `shared-deploy.py` under `/home/opc/launch-default-unit-20261028/package`. Execute `deploy.py --check <manifest-sha256>`, then the authorized `--deploy` with the same manifest hash. Keep the returned deployment receipt with the verification artifacts.
