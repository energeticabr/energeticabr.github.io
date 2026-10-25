# Future supplier employment registration

Task 2 of `docs/superpowers/plans/2026-10-24-inss-fgts-completion.md`.
This package adapts PR556's feature hunks onto two independently captured current
workflow sources. It does not contain complete captured workflows or credentials.

Every new EMPREITEIRO=SIM registration selects one of eight roles and a valid
admission date for CLT, TERCEIRIZADO and INFORMAL. Date validation also applies to
restored confirmations. Version-1 and older indices/edit menus migrate by step
key to version 2 without creating future-registration authority.

The new registration entry points persist a positive flow marker. A second durable
receipt is written before the first source POST. Source lookup, legacy resume,
migration and old uncertain POSTs cannot acquire that authority. Source and RH
creation both reconcile uncertain results and refuse another blind POST.

The ordinary source writer excludes DATAADMISSAO and DATADESLIGAMENTO. The target
helper keeps the public interface
`register_from_submission(client, supplier_id, fields, files, state_store=...)`.
It validates the 27 existing target columns, unique/indexed source identity,
explicit answers, original local bytes and destination readbacks. It never reads
the supplier list to import employees, never downloads source attachments and
never creates schemas or changes permissions. Historical bootstrap is a separate
parent operation and gains no exemption through this helper.

Before source creation the engine freezes the answers and local-file manifest.
Missing files require explicit reuploads with the same original name, size and
SHA-256. Retained slots are reserved before missing slots are matched. Order,
multiplicity and frozen remote names survive restart and out-of-order arrivals.
Confirmed destination retries preserve subsequent RH lifecycle edits.

## Reproduce privately

Use the explicit Python executable supplied in the task brief. With the fresh
code-only capture directory as LIVE and an output outside the checkout:

```powershell
& $TaskPython backend-patches/contractor-employment-register/package.py --live $TaskLive --output $TaskCandidates
& $TaskPython backend-patches/contractor-employment-register/tests/run_local.py --private-output $TaskOutput --label reused-77-final --reused-77
& $TaskPython backend-patches/contractor-employment-register/tests/run_local.py --private-output $TaskOutput --label final-extended
```

`package.py` pins the three named capture files independently before generating
anything. It applies only exact, unique feature contexts from `feature.patch`;
it never uses an old complete workflow. Inputs, output aliases, Python syntax and
JSON are validated before candidate writes. Output contains eight code/config
candidates, the sanitized diff, manifest, installer and its two pinned code
dependencies; no archive is required. Only the eight manifest targets are
installed. The
committed `source.patch` and `deploy-manifest.json` must match that private output
byte for byte. The current config and every existing workflow method outside the
seven reviewed methods are covered by adaptation guards.
Directory-scoped Git attributes keep code, JSON, diffs and documentation at LF
when checked out on Windows or Linux, preserving the reviewed package hashes.

The runner reads only the fresh code-only support capture and the selected
candidates. It uses local requests/tzdata/pytest dependencies, fake HTTP and private
state/media. Windows temporary paths use the extended path prefix. The original
77 scenarios remain, including ten installer scenarios adapted to the new
eight-target representation and retained-helper rollback. The old schema tests
use a synthetic-only legacy fixture; it is not included in deployment. Copies of
the current homologation and WhatsApp regression fixtures change only
`supplier_employment_version=1` to `2`; their assertions are unchanged.

## Parent-only rollout

The manifest lists exactly four destinations in each of
`/opt/energetica-whatsapp` and `/home/opc/energetica-build`:

- `worker/workflow.py`
- `worker/workflow_config.json`
- `worker/contractor_employment.py`
- `worker/supplier_registration_checkpoint.py`

The existing four files have independent before/after SHA-256 pins. The four new
helper destinations explicitly pin absence. No bridge, client, schema, ACL or
other module is installed. Place the candidate stage outside both code roots.

The installer uses the current reviewed `attendance-rhid-badges/deploy_context.py`
and `patch_presence_context.py`, with their hashes verified before packaging and
on import. The generated private stage includes those exact two code files under
`deployment_helpers/` beside `deploy.py`. Supply the independently reviewed
manifest hash, not one computed from an unreviewed remote stage:

```text
python3 deploy.py PRIVATE_CANDIDATE_STAGE --manifest-sha256 REVIEWED_HASH --check
python3 deploy.py PRIVATE_CANDIDATE_STAGE --manifest-sha256 REVIEWED_HASH --apply
```

Both modes acquire `/tmp/energetica-whatsapp-deploy.lock` and
`/home/opc/.energetica-deploy.lock` internally. Check mode validates all eight
current/candidate states, syntax and both service health endpoints without
writing code or making backups. Apply creates verified backups, atomically
publishes helpers create-only with hard links, and uses the reviewed non-clobber
CAS installer for existing files. It restarts both existing services, verifies
health and all eight installed hashes, and writes a receipt under the private
backup directory. Hash drift, aliases, missing/extra targets and already present
helpers fail closed.

Rollback ruling: portable unlink does not offer a safe compare-and-swap. Newly
published helpers are therefore retained inactive, with their exact paths/hashes
and candidate-match state in the rollback receipt. Existing workflows/configs
are restored through non-clobber CAS. A concurrent writer is preserved, and an
incomplete rollback reports retained recovery paths. A new apply requires review
of those retained helpers because the original manifest still requires absence;
the installer never deletes them to make a retry pass. This avoids deleting
another writer's file and is the policy explicitly allowed by the Task 2 brief.

Worker verification is synthetic and local. The parent owns independent review,
production checks/apply, installed-candidate synthetic verification and the
separate seven-person bootstrap.
