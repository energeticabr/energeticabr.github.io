# Weekly meal allowance provisions

## Intent and scope

Create a Power Automate cloud flow, Sunday 06:00 America/Sao_Paulo, for the
following Friday. One DESCRITIVOPROVISAO per Sunday, one PROVISÃO PGTOS per
eligible supplier. No LANCAMENTOS, orders, payment settlement, or salary-catalog
changes. Existing clients read the same SharePoint lists without an app update.

The user's standing instruction explicitly requests execution without approval
checkpoints. Implement inline, with a fresh final review before activation.

## Data contract

Read the complete FORNECEDORES list on each new week. Eligibility is
EMPREITEIRO=SIM, STATUS=ATIVO and a CARGO from the eight roles explicitly
provided by the user (three SERVENTE levels, three PEDREIRO levels, MESTRE,
SUPERVISOR). A merely nonblank unrelated company role does not qualify.
Names, IDs and FILIAL are
read from that record, never fuzzy matched. Current seven named suppliers have
IDs 240,253,254,260,264,265,269. The user's explicit supervisor assignment for
source ID 240 bridges its legacy CARGO=ENGENHEIRO; other engineers are not
implicitly entitled, and clearing ID 240's role still excludes it. This
automation does not alter any supplier's stored role.

For every child: PRODUTO and OBS = VALE ALIMENTAÇÃO; QTD = "5";
VALORTOTAL = "45" (the existing child column stores UNIT price); FRETE="0";
IMOVEL=TODOS; FORMAPGTO=""; STATUS=PAGAMENTO PREVISTO;
PGTOAGENDADO=PENDENTE; DATA=Sunday; DATAPREVISTOPGTO=Friday;
no DATAPGTOEFETUADO. Parent total = number of children * 225.00, supplier DIVERSOS
when multiple suppliers, branch DIVERSAS when multiple branches. Child branches
are always their individual supplier's FILIAL.

## Durability and attachment

Use the existing indexed unique FOLHAOPERACAO in both target lists. Parent key:
VA-SEMANAL:YYYY-MM-DD; child key: parent key + :supplierId. The first run freezes
the eligible names/IDs/branches in a private OneDrive JSON manifest. A deterministic
weekly reservation is copied with overwrite=false and pins the manifest/PDF ETags;
it is discoverable even if the financial parent was never committed. Unique
staging files are not a committed snapshot until this reservation exists. Parent
Title pins the reservation ETag as well, detecting accidental reservation edits.
Retries recover the reserved manifest, not a changed live roster.
Read after every potentially ambiguous create, verify fields and exact keys,
and never overwrite settled or manually edited records.

Generate HTML and convert it to PDF with the standard OneDrive for Business
connector before creating financial records. The PDF names every supplier,
quantity, unit value, row total and grand total, with Sunday/Friday dates.
Attach the deterministic PDF to the parent and every child, skipping existing
files of that name only after retrieving their content for comparison. Retain
private working files for recovery; no public links or additional sharing.
JSON content inference is disabled to normalize connector responses to binary
envelopes before parsing. InitializeVariable declares one variable per action.

## Safe validation

Manual executions on non-Sundays use separate VA-PREVIA keys and reservation
paths so they cannot freeze or replace a real financial week. They generate the same detailed
PDF but never create parent or child records. Live activation is complete only
after connections, preview PDF, Sunday recurrence/time zone and enabled state
are verified in Power Automate. Do not create an out-of-schedule first batch.

## Alternatives

Prefer native standard Power Automate + SharePoint + OneDrive actions. Premium
HTTP/Word connectors are inappropriate for the tenant's current license banner.
A VM timer would avoid cloud conversion but would move the requested business
flow outside Power Automate and introduce server scheduling to maintain.

## Verification

Date boundaries; eligibility exclusion; duplicate identities; blank branch;
unit-vs-total field semantics; one grouped parent; exact child link; unique keys;
frozen retry manifest; no financial writes outside Sunday; PDF totals and layout;
no side effects in LANCAMENTOS/NOTASPENDENTES/FOLHAPGTO. Zero eligible rows means
no empty financial parent. A partial source read fails closed.
