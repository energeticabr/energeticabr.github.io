# Implementação do Relatório 1 — Controle de empreiteiros

Spec: `docs/superpowers/specs/2026-10-02-contractor-report-1-design.md`

## Global constraints

- Trabalho isolado na branch `feat/powerapps-contractor-report-1` do worktree existente.
- Testes antes do código, falha observada, correção mínima e suite verde.
- Sem mutações SharePoint. Textos externos por `textContent`.
- Não chamar dados parciais de totais.

## Task 1 — Modelo e fonte de dados

**Produces:** `src/chat/contractor-report-model.js` com normalização, filtragem e métricas; `src/chat/contractor-report-data.js` com `loadOverview` e `loadDetails(id)`.

**Steps:**
1. Escrever testes de normalização, filtros combinados, indicadores e classificação de células. Expected: falhar pela ausência da implementação.
2. Implementar o modelo. Expected: testes do modelo passam.
3. Escrever testes do adaptador com repositório fake para resolução de listas/colunas, paginação e detalhes filtrados. Expected: falhar pela ausência do adaptador.
4. Implementar o adaptador. Expected: testes do adaptador e do modelo passam.
5. Commit do Task 1. Expected: commit registrado e worktree limpo.

## Task 2 — Tela responsiva e relatório selecionado

**Consumes:** `loadOverview`, `loadDetails`, normalização, filtros e métricas do Task 1.

**Produces:** `src/ui/contractor-reports-view.js` e CSS, com `createContractorReportsView({data,onHome})`, `open()` e `destroy()`.

**Steps:**
1. Escrever testes JSDOM da abertura do quadrado 1, filtros, indicadores, 13 colunas, detalhes por ID, estados vazios/erro e segurança de texto. Expected: falhar pela ausência da tela.
2. Implementar tela e estilos responsivos. Expected: testes da tela passam.
3. Commit do Task 2. Expected: commit registrado e worktree limpo.

## Task 3 — Integração, validação e publicação

**Consumes:** `createContractorReportsView` e `createContractorReportData` dos Tasks 1–2.

**Steps:**
1. Escrever testes para a opção Relatórios do menu principal, despacho local, sessão, consentimento e retomada. Expected: falhar antes da integração.
2. Integrar no chat/controller e importar CSS no web e nativo. Expected: testes de integração passam.
3. Rodar guard de gestos, suite completa, build web/PWA, `ios:verify`, `secrets:verify`; inspeção visual nas larguras móvel/desktop se viável. Expected: comandos verdes e sem divergência no diff.
4. Commit, revisão da branch por contexto independente, correções necessárias, PR, merge e verificação dos workflows de publicação web/iOS/Android já existentes. Expected: revisão sem achados graves, CI e destinos verificados por SHA.

## Review focus

Checar nomes internos de SharePoint, filtros combinados, distinção entre ID da linha e ID do documento, tratamento de dados incompletos/erros, serialização segura, cancelamento de sessão e rolagem horizontal em iPhone.
