# SWILE by RH supplier

Replacement for the legacy weekly benefit flow. A daily native Power Automate
flow reads all `FUNCIONARIOSRH` pages and keeps Wednesdays through today +14
days populated. The configured exception uses `IDFORNECEDORORIGEM`, not a name
fragment. No role or supplier-catalog filter determines eligibility.

Each Wednesday has one `DESCRITIVOPROVISAO` whose supplier is SWILE. Its child
`PROVISÃO PGTOS` rows use the respective RH supplier, branch and property. Each
child stores QTD5 × unit45, freight0 = R$225. `VALORTOTAL` on the child is the
existing **unit price** column; the parent holds the extended aggregate total.

## Build and verify

Python 3.11+, standard library for builders/tests. The server-only CLI uses
the existing authenticated backend client and its installed dependencies.

```powershell
python -m unittest discover -s automations/swile-weekly-rh -v
python -m unittest discover -s automations/monthly-payroll-taxes -v
python -m unittest discover -s automations/weekly-meal-provisions -v
python automations/swile-weekly-rh/build_flow.py --config <private-config.json> --output <private-definition.json>
```

Private configuration contains `excludedSupplierIds` (positive origin IDs),
`startDate` (ISO local date for the 06:00 daily trigger) and
`legacyRecurrenceId` (only the reviewed one-time cleanup source). Keep actual
identities, source snapshots, journals, backups and receipts out of Git.

## Publication

Update the **existing** benefit cloud flow in the default environment; retain
its real SharePoint connection reference and back up its full definition
first. The generated definition uses only the standard SharePoint connector.
It does not generate new PDFs or modify existing attachments.

After an authenticated update, read back the definition, enabled state and
daily 06:00 Brasília trigger. Execute it, independently verify both dated
groups and each supplier link, and rerun to verify zero duplicate creation.
Do not create a second VM/Codex schedule alongside the existing cloud flow.
Generating a definition or merging code is not proof of cloud activation.

The shared provision lists already serve Android, iOS and Windows/PWA. This
automation does not require native UI changes or another binary build.

## Ownership and recovery

- Both target lists must already enforce an indexed unique `FOLHAOPERACAO`.
  The automation checks this and never silently changes schema.
- Parent key: `SWILE-RH:YYYY-MM-DD`; child key appends `:originSupplierId`.
  New rows are not linked to the legacy recurrence ID.
- `Title` ends with `|PREPARANDO` during incomplete creation. Only a complete,
  independently reread group receives the final title and aggregate total.
  OBS contains the business description only.
- Serial daily runs and serial week processing, exact key readback after a
  failed/ambiguous create, and ETags on parent changes protect recovery.
- Paid, scheduled or manually changed weeks are preserved. A later missing
  week can still be created. New RH registrations are added once to open
  default weeks; already created recipients are not silently removed.
- No launches, orders, payroll rows or paid dates are written here. Normal
  provision settlement handles downstream records.

## One-time server migration

`run.py` uses `/opt/energetica-whatsapp` and its normal certificate identity.
Run under that backend's Python/environment; it never prints credentials.
The initial seed can be verified while an owner's cloud-flow login is pending,
but automatic renewal remains incomplete until the native flow is activated.

```sh
python automations/swile-weekly-rh/run.py --config /private/config.json --output /private/receipts --mode preflight
python automations/swile-weekly-rh/run.py --config /private/config.json --output /private/receipts --mode seed
python automations/swile-weekly-rh/run.py --config /private/config.json --output /private/receipts --mode verify
python automations/swile-weekly-rh/run.py --config /private/config.json --output /private/receipts --mode retire
```

The migration holds a process lock and a durable create journal. `retire`
requires verified replacement coverage, persists an atomic full private backup,
inactivates only the selected SWILE recurrence, and deletes only its unpaid,
unscheduled rows. The existing `PAGAMENTO PREVISTO` status is an unpaid state.
Paid records survive. Exclusively owned old groups are removed only when empty
and without attachments. Every deletion is version-checked and reread; no
uncertain financial mutation is blindly repeated.
