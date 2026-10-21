# VALE ALIMENTAÇÃO semanal

Native Power Automate cloud flow; **standard** SharePoint and OneDrive for
Business connectors only. Import into the existing energetica (default)
environment and map the owner's existing connections. The builder contains
no credentials and performs no cloud mutations.

## Build and tests

```powershell
python -m unittest discover -s automations/weekly-meal-provisions -v
python automations/weekly-meal-provisions/build_flow.py --output <private-output-directory>
```

The package imports as `VALE ALIMENTAÇÃO — domingo — provisão semanal`.
Schedule: Sunday 06:00 Brasília, starting 25/10/2026; due date: Friday +5 days.
Manual executions on other weekdays produce only a private PDF preview.

## Data and recovery

- FORNECEDORES: EMPREITEIRO=SIM, STATUS=ATIVO, CARGO filled, identity/name/branch valid.
- One DESCRITIVOPROVISAO for the week; one PROVISÃO PGTOS for each supplier.
- 5 × R$45 = R$225 each; PRODUTO/OBS=VALE ALIMENTAÇÃO; IMOVEL=TODOS; account blank.
- The child column VALORTOTAL stores **unit price 45**, not extended total 225.
- Unique indexed FOLHAOPERACAO keys prevent duplicate weekly records.
- A private OneDrive JSON/PDF pair, referenced by parent Title, freezes the roster.
  Preserve these files for recovery. No public links are created.
- Failed creates are followed by a lookup and strict field checks, never a blind
  second POST. Paid/changed records are not overwritten. Existing PDF bytes must
  match the frozen original, otherwise the flow stops.
- No LANCAMENTOS, orders, FOLHAPGTO or paid dates are created by this automation.
  Normal provision settlement remains responsible for those downstream actions.

## Operations

1. Import, map existing SharePoint and OneDrive connections, verify the flow checker.
2. Run a non-Sunday preview and inspect the complete generated PDF.
3. Confirm provision list counts are unchanged and recurrence is Sunday 06:00.
4. Verify the flow is enabled; do not create a duplicate Codex or VM schedule.
5. On a failed Sunday run, inspect the failed action and resume within the same
   week. A run on a later week belongs to that later week, not an old batch.

The live receipt is recorded separately under `docs/verification/`. A ZIP alone
does not establish that import, validation or activation succeeded.

References: [Microsoft recurrence](https://learn.microsoft.com/en-us/power-automate/run-scheduled-tasks),
[OneDrive standard connector / conversion](https://learn.microsoft.com/en-us/connectors/onedriveforbusinessconnector/),
[SharePoint standard connector](https://learn.microsoft.com/en-us/connectors/sharepointonline/).
