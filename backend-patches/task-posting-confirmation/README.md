# Posting identity after a completed flow

Backend-only fix for the shared Energético workflow service. Android, iOS and
Windows/web clients use this same service; no client assets or native binaries
are changed by this patch.

## Confirmed cause and scope

Resuming a `completed` state fell through to the area menu while retaining its
batch ID and SharePoint receipt. Beginning another task cleared its answers but
not that identity. The idempotent create returned the previous task; strict
verification correctly rejected the different new fields. The original item
was not overwritten. The recent client-side success-card rendering was not the
cause.

The patch:

- Creates a fresh menu state after completion, retaining processed message IDs
  so a replayed old confirmation cannot confirm the next form.
- Separates a legacy menu's next action from its previous receipt, partial diary
  IDs, completed cash journal and navigation history. Pending cash recovery
  remains blocked; its separate durable checkpoint is untouched.
- Recovers an already stranded **task only** when stored navigation proves a
  second empty task form followed an already verified task receipt, and GETs
  confirm that exact older item and idempotency token. The new key is saved
  before creation; the pending answers and attachments remain intact.
- Does not rekey ordinary uncertain writes, merge over an old task, weaken
  verification, or change financial/document creation logic.

## Exact files and deployment

`workflow.patch` applies only to `worker/workflow.py`, using zero-context hunks.
`deploy-manifest.json` pins the production baseline and reviewed candidate.
The wrapper reuses the hash-pinned installer from
`../launch-payroll-per-payment/deploy.py`. A standalone staging package supplies
that same file as `shared_deploy_runner.py`.

Apply from a disposable repository root containing `worker/workflow.py`:

```sh
git -c core.autocrlf=false apply --unidiff-zero workflow.patch
sha256sum worker/workflow.py
```

Expected candidate SHA-256:
`3e0436cce541e7c4497c1b6217a6118bb5e4bef0a2ffa72a27e28bc06aeeb8ee`.

Stage under `/home/opc/task-posting-confirmation-20261009/candidate` and run the
wrapper with `--check` before `--deploy`, passing the exact manifest SHA-256:
`a7d4879a25ae9ca7e5a28f32e8828c2a06721fff8f9ff5dbef82ef7b5eae2d17`.
Only the verified workflow file is installed to production and its build
mirror. The installer preserves ownership/mode, verifies backups, rejects
source drift, restarts the bridge and checks health; failures attempt rollback
of both roots. No state, database rows, credentials or attachments are installed
or deleted by deployment.

## Verification (2026-10-09)

- Initial reproduction failed for a second task and completed-menu resumes
  across registered flow actions. Review added three independently reproduced
  regressions: old confirmation replay, old partial diary ID and old history.
- All **13 focused tests** pass on the candidate and the installed production
  worker with synthetic external-data boundaries. All **7 exact-file installer
  tests** pass, including drift refusal and rollback failures.
- **127 inherited tests** were compared on the exact live baseline and the
  candidate with identical live worker dependencies: 111 pass, the same 12
  failures and 4 errors remain on both, with no new failing test IDs. These are
  not a green full suite. Their expectations include older menu/navigation/
  draft contracts and a fixed past-date assertion. No unrelated production
  behavior was changed to satisfy them.
- Signature gesture guard: all 14 locked blocks intact. Patch replay produces
  the exact reviewed/installed candidate bytes. Independent review approved
  that SHA after closing its three blockers.
- Production and mirror hashes match the candidate; bridge and messaging
  services are healthy. An existing confirmed/preserved task was retried in
  the authenticated app and its distinct new SharePoint item was verified by
  GETs (fields and attachment names). The older task description was independently
  hash-checked unchanged. Afterwards no active `submission_failed` state was
  found. No synthetic records were posted in production.

Backup receipt:
`/var/backups/energetica-whatsapp/launch-payroll-per-payment-20261009T225528219811Z/receipt.json`.

Offline regression commands, using the existing backend test fixtures:

```sh
TASK_POSTING_SOURCE=/opt/energetica-whatsapp \
TASK_POSTING_FIXTURES=/home/opc/task-posting-confirmation-20261009/candidate \
/opt/energetica-whatsapp/.venv/bin/python -B test_posting_identity.py -v
```

`audit_posting.py` reports test IDs and traces for baseline/candidate comparison;
it does not load production credentials or submit records. `verify_live.py`
loads the existing service configuration silently and performs only state reads
and SharePoint GETs. It requires a completed task state, the prior item ID and
the prior description hash; it refuses a missing/different state.

Limitations: this patch does not establish server-enforced atomic uniqueness
for concurrent SharePoint creates or attachment-byte verification. Existing
verification of fields and required attachment names is preserved.
