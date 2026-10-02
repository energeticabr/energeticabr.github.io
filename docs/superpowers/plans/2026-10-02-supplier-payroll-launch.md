# Supplier Payroll Launch Implementation Plan

> For agentic workers: use superpowers:executing-plans to implement inline; request independent review before merge.

**Goal:** Criar folha por rubrica com lançamentos e vínculo opcional ao IDFOLHA.
**Architecture:** Modelo puro de rubricas/validação/menu; serviço SharePoint com metadata e idempotência; página DOM própria; integração pequena no controlador e menu existente.
**Tech Stack:** JavaScript, Decimal.js, DOM, Graph/SharePoint repository, Node test runner, Vite.
**Spec:** ../specs/2026-10-02-supplier-payroll-launch-design.md

## Global Constraints
Preservar 14 blocos protegidos. Não gravar dados produtivos na validação. Publicação apenas em canais internos. Dados/opções sempre cadastrados; sem valores financeiros inventados.

## Review Focus
- Retentativa após resposta de gravação perdida não duplica lançamento.
- Fornecedor inativo, produto removido ou etapa de outra filial impedem gravação.
- Mudança de sessão invalida callbacks e destrói dados/arquivos da página.
- Comprovante falho mantém linha existente e retoma somente upload pendente.
- Sem IDFOLHA elegível informa usuário sem perder lançamentos.

### 1. Modelo e leitura SharePoint
Files: src/chat/supplier-payroll.js; src/chat/supplier-payroll-data.js; tests/supplier-payroll*.test.mjs.
Interfaces: PAYROLL_LAUNCH_REPLY_ID; isSupplierPayrollMenu(message,flow); validatePayrollDraft(draft); payrollTotal(lines); createSupplierPayrollData(options) with prepare(), loadSuppliers(), loadProducts(supplier), loadAccounts(), loadStages(supplier), loadSheets(supplier), post(draft,progress), linkPayroll(result,sheetId,progress).
- [x] Testes falhando para filtros/menu, decimais, mapeamento de campos, idempotência, falhas parciais e vínculo.
- [x] Implementar modelo e serviço usando repository injetável, metadata real e transporte existente.
- [x] Confirmar testes específicos verdes.

### 2. Página e integração
Files: src/ui/supplier-payroll-view.js; src/ui/supplier-payroll.css; src/app-controller.js; src/ui/chat-view.js; src/web/browser-auth.js.
Interfaces: createSupplierPayrollView({data,root?,documentRef?,onClose,assertSession}) returns open(),close(),destroy(). Factories in controller supplierPayrollFactory/supplierPayrollDataFactory.
- [x] Testes falhando para sequência data/fornecedor/produto/rubricas/etapa/resumo/post/link, ausência de escrita no resumo, envio duplo, anexos por rubrica, saída de sessão e menu Novo Pedido.
- [x] Implementar página responsiva com rascunho preservado, campos fechados e feedback de falhas.
- [x] Integrar somente na modalidade Novo Pedido, interceptar seleção sem enviar opção desconhecida à VM; fechamento retorna à modalidade original.
- [x] Confirmar testes específicos e validar no navegador em celular/tablet/desktop.

### 3. Verificar e publicar
- [x] Executar suite completa, builds mobile/PWA, guards, segredo e diff.
- [x] Revisão independente e correção de achados materiais.
- [ ] Criar PR, anexar e integrar main.
- [ ] Acompanhar publicação automática e confirmar web, TestFlight e Play interno da revisão correta.
