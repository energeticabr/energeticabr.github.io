# Monthly INSS / FGTS verification — 2026-10-25

This record is intentionally sanitized. Real names, salaries, guides, calculation
documents, manifests, transport journals and tenant receipts are private and are
not repository artifacts.

## Implemented scope

- Native Power Automate recurrence: day 01, 06:00 Brasília, starting 2026-11-01.
- Previous competence, expected payment on day 20, SALARIO-only calculation.
- Two tax descriptions, one provision and one FOLHAPGTO record per eligible
  supplier/tax, with consistent supplier, IDFOLHA and unique IDPROVISAO.
- Standard SharePoint / OneDrive connectors, existing connections, no new scopes.
- Frozen versioned rules, manifest and PDFs; durable per-POST intent; exact
  readback; no blind retry after an uncertain financial response.
- Global existing-record/PDF/identity preflight, fresh pending-state validation
  before payroll creation and attachment upload, and full final child-set check.
- Missing/duplicate payroll sheets, stale rules or changed/settled records stop
  the batch. No guessed identity, paid launch, settlement or money movement.

## Initial individualization

The two pending aggregate origins were reused using their audited ETags. The
resumable operation created ten individual provisions and ten payroll links for
five eligible people. Two existing child rows were reused; eight were added.

A fresh independent GET-only process verified each supplier/sheet/provision/payroll
relationship, the parent sums, ten pending states, four unchanged original guide
hashes and twelve exact calculation-PDF attachment copies. A representation-only
Number foreign-key mismatch stopped the first attempt safely; the same frozen
plan and durable journal resumed without repeating the two prior CAS writes.

The published application was opened and its INSS and FGTS payroll filters each
visibly showed five correct individual rows. All seven current RH people already
have a unique October sheet for the next scheduled competence. None of these
checks created paid launches or payments.

## Code verification

- 96 monthly tests and 23 existing weekly regression tests passed locally.
- Private transport adapter: 27 tests passed; actual transport is single-write,
  uses exact ETags for the replacement, and does not log credentials.
- Native definition: 497 actions, maximum depth 7; action/expression/dependency
  limits covered by tests. Numeric arguments are not accepted by the test
  implementation of the native `empty` function.
- Independent whole-branch review approved the final builder, SHA-256
  `dd7cf1046df478a95f0a06206ee2cf4425407cb9837bc45e4e1a8a06a961b3e0`.
- Race regressions confirm zero payroll POSTs if the source provision is settled
  or changed before payroll creation, and no attachment upload after settlement.

## Cloud and publication evidence

The same native flow was updated rather than duplicated. Earlier cloud previews
completed successfully, with both native PDFs downloaded, reopened and visually
checked against the frozen manifest. Manual execution outside day 01 is preview
only and does not exercise the monthly financial-write branch.

Final package SHA-256:
`3c09be4c79668e8c4b324c859b2bfe015b5267b3a8040699c2df099b119a5e30`.

The final 497-action package was accepted as an update to the same flow. Its
manual cloud replay, started 2026-10-24 23:58 Brasília, succeeded in 00:01:53;
the details page subsequently showed Status On and Succeeded. The frozen preview
was reused. A fresh GET-only audit again confirmed the initial ten provisions,
ten payroll links, four original guides and twelve calculation-PDF copies.

Remote monthly contracts and signature-lock checks passed for the reviewed code
and isolated test fixtures. The [contracts run](https://github.com/energeticabr/energeticabr.github.io/actions/runs/40156496986)
is remote CI evidence, not evidence of a future financial run.

Integration and final commit/check status are recorded by
[PR 592](https://github.com/energeticabr/energeticabr.github.io/pull/592).
The first scheduled financial execution has not yet occurred; it is 2026-11-01.

No mobile or desktop client source changed. The automation and shared records
are available to the existing Android, iOS and Windows clients; no new client
binary or store release is asserted for this task.
