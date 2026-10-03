# Relatórios 3–17 — paridade visual com Power Apps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir individualmente a aparência e os dados visíveis dos relatórios 3–17 conforme as capturas Power Apps, sem rolagem horizontal no telefone.

**Architecture:** Preservar as seis famílias independentes de fonte/modelo/visualização. Cada família renderiza a hierarquia de sua captura em desktop e reorganiza os mesmos dados em blocos compactos em 844×390 e 740×360. O portal e a autenticação continuam inalterados.

**Tech Stack:** JavaScript ESM, Vite, CSS, Node test, Chromium/CDP, Capacitor Android/iOS.

**Spec:** `docs/superpowers/specs/2026-10-02-reports-3-17-powerapps-visual-parity.md`

## Global Constraints

- Nenhuma tabela deve exigir arraste lateral em 844×390 ou 740×360.
- Desktop deve conservar títulos, identidade, agrupamentos, cores e indicadores da referência Power Apps.
- Conteúdo externo deve continuar escapado; não inventar campos ou valores.
- Priorizar a captura do relatório 10 para identificar a tela; confirmar a fonte real antes de exibir dados.
- Não modificar o login Microsoft nem ações financeiras do aplicativo.

## Review Focus

- Texto sem espaços ou nomes longos: continuar legível sem aumentar `scrollWidth`.
- Campo ausente na fonte: sinalizar ausência, não exibir número calculado a partir de outra lista.
- Filtros combinados: manter contagens e linhas coerentes entre si.
- Períodos e datas: formato `pt-BR`, ordenação correta e dias calculados sem salto de fuso.
- Nenhum bloco desaparece após reorganização mobile, mesmo em etapas sem registros.

---

### Task 1: RH, relatórios 3–5

**Files:** `src/ui/rh-reports-view.js`, `src/ui/rh-reports.css`, `src/chat/rh-reports-model.js`, `tests/rh-reports-*.test.mjs`, fixture RH.

**Interfaces:** Consome os snapshots da fonte RH existente; produz os mesmos contratos de visualização, acrescidos apenas dos valores exigidos pela referência.

- [ ] Escrever testes de indicadores por profissão, detalhes diários e pendências; confirmar falha pelo motivo esperado.
- [ ] Corrigir modelo e visualização por relatório; aplicar cores/cabeçalho/hierarquia da captura.
- [ ] Rodar testes RH e verificar 844×390/740×360 sem corte.

### Task 2: Obras e tarefas, relatórios 6–8

**Files:** `src/ui/operations-reports-view.js`, `src/ui/operations-reports.css`, `src/chat/operations-reports-model.js`, `tests/operations-reports-*.test.mjs`, fixture de layout.

**Interfaces:** Mantém o snapshot de etapas, diários e tarefas; amplia filtro de status somente no relatório 8.

- [ ] Escrever testes de etapa sem atividade, filtro multistatus, cores e rodapé; confirmar falha.
- [ ] Implementar composição e comportamento específicos das três telas.
- [ ] Rodar testes do grupo e medir os dois tamanhos horizontais.

### Task 3: Gastos e recorrentes, relatórios 9–10

**Files:** `src/ui/spending-reports-view.js`, `src/ui/spending-reports.css`, `src/chat/spending-reports-data.js`, `src/chat/spending-reports-model.js`, `tests/spending-reports-*.test.mjs`, fixture.

**Interfaces:** Relatório 9 preserva agregados de lançamentos; relatório 10 deve consumir registros reais de despesas recorrentes já suportados pelo aplicativo, sem renomear lançamentos comuns.

- [ ] Escrever testes para período, quantidade e seções do 9; falha esperada.
- [ ] Escrever teste que diferencia vencimento/agendamento de data de pagamento no 10; falha esperada.
- [ ] Corrigir fonte e telas, aplicar identidade da captura, executar testes e medir viewport.

### Task 4: Auditoria, relatórios 11–13

**Files:** `src/ui/audit-reports-live-view.js`, `src/ui/audit-reports-live.css`, `src/chat/audit-reports-live-model.js`, `tests/audit-reports-live-*.test.mjs`, fixture.

**Interfaces:** Preserva cotações, bens e documentos existentes; muda apenas campos/ordem identificados no spec.

- [ ] Escrever testes de estados de cotação, posição e maior ID/avisos; confirmar falha.
- [ ] Corrigir visualização e estilo por tela, sem reduzir os campos atuais.
- [ ] Rodar testes do grupo e medir viewport.

### Task 5: Comercial, relatórios 14–15

**Files:** `src/ui/commercial-progress-reports-view.js`, `src/ui/commercial-progress-reports.css`, `src/chat/commercial-progress-reports-model.js`, `tests/commercial-progress-reports-*.test.mjs`, fixture.

**Interfaces:** Consome registros de receita e andamento já existentes; não substitui receita por valor contratual.

- [ ] Escrever testes de métricas de receita, forma/conta e último início; confirmar falha.
- [ ] Corrigir cálculos, detalhes, subtítulo e aparência.
- [ ] Rodar testes do grupo e medir viewport.

### Task 6: Documentos comerciais e aluguéis, relatórios 16–17

**Files:** `src/ui/commercial-docs-rent-reports-view.js`, `src/ui/commercial-docs-rent-reports-style.css`, `src/chat/commercial-docs-rent-reports-data.js`, `tests/commercial-docs-rent-reports-*.test.mjs`, fixture.

**Interfaces:** Mantém filtros e linhas de documentos/aluguéis; adiciona indicadores e seções somente a partir de fontes verificadas.

- [ ] Escrever testes para oito indicadores/detalhe inicial no 16 e seções/ano/status no 17; confirmar falha.
- [ ] Implementar composição e dados disponíveis; sinalizar fonte indisponível explicitamente.
- [ ] Rodar testes do grupo e medir viewport.

### Task 7: Integração, revisão visual e publicação

**Files:** Somente arquivos de teste/integração que a revisão exigir.

**Interfaces:** Seis famílias expostas pelos IDs 3–17 do portal atual.

- [ ] Revisar diffs de cada família contra sua captura e conflitos entre grupos.
- [ ] Rodar `node --test`, `pnpm --dir apps/energetico-mobile run build:pwa`, verificações Android/iOS e testes de viewport.
- [ ] Conferir visualmente cada prévia em desktop e 740×360; corrigir divergências comprovadas.
- [ ] Abrir PR, acompanhar CI, integrar e verificar publicação Pages, Play interno e TestFlight.
