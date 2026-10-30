# Provision description editor deployment tools

Preparation only until main explicitly approves final candidate freeze and deployment.
Full backend source stays in the private workspace. This directory owns root-level
deployment tools/tests only; functional tests under `tests/` belong to main.

## Exact scope

Deploy these three helpers to both `/opt/energetica-whatsapp` and
`/home/opc/energetica-build`:

| File | Required BEFORE SHA-256 |
| --- | --- |
| worker/provision_description_settlement.py | bb4b610563da6697024c62b7786f486d49eabebd5eea1e623007ef440d77ce78 |
| worker/provision_description_review.py | 4364ed22c8f7e275e8d60ed69f0aae5691cd76d4bea06487f791cb072d3d5fc0 |
| worker/provision_description_query.py | ec7db85c31cad0a2d85ebd1a090ed9b24991da4e46dfa85f3fabaec9f9b240fe |

Guard these unchanged in **both** roots; neither enters the candidate payload:

| File | SHA-256 |
| --- | --- |
| worker/workflow.py | 051268c3944d956cf40b81ba7e1558681387276df7694b61e5992fd2d0a39dad |
| worker/workflow_config.json | a951c15f30d78409101b7829bdf9bad3cf118ac7541c3dcaa705663e962bf069 |

The manifest cannot drop/override these guards or add other files. Any code,
guard, input or candidate drift aborts. No workflow imports, fiscal/tenant queries,
queue processing or record operations occur in these tools.

## Local verification

From this directory with a real Python interpreter (not the Windows Store alias):

```powershell
& $Python -B -m unittest test_deploy -v
```

Tests use temporary roots, synthetic code/config and fake service/lock runners.
They exercise all six destinations, per-target attribute forwarding, backup,
read-only check, CAS, guard drift before/during apply, alias refusal, rollback,
unknown concurrent writers, reentrant lock, drain/watchdog cleanup, and private
package scope. They never use the actual private candidate or a remote host.

## Freeze only after review GO

`$PrivateWorkspace` must contain sibling `baseline/` and `candidate/` outside the
repository. Both trees must contain the unchanged guarded workflow/config. All three
helper candidates must differ from their exact baseline pins and compile.

```powershell
& $Python -B .\package.py --freeze $PrivateWorkspace
```

This explicit command creates a new private `release/` (never overwrites it) and
publishes only zero-context `source.patch` plus `deploy-manifest.json` here. It
does not stage, restart or deploy. No freeze is implicit in tests/imports.
The private release contains exactly eight files: three candidate helpers, four
hashed deployment inputs, and one manifest. All checkout text uses LF to preserve
reviewed hashes on Windows.

## Stage/check/apply only after the applicable GO

Use a **new** remote directory, never overwrite an existing release:
`/home/opc/provision-description-edit-20261030/release`. Copy the eight reviewed
files exactly, check every hash against the reviewed manifest, then harden staging
ownership/permissions so runtime users cannot alter it. The manifest SHA must be
the externally reviewed value, not merely a freshly calculated value from an
unreviewed remote package.

Check as root using the existing SSH route:

```sh
sudo -n /opt/energetica-whatsapp/.venv/bin/python -B /home/opc/provision-description-edit-20261030/release/deploy.py --check REVIEWED_MANIFEST_SHA256
```

Only after separate apply GO:

```sh
sudo -n bash /home/opc/provision-description-edit-20261030/release/deploy.sh REVIEWED_MANIFEST_SHA256
```

`--check` takes the existing lock read-only and reads code/health only. It does not
create a backup, install a gate or restart services. It requires BEFORE pins, so
do not rerun it after successful deployment: verify installed AFTER hashes instead.

## Apply behavior and evidence

The source-specific copy preserves the reviewed partial-settlement installer design:

- Hold `/tmp/energetica-whatsapp-deploy.lock` across the entire operation, with
  reentrant nested checks and no read-only-to-write escalation.
- Gate new non-root localhost ingress to port 8765 and drain existing requests
  for at most 30 seconds. A 300-second watchdog protects gate removal. No forced
  request termination; drain failure stops before code changes.
- Back up all six original helper files before replacement under a unique
  `/var/backups/energetica-whatsapp/provision-description-edit-*` directory.
- Recheck package/candidate/unchanged guards and per-target BEFORE pin before
  each atomic same-directory replacement; preserve each target's uid/gid/mode.
- Verify both roots, restart only `energetica-channel-bridge.service`, then allow
  up to 30 seconds for both services and HTTP 200/status ok before rollback.
- On failure restore attempted helper replacements in reverse order, preserving
  unknown third-party source bytes; guarded workflow/config are never restored
  or overwritten. Record rollback failures explicitly.
- Save `receipt.json` beside backup files. Gate cleanup failure cannot produce a
  clean deployment receipt. Successful receipt includes six installed hashes,
  both guard pins, `workflowUnchanged`, `configUnchanged` and service health.

Independently read back six installed helper hashes, workflow/config hashes in
both roots, attrs, service active/health, no `description-edit-` gate rule or
`energetica-description-edit-release-` timer, and a free shared lock. No live
financial QA is part of this package. Source-only checks prove deployment state,
not user record behavior.
