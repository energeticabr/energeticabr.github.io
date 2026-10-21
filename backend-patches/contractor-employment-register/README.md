# Contractor employment register — backend

Task 1 only. The implementation is prepared in the private backend candidate as
`worker/contractor_employment.py` and `worker/sync_contractors.py`; the main
controller owns packaging, workflow integration, deployment and timer activation.
No credentials or supplier records belong in this directory.

## Integration contract

```python
import contractor_employment

receipt = contractor_employment.sync_supplier(
    client, supplier_id, state_store=state_store)
counts = contractor_employment.sync_all(client, state_store=state_store)
```

Call after the original FORNECEDORES item is confirmed, before reporting success.
`sync_supplier` returns `status="synced"`, `supplier_id`, `target_id` and the number
of attachments copied. An untracked source that is not EMPREITEIRO=SIM and
STATUS=ATIVO returns `status="skipped"` and `supplier_id`. Previously tracked rows
remain historical rows, including INATIVO and their source dates. Failures raise;
they must not be converted to a successful registration. `sync_all` reads every
source page and returns only `processed`, `synced`, `skipped`, and `errors` counts;
it continues processing independent suppliers after an individual failure.

Batch reconciliation scans only `Id,EMPREITEIRO,STATUS` from the source and
`IDFORNECEDORORIGEM` from the target, following every page of both collections.
Only active SIM rows or already tracked source IDs receive per-item processing.
Other source rows count as processed/skipped without schema or item reads. A batch
with candidates loads and validates each list's schema once, reusing only metadata
within that call; a batch with no candidates reads no schemas. Each selected ID is
still locked, fetched afresh and looked up at the target before writing. A schema
failure counts every selected candidate as an error without repeating schema
requests. Eligibility changes after the initial scan are picked up next batch.

The mirror discovers every writable business column from live source metadata and
uses the exact source internal names and types. In particular, `Title` keeps its
display name CADASTRO, ENDEREÇO remains Number (`field_6`), DATANASCIMENTO remains
DateTime, and CARGO/VINCULO remain Text. Raw REST payloads preserve nulls, numbers
and existing dates, avoiding the generic client's Text/Number coercions. Expanded
business user/lookup fields are written as their ID payloads. System identity,
audit fields and attachment flags are never written as destination system fields.

Additional target columns:

| Internal name | Type / purpose |
| --- | --- |
| IDFORNECEDORORIGEM | Unique, indexed Text; stable source ID |
| DATAADMISSAO, DATADESLIGAMENTO | DateTime, `Format="DateOnly"`, also added to source |
| ORIGEMCRIADOEM, ORIGEMMODIFICADOEM | Original Created/Modified, DateTime |
| ORIGEMAUTORJSON, ORIGEMEDITORJSON | Original expanded author/editor JSON, plain Note |
| ORIGEMSNAPSHOTJSON | Entire source item response plus attachment manifest, plain Note |

The synchronizer does not infer missing roles/dates or execute payroll. It checks
the target schema, fetches the latest source item, mirrors values by source ID,
copies missing attachment names, and rereads the destination before returning
success. Existing destination attachment names are preserved, never overwritten
or duplicated. Later source edits are reconciled on the next run.

## Additive schema provisioning

Make the candidate's `worker` directory importable, using the existing service
environment. `schema.py` defaults to a read-only remote plan:

```sh
python schema.py --plan
python schema.py --dry-run
python schema.py --apply
```

`provision(client, apply=False, state_store=None)` is also available to the main
deployment controller. Before any remote mutation it validates existing field
types, date-only formats, and the key's unique/indexed constraints. Incompatible
existing columns stop the run; it does not retype columns, silently relax the
unique constraint, delete records, or change site permissions. New lists inherit
the site's existing access model only while empty. Before any business field
provisioning, the destination list's permission boundary is reconciled with the
source. A restricted source must have a destination with unique role assignments.

`worker/contractor_permissions.py` must be included in the deployment package.
It reads all paginated PrincipalId/RoleDefinitionBindings plus ReadSecurity and
WriteSecurity. Under explicit schema apply it breaks destination inheritance with
copyRoleAssignments=true, preserving inherited bindings without implicitly adding
caller Full Control. It grants only source principal/role IDs, removes extra
bindings/recipients after successful grants, preserves item security
settings and verifies an equivalent SHA-256 hash. It never ensures/creates users,
changes source/site ACLs, changes application scopes or grants itself permissions.
Missing ManagePermissions access fails explicitly; the operator must report that
block rather than elevate the application. Partial ACL operations copy no data;
rerunning apply reconciles the existing empty list.
First-grant and mid-grant 403 tests inspect every ACL transition: the caller never
gains a new Full Control binding, and no business fields/data are written before
the exact source ACL is verified. Retry finishes reconciliation idempotently.

