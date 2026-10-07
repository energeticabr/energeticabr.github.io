# Pagamentos pendentes por fornecedor

User asks for the supplied PowerFx report and mascot above the latest pink pending-work-diaries shortcut. Extend the existing readonly report infrastructure; no business writes.

## Data and rules

- Load complete FORNECEDORES, DESCRITIVOPRESENCA and LANCAMENTOS snapshots through Graph Sites.Read.All. Resolve real metadata, ignoring computed LinkTitle aliases. Reject ambiguous/missing required columns, malformed rows, duplicate IDs, partial pagination and cursor loops. Never display partial financial totals.
- Default period: first calendar day of current local month through today. Supplier status ATIVO. Searchable branch, supplier-status, supplier and presence selects use existing PowerApps-like picker without autofocus keyboard.
- Contractors only (EMPREITEIRO SIM). Branch/name/status filters select supplier registries. Duplicate supplier names with different financial/branch identity must fail closed rather than assign or double-count debts ambiguously.
- Pending block follows the supplied formula independently of period/presence filters: STATUS PENDENTE PGTO count; PRESENTE approved sum; PENDENTE and STATUS PENDENTE PGTO validation sum. Timeline includes all unpaid rows plus AUSENTE rows since today minus 14 days. Ascending dates, sorted suppliers by approved amount descending. Overall pending footer is approved sum only, as in PowerFx, explicitly labeled approved so validation is not confused with it.
- General detail follows inclusive period, presence and branch filters, ordered by occurrence count descending. It includes work dates/status/payment IDs/motivation/observation, supplier payments in period and distinct referenced payments in another name (even outside period). General financial approved uses PRESENTE/PENDENTE PGTO; validation uses all PRESENCA PENDENTE, matching formula.
- Use Decimal sums/products. Null or malformed monetary inputs are not zero: display VALOR INCOMPLETO; zero/blank daily entry tags say CONFORME MEDIÇÃO. AUSENTE contributes no approved/validation amount. Hours use the two HH:mm shifts; missing pairs zero as PowerFx, invalid/inverted populated shifts produce an explicit unknown-hours warning. Expected supplier hours default 8 when blank/zero; mark short hours or a differing daily amount.
- Preserve formulas' historical backlog but do not copy its unsafe FirstN 2000 truncation: complete pagination, safety cap errors, never silently truncated totals.
- Review integrity rulings: unqualified single-dot three-digit amounts (1.234) remain unknown; fractional zero-dot values (0.125) remain decimal, explicit R$ grouping/localized formats are supported. Validate the complete source ISO date/timestamp before extracting its day. Unmatched unpaid supplier names warn before filters and make overall totals unknown, while preserving identified contractor rows and deliberately excluding known noncontractors.

## UI and integration

Pink rail: cargos → attendance → stages → supplier-payroll → pending-supplier-payments → pending-work-diaries. Orange rail unchanged thereafter. New action open-pending-supplier-payments-report, resume ID home-pending-supplier-payments-report. Both centered red arrows; reserve both side margins so arrows cannot cover values.

Show official logo, cream pending heading, tan five-column table (FILIAL/FORNECEDOR/DIÁRIAS/DATAS/PENDENTE), colored presence lines and approved/validation/total badges. Blue four-column general-detail table below. Use DOM textContent, not HTML injection. Keep close, portrait warning, refresh cancellation, safe errors, inert/focus handling and account/origin/session guards. Shared filtered PDF with forwarding and close/return. Import CSS in native and web entries.

Transparent sharp bitmap matching supplied mascot; tile CSS #cf757a. No signature-block edits.

## Delivery

TDD focused data/model/view/lifecycle/navigation coverage, responsive browser QA, full app and root suites, builds/gesture/secret/iOS guards, fresh whole-branch review. Merge only green CI and verify same-revision Web/Windows PWA, internal Android and TestFlight publication. Verify live report/filter/PDF/navigation without submitting or forwarding business records.
