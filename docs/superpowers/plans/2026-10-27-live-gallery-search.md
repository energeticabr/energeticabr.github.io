# Pesquisa contínua nas galerias — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Pesquisar durante a digitação em todas as galerias, preservando a edição dos filtros.

**Architecture:** O agendamento compartilhado passa a atraso zero no próximo ciclo de eventos, preservando seletores abertos. Lançamentos usa esse agendamento; RH invalida consultas descartadas e sincroniza a reabertura. Cadastros pesquisam pelo texto concluído enquanto o teclado compõe caracteres.

**Tech Stack:** JavaScript ESM, Node test, JSDOM e Chrome via CDP, Vite/Capacitor.

**Spec:** docs/superpowers/specs/2026-10-27-live-gallery-search-design.md

## Global Constraints

- Preservar os 14 blocos SIGNATURE_GESTURE_LOCK e as impressões digitais.
- Sem novos pacotes ou alterações de backend.
- Consultas sem espera por inatividade; composição só ao terminar.
- Publicação verificada em Windows/web, Android interno e TestFlight.
- Execução inline, conforme a delegação expressa do usuário; uma revisão independente final.

## Review Focus

- Eventos nativos input/change/search juntos não duplicam ou perdem a limpeza do campo.
- Uma resposta anterior retorna entre o novo input e seu próximo ciclo de eventos.
- Respostas fora de ordem e falhas antigas preservam o filtro mais recente.
- Um seletor aberto e a seleção do cursor sobrevivem à chegada de opções.
- Fechar/reabrir ou destruir durante a consulta ignora resultados atrasados.

### Task 1: Aplicar pesquisa contínua comum e verificar todas as galerias

**Files**
- Modify: apps/energetico-mobile/src/ui/auto-filter-form.js
- Modify: apps/energetico-mobile/src/ui/launch-gallery-view.js
- Modify: apps/energetico-mobile/src/ui/hr-payroll-gallery-view.js (apply the existing current-query guard to failures too)
- Modify: apps/energetico-mobile/src/ui/registration-gallery-view.js (retain the committed search during IME composition)
- Test: apps/energetico-mobile/tests/auto-filter-form.test.mjs
- Test: apps/energetico-mobile/tests/launch-gallery-search.test.mjs
- Create: apps/energetico-mobile/tests/gallery-live-search.test.mjs
- Create: apps/energetico-mobile/tests/gallery-live-search-browser.test.mjs
- Create: apps/energetico-mobile/tests/fixtures/gallery-live-search.html
- Modify: apps/energetico-mobile/tests/launch-gallery-keyboard-browser.test.mjs
- Modify: apps/energetico-mobile/tests/diary-search-browser.test.mjs
- Modify: apps/energetico-mobile/tests/fixtures/diary-search-performance.html
- Modify: apps/energetico-mobile/tests/launch-gallery-view.test.mjs
- Modify: apps/energetico-mobile/tests/gallery-quick-search.test.mjs
- Modify existing timing fixtures only where the previous quiet-period contract is deliberately replaced.

**Interfaces**
- Consumes: bindAutoFilterForm(form, apply, options), all galleryCases factories, existing per-request version/filter guards.
- Produces: default zero-delay scheduling while preserving the explicit debounce option and the existing public gallery API.

- [ ] Write integration tests for every gallery factory: type 9, 90, 901, then clear, advance zero timer, assert literal visible IDs, stable field identity/focus/caret and usable filters. Remote fixtures return literal rows for the requested payload.
- [ ] Replace launch quiet-period tests with continuous typing, native duplicate/clear, stale-before-send and out-of-order success/error cases. Preserve closure, validation, paging and dropdown cases.
- [ ] Run new tests before implementation. Expected: failures because launch/RH/local automatic galleries wait instead of applying the latest input.
- [ ] Set the shared default/fallback delay to zero and remove the launch 3-second override. Keep existing request version and current-filter checks.
- [ ] Run focused gallery/form tests. Expected: all pass without skipped regressions.
- [ ] Verify native typing while requests and responses are active at 320/390px and desktop, in light/dark. Assert focus, cursor, current-query results, scoped loading and accessible percentage.
- [ ] Run gesture guard, full pnpm test, web/PWA builds, iOS project and secrets checks. Expected: zero failures; conditional skips explicitly recorded.
- [ ] Commit the tested change, request one independent whole-branch review and fix material findings with RED→GREEN.
- [ ] Create PR, wait all required checks, merge the final revision, and verify actual Pages deployment, Play internal edit commit and TestFlight ready/group attachment. Record exact versions and published sources.
