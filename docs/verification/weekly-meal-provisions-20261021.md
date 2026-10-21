# Weekly meal allowance - live verification, 2026-10-21

## Published cloud flow

- Name: VALE ALIMENTAÇÃO — domingo — provisão semanal.
- [Actual flow](https://make.powerautomate.com/environments/Default-0c10f511-7ede-4702-a2d9-bedb26937e0e/flows/4f9e855e-e603-46c5-bcef-82ec4b14ebe4/details).
- Microsoft confirmed creation, then updates to this same flow ID; no duplicate schedule.
- Final state visibly **On**, type Scheduled, owner Bernardo notini.
- Live trigger parameters: interval 1 Week; Sunday; 06:00; (UTC-03:00) Brasilia;
  start `2026-10-25T06:00:00`. Designer preview: `Runs at 6:00 on Sunday every week`.
- First scheduled production batch: Sunday 25/10/2026; due Friday 30/10/2026.
- Standard SharePoint and OneDrive for Business connections; both confirmed connected
  in the actual designer. No premium connector, additional permission, VM timer or
  duplicate Codex automation was introduced.

## Actual executions, not package-only validation

Final definition, restricted to the user's assigned employee roles:

- [New preview](https://make.powerautomate.com/environments/Default-0c10f511-7ede-4702-a2d9-bedb26937e0e/flows/4f9e855e-e603-46c5-bcef-82ec4b14ebe4/runs/08584090187312123957179151414CU23): Succeeded, 26 seconds.
- [Recovery preview](https://make.powerautomate.com/environments/Default-0c10f511-7ede-4702-a2d9-bedb26937e0e/flows/4f9e855e-e603-46c5-bcef-82ec4b14ebe4/runs/08584090185452813172121178509CU23): Succeeded, 15 seconds.

Both were run on Wednesday and therefore used the isolated preview namespace.
The actual generated PDF was downloaded read-only from OneDrive, reopened with
pypdf, rendered with Poppler, and visually inspected: one page, exactly seven
supplier rows, quantity 5, unit R$45.00, R$225.00 each, grand total R$1,575.00.
The unrelated company with an unlisted role is absent. No personal payroll PDF
or named employee fixture is published in this repository.

Final PDF SHA256: `13c4ea4ebbb69c196ac3c40004b1181eff2b0993d613e8f2cd1187fc5b158f2c`.
Imported package SHA256: `781f8dd48c1d0fdec0b4c418ca1359ce0904b49e52af160ec02096f01fbac689`.

The preview PDF's 18/10 creation / 23/10 due dates exercise the current-week date
formula only; it is not a posted provision. Production starts on 25/10 with 30/10 due.

## Financial safety and scope

Read-only queries of both financial lists, filtered by this flow's
`VA-SEMANAL:` / `VA-PREVIA:` FOLHAOPERACAO prefixes, returned **zero records**
after the previews. Existing unrelated recurring activity changed global list
counts during verification, so counts alone were not treated as proof. That
activity was identified and left untouched.

The Sunday financial POST branch is covered by generated-payload/uniqueness
contracts; it was deliberately not invoked outside its schedule. No test charge,
out-of-schedule first batch, launch, order, payroll payment, or settlement was
created. Normal settlement remains responsible for downstream paid records.

## Regression and review

- Full automation suite: **23/23 passing** locally and in the
  [Linux CI contract job](https://github.com/energeticabr/energeticabr.github.io/actions/runs/39604889670/job/119238431477).
- One independent read-only review. Its initialization, JSON inference,
  pre-parent recovery and snapshot-consistency findings were addressed with
  RED/GREEN tests. Live testing additionally caught an expired connection and
  the unrelated nonblank-role supplier; both were corrected before final validation.
- Frozen versions, overwrite=false weekly reservation, distinct connector
  placeholders, isolated preview keys, date rollover, grouping and child unit
  price semantics are covered. Signature guard checks passed; no protected
  gesture blocks or client files were changed.
- Source/CI integration: PR #558. Android, iOS and Windows clients require no
  new binary because the automation writes the existing shared data sources.

Private local evidence retained: final PDF, rendered PNG, active-flow screenshot,
live schedule screenshot, source manifest, and scoped financial read-only audit.
