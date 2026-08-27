# Relatorios Consolidados Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os relatorios para que fontes indisponiveis nao aparecam e toda apresentacao represente uma consulta Graph consolidada, limitada e explicitamente parcial quando necessario.

**Architecture:** `report-data.js` executa uma sessao incremental somente leitura, reutilizando `getItemsPage`, validando cada cursor, aplicando apenas filtros Graph derivados de colunas reais e indexadas e interrompendo no teto operacional. `reports-page.js` cancela a sessao anterior em trocas de fonte, filtro ou rota, apresenta progresso e pagina localmente o resultado consolidado; `report-model.js` continua sendo a unica fonte para filtros, indicadores e CSV.

**Tech Stack:** JavaScript ES modules, Microsoft Graph, SharePoint Lists, Node.js test runner, HTML/CSS existente.

**Spec:** `docs/superpowers/specs/2026-08-26-relatorios-operacionais-sharepoint-design.md`

## Global Constraints

- Base exata: commit `a3fc65a3b2fff13b81b3fcb46803200e566b391e`.
- Branch e worktree isoladas em `D:\CodexData`; nenhum ambiente ao vivo sera alterado.
- SharePoint permanece fonte unica e a camada existente de ACL/autorizacao permanece obrigatoria.
- A consulta nunca e ilimitada: no maximo 5.000 itens e 25 paginas Graph de ate 200 itens.
- Ao encontrar continuacao apos o limite, a interface e os artefatos devem dizer `relatorio parcial` e nunca `total`.
- CSV neutraliza formulas inclusive depois de espacos, tabulacoes, quebras e caracteres de controle.

---

### Task 1: Contrato consolidado e filtros Graph seguros

**Files:**
- Modify: `portal/reports/report-data.js`
- Test: `tests/portal-reports-data.test.mjs`

**Interfaces:**
- Consumes: `repository.resolveList`, `repository.getColumns`, `repository.getItemsPage`.
- Produces: `loadReportSource(repository, entity, { filters, signal, onProgress, batchSize, maxItems, maxPages })` com `complete`, `partialReason`, `loadedCount`, `pageCount` e `serverFilterField`.

- [x] Escrever testes para cursor incremental, filtro indexado seguro, rejeicao de `nextLink` externo, cancelamento e limite parcial.
- [x] Executar somente a suite de dados e confirmar falhas pelos contratos ausentes.
- [x] Implementar a menor sessao incremental que satisfaca os testes, sem usar `getItems` ilimitado.
- [x] Executar a suite de dados ate ficar verde.

### Task 2: Modelo consolidado e CSV protegido

**Files:**
- Modify: `portal/reports/report-model.js`
- Test: `tests/portal-reports-model.test.mjs`

**Interfaces:**
- Consumes: todos os itens consolidados da sessao.
- Produces: `buildReportView` para indicadores/filtros globais e `reportViewToCsv(view, metadata)` com aviso parcial e neutralizacao de formulas.

- [x] Escrever testes para metricas sobre multiplos lotes e formulas iniciadas por controles invisiveis.
- [x] Confirmar as falhas esperadas.
- [x] Implementar serializacao segura e metadados de completude.
- [x] Confirmar a suite verde.

### Task 3: Interface, progresso, cancelamento e impressao

**Files:**
- Modify: `portal/reports/reports-page.js`
- Modify: `portal/styles/admin.css`
- Test: `tests/portal-reports-page.test.mjs`

**Interfaces:**
- Consumes: resultado consolidado e callbacks de progresso.
- Produces: tabela visual paginada localmente; filtros, indicadores, CSV e impressao baseados na visao consolidada; `cleanup()` que aborta a sessao ativa.

- [x] Escrever testes para `available=false`, progresso, cancelamento por fonte/filtro/rota, resultado parcial e exportacao/impressao consolidadas.
- [x] Confirmar as falhas esperadas.
- [x] Implementar estados, controles e marcacao acessivel.
- [x] Confirmar as suites de relatorio verdes.

### Task 4: Verificacao e commit isolado

**Files:**
- Verify: `portal/**/*.js`
- Verify: `tests/**/*`

- [x] Executar todas as suites Node e os tres testes legados.
- [x] Verificar sintaxe de todos os JavaScript do portal e `git diff --check`.
- [x] Revisar o diff para confirmar que ACL/autorizacao e ambiente ao vivo nao foram alterados.
- [x] Criar um unico commit na branch `fix/relatorios-consolidados-a3fc65a` e registrar o hash.
