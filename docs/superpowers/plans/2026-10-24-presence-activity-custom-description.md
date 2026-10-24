# Presence Activity Custom Description Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aceitar uma descrição própria da atividade sem perder sugestões ou filtragem.

**Architecture:** Opt-in declarativo na pergunta existente; reutilizar o motor de texto livre. O adaptador emite `acceptsCustomText` com o filtro e o app separa Enviar da busca silenciosa. Instalação backend por CAS independente para app/build, que têm fontes distintas.

**Tech Stack:** Python/unittest, JavaScript/Node tests, Vite/Capacitor, SharePoint workflow.

**Spec:** docs/superpowers/specs/2026-10-24-presence-activity-custom-description-design.md

## Global Constraints

- Somente `atividade_demonstrativo_etapa` grava texto livre em `ATIVIDADEEXECUTADA`.
- Texto de instrução e placeholder definidos na especificação; nenhum cadastro implícito no catálogo.
- Busca `filter_query` nunca avança; escolha explícita preserva o identificador.
- Não modificar blocos de assinatura, sessões ou dados reais para QA.
- Publicar Windows/web, Android interno e TestFlight; não usar produção Play ou revisão App Store.

## Review Focus

- Resposta curta/número semelhante a ID deve continuar sendo texto quando enviada como descrição.
- Busca automática pendente não pode consumir a descrição ou avançar após o envio.
- Catálogo vazio deve continuar aceitando texto; descrição vazia não avança.
- Atualização/filtragem deve preservar o opt-in e a indicação do compositor.
- Seletores sem opt-in não podem passar a aceitar valores arbitrários.

### Task 1: Fluxo completo de descrição livre

**Files:**
- Create: `backend-patches/presence-activity-custom-description/patch_backend.py`, `test_activity_description.py`, `deploy.py`, `deploy-manifest.json`.
- Modify: `apps/energetico-mobile/src/app-controller.js`, `src/ui/chat-view.js`.
- Test: `apps/energetico-mobile/tests/app-controller.test.mjs`, `tests/chat-view.test.mjs`, backend behavioral tests with actual engine/adaptor and in-memory stores/catalogs.

**Interfaces:** Backend config adds `free_text_target_field: ATIVIDADEEXECUTADA`, `filter_with_direct_text: true`, and `direct_text_instruction`. Channel serializes `acceptsCustomText: true` only for the dual-mode displayed step. App sends text without replyId only for that opt-in; normal filters unchanged.

- [ ] Write behavioral tests for custom text persistence/advance, short/numeric text, explicit choices, filter-only no-match/exact ID, empty catalog/empty input, unmarked selectors, pending search and compositor updates.
- [ ] Run new tests against current sources. Expected: failures on missing opt-in/custom submission, not import/setup errors.
- [ ] Implement minimal guarded config/source patch and app change. Test patch refuses ambiguous/drifted anchors.
- [ ] Run backend and focused Node tests. Expected: all pass, no tenant writes.
- [ ] Run full app suite, web/PWA build, iOS/secrets/signature verification. Expected: zero failures, protected blocks14 intact.
- [ ] Visually verify actual chat component with fictitious data at320/390px: instruction, filter, free text submission and next question.
- [ ] Commit, request one independent whole-branch review, resolve important findings test-first.
- [ ] PR checks, merge, guarded backend install with health/hash checks, automatic main publication and target receipts. Expected: correct SHA, Windows app opened, Play internal committed, TestFlight valid/ready/attached.
