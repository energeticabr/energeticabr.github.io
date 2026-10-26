# One initial review for grouped provision settlement

Uploading a file while the initial provision table was open switched the engine to `collecting_attachments` and cleared its options. The still-visible SUBMETER button was then treated as an invalid attachment reply. FINALIZAR returned to the same review table.

The overview now stages files while retaining the active review question. SUBMETER advances directly to the payment date. Explicit submit/edit actions also recover pre-existing overview drafts left in collection mode. Finishing a collection alone does not approve the table. Payment questions, attachment finalization and final financial confirmation remain unchanged.

The shared backend serves Android, iOS and Windows. No client bundle or native binary changes are required. No financial records or stored drafts are modified by deployment.

## Validation

`tests/test_single_review.py` reuses the real grouped conversation fixture from `../provision-settlement-batch-review/tests/test_batch_review.py`, with synthetic SharePoint and media boundaries. Set `ENERGETICA_BACKEND_TEST_ROOT` to a private source snapshot containing those fixture modules. Isolate `provision_attachment_sync.STATE_DIR` before test discovery; tests must never share the production attachment-control directory.

Installer tests run independently with Python 3.9 and pytest:

```sh
python -B -m pytest -q backend-patches/provision-single-review/tests/test_deploy.py
```

## Release

`package.py` produces a reviewable source diff and a hash-pinned manifest. The full source tar remains on the private VM. The installer allows only `worker/provision_description_settlement.py`, pins both live and build-mirror baselines, creates a recoverable backup, compiles, restarts and checks service health. It rejects source drift and rolls back on a failed release.

Run `deploy.py --check <manifest-sha256>` before `deploy.py --deploy <manifest-sha256>` using the private service interpreter. See `verification.md` for the exact reviewed artifact and release evidence.
