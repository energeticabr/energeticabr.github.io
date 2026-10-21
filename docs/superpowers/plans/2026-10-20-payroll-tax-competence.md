# Payroll Tax Competence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Steps use checkbox syntax for tracking. One independent whole-branch review at the end.

**Goal:** Registrar INSS/FGTS na folha do funcionário e da competência confirmada e auditar vínculos antigos sem duplicar obrigações.

**Architecture:** Política mensal pura compartilhada, validada nos serviços antes de escrita. UI explicita competência e IDFOLHA fiscal, mantendo folha normal separada. Auditoria de dados reais é independente e somente leitura até prova inequívoca de backfill.

**Tech Stack:** JavaScript modules, node:test, jsdom, Microsoft Graph/SharePoint existente, Vite; scripts privados de auditoria SharePoint GET.

**Spec:** docs/superpowers/specs/2026-10-20-payroll-tax-competence-design.md

## Global Constraints

- Rubricas literais INSS e FGTS; competência distinta da data de pagamento.
- Não duplicar obrigação, inventar rateio, criar LANCAMENTO antes da baixa ou mudar status/data financeira no backfill.
- Não conceder permissões ou criar colunas; preservar draft RH e blocos de assinatura.
- Publicar mesma revisão em web/Windows, Android internal e iOS TestFlight após validação.

## Review Focus

- Lote misto salário/encargos não deve mover salário para a folha fiscal.
- Janeiro e pagamento histórico devem usar a competência confirmada, não o relógio atual.
- POST incerto/reabertura não devem duplicar origem já vinculada.
- Guia agregada não deve ser contabilizada inteira em várias folhas individuais.
- Folha/fornecedor alterados entre seleção e gravação devem impedir vínculo incorreto.

### Task 1: Política e serviços da competência

**Files:** Create apps/energetico-mobile/src/chat/payroll-tax-competence.js; modify supplier-payroll.js, supplier-payroll-data.js, payroll-payment-data.js, payroll-breakdown-view.js. Tests: payroll-tax-competence.test.mjs, supplier-payroll-data.test.mjs, payroll-payment-data.test.mjs, payroll-breakdown-view.test.mjs.

**Interfaces:** payrollTaxType(value): boolean; payrollCompetenceMonth(value): YYYY-MM or empty; previousPayrollCompetence(date): YYYY-MM or empty; payrollTaxSheet(draft): sheet or null. createSupplierPayrollData.loadSheets(supplier,{competence?}) supports exact historical month. Draft adds taxCompetence and taxSheet; normal sheet preserved. Payment draft adds competence for taxes; loadOptions adds allSheets while sheets remains the normal window.

- [ ] Write failing tests: INSS/FGTS accepted; 2027-01-01 suggests 2026-12; paid 2026-10-20 links September; mixed lines use different sheets; foreign/month-mismatch/missing sheets cause zero writes; failed POST/replay cannot duplicate.
- [ ] Run named tests and observe feature failures (not typos).
- [ ] Implement pure policy and service rechecks with existing field types and source values.
- [ ] Run named tests plus existing payroll suite; inspect zero failures; commit scoped task.

### Task 2: Etapas e resumos da UI

**Files:** Modify apps/energetico-mobile/src/ui/supplier-payroll-view.js, payroll-payment-view.js; tests supplier-payroll-view.test.mjs, payroll-payment-view.test.mjs; add synthetic fixture if required.

**Interfaces:** Consumes Task 1 draft/option contracts. Produces explicit month and sheet choices, payload with confirmed taxCompetence/taxSheet or competence, summary identifying each group.

- [ ] Write failing jsdom tests for tax-only and mixed flow, changing rubric/launch, prior-month default, back/cancel, no matching sheet and historical choice.
- [ ] Observe RED, implement minimal view changes without protected blocks, run view/data suite GREEN.
- [ ] Verify synthetic UI by browser and save screenshot; commit scoped task.

### Task 3: Auditoria e regularização autorizada

**Files:** Private monthly-inss-fgts-20261020/payroll-link-audit scripts/snapshot/handoff only; public sanitized verification receipt without personal data.

**Interfaces:** Consumes live schemas and complete pages for IDFOLHA/FOLHAPGTO/tax sources. Produces candidate list with exact source/supplier/month/sheet/ETag, and blocked cases with reasons.

- [ ] Read audit handoff, verify a representative candidate and uniqueness independently.
- [ ] If safe candidates exist, write/test a guarded exact-target apply with checkpoint/readback, then apply only approved scope; preserve financial amounts/status/dates.
- [ ] If only aggregate/ambiguous candidates exist, perform no financial writes and document the missing individual allocation. Do not manufacture eligible records.

### Task 4: Revisão e publicação

**Files:** Verification docs and scoped production/test files only.

**Interfaces:** Consumes Tasks 1-3 receipts; produces merged revision and separate release receipts.

- [ ] Run full app/root suites, builds, signature guard and diff check; investigate failures.
- [ ] Fresh independent whole-branch review of spec/plan/diff; fix substantive issues with RED/GREEN tests.
- [ ] Push PR, required checks, merge exact reviewed SHA; no duplicate workflow dispatch.
- [ ] Verify Pages live asset, Android internal upload and iOS TestFlight association.
- [ ] Report actual changed links and separately any blocked aggregate backfill.
