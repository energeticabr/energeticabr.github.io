# Monthly payroll taxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate individual INSS/FGTS provisions linked to payroll and a native monthly Power Automate flow without duplicate obligations.

**Architecture:** A pure Decimal model defines the calculation and financial payloads. A deterministic WDL builder reads existing lists, checks versioned rules, freezes a manifest and PDF, then creates two parents and uniquely linked children/payroll rows. A private resumable first-load tool reuses the two pending aggregate origins with ETags.

**Tech Stack:** Python unittest/Decimal, Power Automate WDL, standard SharePoint and OneDrive connectors, reportlab/pypdf for local PDF QA.

**Spec:** docs/superpowers/specs/2026-10-24-monthly-payroll-taxes-design.md

## Global Constraints

- Day 01 06:00 America/Sao_Paulo; previous competence; due day 20; first recurrence 2026-11-01.
- SALARIO only; other salary components never enter the base. No assumed employer tax regime/rates.
- Two parents, one child per eligible supplier and tax, unique IDPROVISAO in FOLHAPGTO, same IDFOLHA and supplier.
- Source PROFISSAO is the product; branch from source; IMOVEL=TODOS, QTD=1, payment method blank.
- Manual previews create no financial records; no settlements, launches, orders or new credentials/scopes.
- Private real-person manifests/PDFs/receipts stay outside git; existing aggregate origins require explicit pending-state checks and CAS.

## Review Focus

- A salary/rate valid today but not in the competence must never silently calculate a historical batch.
- Same-name, wrong-month or duplicated sheets must stop before the first financial write.
- A lost POST response or changed roster must not create a second obligation or switch its owner.
- Paid or concurrently edited aggregate origins must never be overwritten during initial replacement.
- PDF amount, child amount, payroll amount and parent sum must agree to the cent and preserve source profession.

### Task 1: Financial model, manifests and PDF contract

**Files:** Create `automations/monthly-payroll-taxes/model.py`, `reports.py`, `test_model.py`, `test_reports.py`.

**Interfaces:** `plan_month(employees, suppliers, salaries, sheets, rules, execution_date)` returns `{version, competence, createdDate, dueDate, rulesVersion, rows, totals}`; rows carry `supplierId,name,branch,profession,cargo,admission,sheetId,salaryCents,days,divisor,baseCents,components,inssCents,fgtsCents`. `parent_fields(plan,tax)`, `provision_fields(plan,row,tax,parent_id)`, `payroll_fields(plan,row,tax,provision_id)` produce actual field values. `calculation_html(plan,tax)` and `render_calculation_pdf(plan,tax,path)` share these values.

- [x] Write failing behavior tests for prior month/year, partial admission, explicit rules, validity, duplicate identities/sheets, exact payloads and escaped/rendered PDF totals.
- [x] Run bundled Python unittest; observe missing implementation failures.
- [x] Implement Decimal/integer-cent model and reports; test synthetic inputs only.
- [x] Verify complete model/report suite and render/reopen PDFs; commit.

### Task 2: Native monthly flow and package

**Files:** Create `automations/monthly-payroll-taxes/build_flow.py`, `test_build_flow.py`, `README.md`, `.github/workflows/monthly-payroll-taxes.yml`.

**Interfaces:** `build_definition()` and `build_package(output_dir)` consume Task 1's manifest/payload contract and the existing standard connector pattern. Versioned rules are loaded from a private OneDrive JSON file; missing/expired rules fail closed.

- [x] Write failing generated-payload tests for schedule, pagination, rule/sheet guards, no off-schedule finance, unique origin keys, exact readback, PDF identity and recovery.
- [x] Implement WDL with integer-cent calculations, frozen JSON/PDF recovery, uniqueness and read-after-write; no premium connector.
- [x] Run both monthly and existing weekly automation suites; validate package maps and WDL graph; commit.

### Task 3: First load, cloud publication and independent verification

**Files:** Private `output/monthly-inss-fgts-20261025/` scripts, plans, backups and receipts; public sanitized `docs/verification/monthly-payroll-taxes-20261025.md`.

**Interfaces:** Frozen plan/payloads from Task 1, package from Task 2, existing service identity and authenticated Power Automate connections.

- [x] Re-read actual schema/data and confirmed calculation settings; add only the explicitly supplied Supervisor salary if missing.
- [x] Preview the actual intended initial changes and PDF before invoking the authorized first load; require ETags/pending state and exact person/month correspondence.
- [x] Import one flow using existing connections, validate a no-finance preview, and verify the 01/11 recurrence.
- [x] Execute/reconcile the authorized first load only after all financial rules are known; verify each child, payroll row, parent sum and PDF bytes independently.
- [x] Obtain one fresh whole-branch review and fix important findings with RED/GREEN tests.
- [x] Run CI and verify the live outcome without claiming a future scheduled execution has already occurred.

Final integration uses [PR 592](https://github.com/energeticabr/energeticabr.github.io/pull/592).
GitHub is the authoritative merge/check record; sanitized cloud and initial-load
evidence is in `docs/verification/monthly-payroll-taxes-20261025.md`.
