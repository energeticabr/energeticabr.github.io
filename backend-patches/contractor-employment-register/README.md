# Future contractor registrations — backend

The new `FUNCIONARIOSRH` list starts empty. Only future app registrations with
EMPREITEIRO=SIM and STATUS=ATIVO can create a record. This implementation does not
import old suppliers, read their schema/data/attachments/ACLs, add source columns,
install a background job, or change permissions/application scopes.

## Submission contract

```python
receipt = contractor_employment.register_from_submission(
    client, supplier_id, fields,
    files=[{"filename": "example.pdf", "content": local_bytes}],
    state_store=state_store,
)
# {"status": "registered", "supplier_id": ..., "target_id": ..., "verified": True}
```

`fields` contains the validated private answers. `files` contains the same local
bytes uploaded during the normal supplier registration, not downloaded source
attachments. Call only after the original supplier receipt and uploads are
verified. Failures raise; the workflow must not announce completion beforehand.
Actually ineligible answers return `status="skipped"` without remote requests.

Two durable proofs enforce the cutover: a positive marker written only when a NEW
registration flow starts, and the matching token/flow receipt frozen before its
FIRST new source POST. Source token lookups, legacy sessions, migration, known old
IDs and unmarked old uncertain checkpoints cannot authorize HR creation. The
normal supplier registration still completes for such cases without an HR row.
No marker is assigned retroactively during resume/migration.

Before any source POST, the workflow freezes the validated answers and a local
original-name/frozen-SharePoint-name/size/SHA-256 manifest in its private session state. Retry/restart reuses
the same token, answers, files and IDs. Missing local files request reattachment;
removing a missing file cannot silently complete a smaller submission. An explicit
reattachment is matched by the exact original name, actual size and content hash;
its new local reference is rebound to the frozen SharePoint name. Surviving files
are reserved first, every missing slot consumes one matching reupload, and the
original manifest order is restored and saved before retrying uploads. Changed
names/bytes, extra files or missing multiplicity fail without more writes. No source
download fallback exists. Admission/discharge never enter the source payload or
source verification; the existing CARGO source field remains supported.

HR creation deliberately bypasses generic `ensure_item`: a durable intent hash
and `create_pending` checkpoint precede its single POST. After an uncertain POST,
lookup by the unique target key reconciles its receipt. An invisible outcome
never authorizes another POST, including across service restarts. Partial file
copy resumes the existing target and verifies names AND bytes. The entire initial
payload is read back before success. Repeating a verified intent never MERGEs or
reactivates an employee: subsequent explicit status/cargo/date edits are retained.
Changed intents, duplicate keys and untracked existing targets fail closed.

## Explicit field map

All fields below are independent target definitions, not discovered source names.

| Type | Internal names |
| --- | --- |
| Text | Title (display CADASTRO), IDFORNECEDORORIGEM (unique/indexed), CARGO, EMPREITEIRO, STATUS, FILIAL, TIPO, CIDADE, VINCULO, HOMOLOGACAO, TIPODOCUMENTO, DOCUMENTOFORNECEDOR, TELEFONECONTATO, WHATSAPP, EMAIL, PROFISSAO, FORMAPGTO, VLRDIARIO, HORASTRABALHO, MEDICAOATUAL, IMOVEL |
| Plain Note | ENDERECO, DESCRITIVOETAPAATUAL, ATIVIDADEEXERCIDA |
| DateTime / DateOnly | DATAADMISSAO, DATADESLIGAMENTO, DATANASCIMENTO |

Input aliases: CADASTRO→Title; HOMOLOGAÇÃO→HOMOLOGACAO; DOCUMENTO FORNECEDOR→
DOCUMENTOFORNECEDOR; ENDEREÇO→ENDERECO; FORMA PGTO→FORMAPGTO; VLR DIARIO→VLRDIARIO;
DESCRITIVOETAPA ATUAL→DESCRITIVOETAPAATUAL; ATIVIDADE EXERCIDA→ATIVIDADEEXERCIDA;
MEDIÇÃOATUAL→MEDICAOATUAL. Other input names are unchanged. No source audit clones.
Blank optional values remain blank; dates are not guessed. Date-only writes use
São Paulo civil midnight converted to UTC, including historic timezone offsets.

## Schema and operational handoff

`schema.provision(client, apply=False, state_store=...)` is a remote read-only plan.
Explicit `apply=True` creates only the new list/missing fields and sets Title's
display label. It validates types, DateOnly and the unique indexed key before
mutation. It refuses populated targets, preserves records, checks ItemCount=0
throughout provisioning and reconciles uncertain list/field creation on retry.
There are no item writes, source calls, role-assignment calls or scope changes.
Use the main controller's fresh `schema_future_live.py` wrapper, which constructs
the existing SharePointClient directly and checks zero items before and after.

Locks and metadata-only checkpoints use the existing shared
`state_store.directory`, normally `/var/lib/energetica-whatsapp/state`, beneath
`contractor-employment-register/<site-hash>/`. They do not use PrivateTmp. Private
session state already holds the user answers; nested checkpoints contain IDs,
tokens, phases and hashes, never business field values or attachment bytes.
Do not delete uncertain checkpoints to retry automatically: an operator must
resolve the outcome from authoritative evidence.

The exact four-file package is:

- worker/workflow.py
- worker/workflow_config.json
- worker/contractor_employment.py
- worker/supplier_registration_checkpoint.py

The two helpers are new. Neither old sync nor ACL modules belong in the archive
or import graph. Deployment uses the clean, mode-700 stage
`/home/opc/contractor-employment-future-20261020`, not the obsolete six-file stage.
`package.py` regenerates public source.patch/manifest and a PRIVATE source tar
from the pinned baseline. Baseline workflow/config hashes remain ec5a5275…441d0
and 80fa8588…ab37d in both production roots. No local command deploys anything.

## Synthetic verification

With `ENERGETICA_BACKEND_TEST_ROOT` set to the private candidate and the supplied
qa-win-deps directory on PYTHONPATH, run:

```sh
python -m pytest backend-patches/contractor-employment-register/tests -q
```

The helper/provisioner tests use the real SharePointClient with a synthetic HTTP
transport that rejects ANY source/ACL request. They cover empty provisioning,
explicit types, eligibility/cutover proofs, uncertain source/target POSTs,
restart, shared locks, byte verification, partial recovery and inactive history.
Workflow tests exercise the real engine. Deployment tests assemble and validate
only temporary synthetic roots; they never restart real services. Main owns live
provisioning, deployment, frontend/platform validation and publication.
