# Presenças por Pedido / IDPGTO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar o Relatório 2 e garantir que os relatórios caibam na largura de um telefone horizontal.

**Architecture:** Modelo puro normaliza e agrupa registros; adaptador SharePoint entrega um snapshot completo; componente visual do Relatório 2 é conectado ao painel existente. CSS responsivo converte tabelas do Relatório 1 e grupos do Relatório 2 em cartões.

**Tech Stack:** JavaScript ES modules, SharePoint Graph repository, DOM, CSS, Node test/JSDOM, Vite/Capacitor.

**Spec:** `docs/superpowers/specs/2026-10-02-presences-by-payment-report-design.md`

## Global Constraints

- Preservar o Relatório 1 e a autorização Microsoft já existentes.
- Não exibir totais parciais como definitivos; não truncar silenciosamente páginas.
- Até 1000 px, nenhuma tabela de relatório exige arrastar para o lado; telefones horizontais exibem cartões com todos os campos.
- Não interpretar dados SharePoint como HTML; inserir texto com `textContent`.
- Publicar web, Android teste interno e iOS TestFlight após validação.

## Review Focus

- `IDPGTO` repetido em várias datas não pode duplicar o lançamento no total do pedido; teste de agrupamento cobre.
- `AGRUPAR` vazio em pagamentos distintos não pode uni-los num único pedido; teste cobre.
- Valor diário ausente não pode produzir total plausível, mas falso; teste cobre.
- Filtro de data final inclui presenças nesse dia mesmo com timestamp e fuso; teste cobre.
- Resposta de consulta que termina depois de fechar/trocar relatório não pode reabrir ou substituir a tela; teste DOM cobre.

---

### Task 1: Modelo de presenças e pedidos

**Files:**
- Create: `apps/energetico-mobile/src/chat/presence-payment-report-model.js`
- Test: `apps/energetico-mobile/tests/presence-payment-report-model.test.mjs`

**Interfaces:**
- Produces: `normalizePresencePaymentRow(item, columns)`, `normalizePaymentLaunchRow(item, columns)`, `normalizeSupplierStatusRow(item, columns)`, `buildPresencePaymentReport(snapshot, filters)`.
- `snapshot`: `{ presences, launchesById, supplierStatusByName }`; `filters`: `{ startDate, endDate, branch, property, supplier, status, stage }`.

- [ ] **Step 1:** Escrever testes com campos internos do SharePoint e valores literais para filtros, agrupamento, métricas e incompletude.
- [ ] **Step 2:** Rodar `node --test tests/presence-payment-report-model.test.mjs`; confirmar falha por funções ausentes.
- [ ] **Step 3:** Implementar apenas as funções e normalizações exigidas pelos testes.
- [ ] **Step 4:** Rodar teste direcionado e a suíte móvel; confirmar saída 0.
- [ ] **Step 5:** Commitar modelo e testes.

### Task 2: Leitura segura do SharePoint

**Files:**
- Create: `apps/energetico-mobile/src/chat/presence-payment-report-data.js`
- Test: `apps/energetico-mobile/tests/presence-payment-report-data.test.mjs`

**Interfaces:**
- Consumes: normalizadores da Task 1 e repositório Graph existente.
- Produces: `createPresencePaymentReportData({ tokenProvider, repository?, fetchImpl?, siteConfig? }).loadSnapshot({ signal? })`.

- [ ] **Step 1:** Escrever testes para todas as páginas, IDPGTO distintos, status de fornecedor, lançamento não encontrado, erro e aborto.
- [ ] **Step 2:** Rodar teste direcionado; confirmar falha pela fábrica ausente.
- [ ] **Step 3:** Resolver três listas no site personal, carregar páginas completas e consultar cada lançamento único com concorrência limitada.
- [ ] **Step 4:** Rodar teste direcionado e suíte móvel; confirmar saída 0.
- [ ] **Step 5:** Commitar adaptador e testes.

### Task 3: Tela do Relatório 2 e integração

**Files:**
- Create: `apps/energetico-mobile/src/ui/presence-payment-report-view.js`
- Modify: `apps/energetico-mobile/src/ui/contractor-reports-view.js`, `apps/energetico-mobile/src/app-controller.js`
- Test: `apps/energetico-mobile/tests/presence-payment-report-view.test.mjs`, `apps/energetico-mobile/tests/contractor-reports-view.test.mjs`, `apps/energetico-mobile/tests/app-controller.test.mjs`

**Interfaces:**
- Consumes: `loadSnapshot` da Task 2 e `buildPresencePaymentReport` da Task 1.
- Produces: `createPresencePaymentReportView({ document, data })` com `element`, `open()`, `close()`, `destroy()`; painel recebe `presenceData` e habilita o quadrado 2.

- [ ] **Step 1:** Escrever testes DOM e controlador para quadrado 2, filtros, refresh, erro, resposta atrasada e exibição segura.
- [ ] **Step 2:** Rodar testes direcionados; confirmar falhas esperadas.
- [ ] **Step 3:** Implementar componente e injeção no controlador, sem alterar carregamento do Relatório 1.
- [ ] **Step 4:** Rodar testes direcionados e suíte móvel; confirmar saída 0.
- [ ] **Step 5:** Commitar integração e testes.

### Task 4: Layout sem rolagem horizontal no telefone

**Files:**
- Modify: `apps/energetico-mobile/src/ui/contractor-reports-view.js`, `apps/energetico-mobile/src/ui/contractor-reports.css`, `apps/energetico-mobile/src/main.js`, `apps/energetico-mobile/src/web/main.js`
- Test: `apps/energetico-mobile/tests/contractor-reports-view.test.mjs`, `apps/energetico-mobile/tests/presence-payment-report-view.test.mjs`

**Interfaces:**
- Consumes: células e áreas dos dois relatórios.
- Produces: rótulos `data-label` em cada campo do Relatório 1 e CSS que transforma tabelas/grupos em cartões até 1000 px.

- [ ] **Step 1:** Escrever testes dos rótulos e estrutura de cartões, com CSS responsivo validado visualmente em telefone horizontal.
- [ ] **Step 2:** Rodar testes direcionados; confirmar falha por rótulos/estrutura ausentes.
- [ ] **Step 3:** Aplicar CSS e estrutura responsiva, preservando apresentação desktop.
- [ ] **Step 4:** Rodar testes, builds web/PWA e inspeção visual nas duas larguras.
- [ ] **Step 5:** Commitar layout e testes.

### Task 5: Revisão e publicação

**Files:** nenhum produto adicional previsto.

**Interfaces:** PR contra `main`; workflows existentes de Pages, Android e iOS.

- [ ] **Step 1:** Rodar suíte raiz, suíte móvel, builds web/PWA e verificações de assinatura/segredos.
- [ ] **Step 2:** Revisar mudanças, corrigir problemas importantes com teste falhando primeiro e repetir verificações.
- [ ] **Step 3:** Push/PR/merge; acompanhar sucesso efetivo de Pages, Play interno e TestFlight no commit integrado.
