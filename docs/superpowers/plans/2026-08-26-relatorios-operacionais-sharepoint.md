# Relatorios Operacionais SharePoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar uma area de relatorios operacionais somente leitura sobre as fontes SharePoint autorizadas.

**Architecture:** Funcoes puras produzem dimensoes, filtros, metricas e CSV; um carregador reutiliza o repositorio SharePoint; uma pagina independente coordena a interface. A aplicacao integra uma rota e um modulo, sem alterar os fluxos de cadastro existentes.

**Tech Stack:** JavaScript ES modules, Microsoft Graph/SharePoint, HTML/CSS e `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-26-relatorios-operacionais-sharepoint-design.md`

## Global Constraints

- Login exclusivamente Microsoft.
- SharePoint e a unica fonte de verdade.
- Area de relatorios e somente leitura e respeita permissao `view`.
- Nao alterar Power Apps nem ambientes ao vivo.
- Nao inventar campos, valores ou registros.

---

### Task 1: Modelo de relatorios

**Files:**
- Create: `portal/reports/report-model.js`
- Test: `tests/portal-reports-model.test.mjs`

**Interfaces:**
- Produces: `detectReportDimensions(columns, entity)`, `buildReportView(items, columns, dimensions, filters)` e `reportRowsToCsv(view)`.

- [x] Escrever testes falhos para deteccao de data, filial e status.
- [x] Executar o teste e confirmar falha por modulo ausente.
- [x] Implementar a deteccao deterministica por metadados e nomes reais.
- [x] Escrever testes falhos para periodo inclusivo, filial, status e metricas.
- [x] Implementar filtragem sem reclassificar status desconhecido.
- [x] Escrever teste falho de CSV escapado e protegido contra formulas.
- [x] Implementar CSV do conjunto filtrado e confirmar todos os testes verdes.

### Task 2: Carga SharePoint

**Files:**
- Create: `portal/reports/report-data.js`
- Test: `tests/portal-reports-data.test.mjs`

**Interfaces:**
- Consumes: repositorio com `resolveList`, `getColumns` e `getItems`.
- Produces: `loadReportSource(repository, entity)` com estados `ready`, `missing`, `forbidden` ou `error`.

- [x] Escrever testes falhos para carga real, lista ausente e acesso negado.
- [x] Executar o teste e confirmar falha por modulo ausente.
- [x] Implementar carga paginada pelo repositorio existente e classificacao de disponibilidade.
- [x] Executar os testes e confirmar os estados estruturados.

### Task 3: Pagina, catalogo e roteamento

**Files:**
- Create: `portal/reports/reports-page.js`
- Modify: `portal/catalog/modules.js`
- Modify: `portal/core/router.js`
- Modify: `portal/ui/app-shell.js`
- Modify: `portal/app.js`
- Modify: `portal/styles/admin.css`
- Test: `tests/portal-reports-page.test.mjs`
- Test: `tests/portal-router.test.mjs`
- Test: `tests/portal-catalog.test.mjs`

**Interfaces:**
- Consumes: `loadReportSource`, `buildReportView`, entidades autorizadas e callback de permissao.
- Produces: `createReportsPage(root, context)` com `ready`, `refresh` e `cleanup`.

- [x] Escrever testes falhos para rota, navegacao, fontes permitidas, filtros e comandos de exportar/imprimir.
- [x] Executar os testes e confirmar as falhas esperadas.
- [x] Implementar modulo, rota e pagina com formularios compactos e tabela responsiva.
- [x] Acrescentar estilos coerentes com o portal atual e regras de impressao.
- [x] Executar testes focados e corrigir apenas o necessario.

### Task 4: Verificacao e commit

**Files:**
- Verify: `portal/**/*.js`
- Verify: `tests/*.test.mjs`

**Interfaces:**
- Produces: commit unico da frente de relatorios.

- [x] Executar toda a suite Node usando temporarios na unidade `D:`.
- [x] Verificar sintaxe de todos os modulos JavaScript.
- [x] Executar `git diff --check` e revisar o diff contra o escopo.
- [x] Criar commit com os arquivos da frente e registrar o hash.
