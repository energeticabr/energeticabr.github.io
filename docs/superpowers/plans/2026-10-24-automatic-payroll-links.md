# Automatic Payroll Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gravar automaticamente IDFOLHA junto de cada lançamento de folha e confirmar FOLHAPGTO por linha antes de anexos.

**Architecture:** Um helper pequeno valida/provisiona a coluna IDFOLHA e reconcilia referências vazias de operações antigas com ETag. Os serviços existentes de vale e folha mantêm suas validações de fornecedor/competência e tokens idempotentes, passando a vincular antes do upload.

**Tech Stack:** JavaScript ESM, Microsoft Graph/SharePoint repository, node:test/JSDOM, Vite/Capacitor.

**Spec:** docs/superpowers/specs/2026-10-24-automatic-payroll-links-design.md

## Global Constraints

- Não editar blocos SIGNATURE_GESTURE_LOCK; guard deve confirmar 14 blocos intactos.
- Correção histórica limitada ao pedido 440; nenhum teste cria pagamentos reais.
- IDFOLHA opcional no schema geral, obrigatória nos fluxos de folha; ausência/incompatibilidade bloqueia antes de registros financeiros.
- Não sobrescrever referência divergente, duplicar lançamento ou alterar regra de competência de INSS/FGTS.
- Publicar somente Play internal e TestFlight, além de Windows/web, sem produção Play ou revisão App Store.

## Review Focus

- Resposta perdida no POST do vínculo não pode criar duplicata na retomada.
- Alteração de fornecedor ou competência durante a operação bloqueia a próxima escrita.
- Referência legada vazia exige dados completos e ETag; divergência não é corrigida por suposição.
- Vínculo existente com outro token deve ser reconciliado pela origem, sem duplicá-lo.
- Falha em anexo não remove os vínculos já confirmados e não permite sucesso prematuro.

### Task 1: Referência automática e confirmação por linha

**Files:**
- Create: apps/energetico-mobile/src/chat/payroll-launch-reference.js
- Create: apps/energetico-mobile/tests/payroll-launch-reference.test.mjs
- Modify: apps/energetico-mobile/src/chat/meal-voucher-data.js
- Modify: apps/energetico-mobile/src/chat/supplier-payroll-data.js
- Test: apps/energetico-mobile/tests/meal-voucher-data.test.mjs
- Test: apps/energetico-mobile/tests/supplier-payroll-data.test.mjs
- Adapt only the related fixtures to expose the real new column.

**Interfaces:**
- Consumes: repository.resolveList/getColumns/resolveSites/createItem/getItem/updateItem and graph.request; existing sheet assignments and confirmed source IDs.
- Produces: payrollLaunchReferenceColumn(columns), ensurePayrollLaunchSchema(options), and conditional adoption of an empty legacy reference. New launch payload includes the selected numeric IDFOLHA; completion confirms one matching FOLHAPGTO per source.

- [ ] Write failing tests: first launch has IDFOLHA even when FOLHAPGTO rejects; first link precedes second launch and every upload; upload failure retains links; retry reuses IDs; wrong/missing/ambiguous schema or sheet blocks; legacy ETag/concurrent conflicts reject; compatible existing link is reused; tax competence is unchanged.
- [ ] Run `node --test tests/payroll-launch-reference.test.mjs tests/meal-voucher-data.test.mjs tests/supplier-payroll-data.test.mjs tests/payroll-tax-competence.test.mjs` and record expected RED failures.
- [ ] Implement the helper and both coordinators, using actual schema names and existing session/read-back guards. Confirm schema before financial POSTs, references in the initial launch POST, links per line before attachments.
- [ ] Run the focused command to GREEN; run the full mobile suite, builds web/PWA, ios:verify, secrets:verify and signature guard. Expected: zero regressions and 14 unchanged blocks. Record platform skips honestly.
- [ ] Verify the real component with fictitious data at 320/390px, including failed upload and retry. No production financial submissions.
- [ ] Commit, obtain fresh independent branch review and address important findings through RED/GREEN verification.
- [ ] Provision only the optional reference column and, if applicable, fill only pedido 440's verified six references; read back independently. Never rewrite other orders.
- [ ] PR/merge/publish using existing workflows, no duplicate dispatches; verify exact SHA and final target receipts before declaring release.