The synchronizer checks list ACL equivalence before copying and before confirming
success. Source and target items must explicitly report inherited permissions;
unique or unknown item ACLs raise, including changes detected without an item ETag
change. ReadSecurity=2 or WriteSecurity=2 are preserved by schema apply but block
data synchronization: destination native authorship differs, so copying the ACL
numbers alone does not preserve the source's own-item boundary. Timer failures
are counted without logging record values. No live item-permission scan is claimed
by the local tests; the main controller owns that inspection and remote apply.

`--apply` creates the list and missing fields, preserves source field semantics
from SchemaXml while removing storage identities, sets Title's display name, and
verifies a second plan is empty. Reads before creation and reconciliation after
lost responses avoid duplicate lists/columns. A persistent list-create checkpoint
blocks another create when the remote result remains uncertain.

## Shared state, uncertain creates and timer handoff

Pass the worker's real persistent `state_store.directory` to both immediate and
periodic calls. Without that property the module uses
`CONTRACTOR_EMPLOYMENT_STATE_DIR`, then `/var/lib/energetica-whatsapp/state`.
The timer CLI requires an explicit directory or that environment variable, so
deployment cannot silently choose a different location.

Per-site, per-source locks and checkpoints live under
`<state-directory>/contractor-employment-register/<site-hash>/`. Lock files keep
their inode and use the operating system's file locking; they are not placed in
`/tmp`, which systemd PrivateTmp services do not share. Use the same existing
service user and directory for the worker, timer and schema apply. Checkpoints
contain only source/target IDs and phases, never supplier field values.

The destination key must already be unique and indexed before any row write.
The synchronizer deliberately bypasses `SharePointClient.ensure_item`: it writes
`create_pending` durably before a single create request. After a lost response it
looks up the unique key. If still absent, subsequent runs only look up the row
and raise; they never send a second uncertain create. A crash before the POST can
therefore leave a pending checkpoint without a remote item. An operator must
resolve that uncertainty using authoritative evidence before removing/resetting
the checkpoint. Do not delete it as an automatic retry strategy.

The main controller can bind the existing service runtime/environment/user to:

```sh
python worker/sync_contractors.py --state-directory <same-worker-state-directory>
python worker/sync_contractors.py --supplier-id 7 --state-directory <same-worker-state-directory>
```

The full run includes current and previously existing active contractors, along
with updates to tracked historical rows. The CLI uses existing environment names
`SHAREPOINT_HOST`, `SHAREPOINT_SITE_PATH`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`,
`ENTRA_PRIVATE_KEY_FILE`, and `ENTRA_CERTIFICATE_FILE`; it never changes credentials
or loads a guessed environment file. It exits nonzero on failure and prints only
counts/IDs or an exception class, not remote response bodies. This task does not
create/activate a systemd unit or perform remote operations.

## Local synthetic verification

Set `ENERGETICA_BACKEND_TEST_ROOT` to the private candidate, and put the supplied
`qa-win-deps` directory on PYTHONPATH. Then, from the public worktree:

```sh
python -m pytest backend-patches/contractor-employment-register/tests/test_sync.py backend-patches/contractor-employment-register/tests/test_schema.py -q
```

Tests exercise the real `SharePointClient` with only its HTTP transport and token
source replaced. The transport strictly interprets REST routes and persists
synthetic list/item/attachment effects; no test calls SharePoint or reads service
credentials. RED: 20 missing implementation failures. Initial GREEN: 20 tests.
Expanded contracts: 64 passing, including unknown create/list responses, unique
identity, shared-directory locking, real null/number/date payloads, expanded users,
paginated source loading, historical inactivation, explicit partial failures,
CLI default read-only provisioning, and timer exit codes/full-population scope.
The batch optimization was RED on unrelated item requests and repeated schema
reads, then GREEN: 275 unrelated synthetic suppliers now require exactly two
collection GETs instead of 1,101 GETs. Further contracts cover pagination of both
lists, tracked inactive/non-SIM rows, fresh eligibility and per-batch cache refresh.
The permission follow-up was RED on eight ACL/own-item guard cases, then GREEN;
it also covers unknown metadata, missing ManagePermissions, extra roles/recipients,
idempotent retry and accepted-but-unpersisted grants failing hash verification.
The full feature suite (including main-owned workflow/deploy tests) passed 84/84.
The real `local_app.LocalStateStore` is exercised with synthetic sessions, proving
that restart retains identity and the nested mirror state does not become a chat
session. `build_engine` uses `LocalStateStore(Path(LOCAL_DATA_DIR) / "state")`;
the confirmed production path is `/var/lib/energetica-whatsapp/state`.

The repository-wide `python -m pytest -q --tb=line` cannot collect the independent
legacy patch suites under one default import namespace: the observed run stopped
with 40 collection errors (duplicate `test_deploy` modules, missing patch-specific
environment variables and fixtures). This is not evidence of a green global
suite. Workflow, frontend, platform publication and Linux service verification
remain with the main controller.
