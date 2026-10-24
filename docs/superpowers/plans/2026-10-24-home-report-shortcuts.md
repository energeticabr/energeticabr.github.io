# Home Report Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restaurar os mascotes de relatórios ao retornar ao menu inicial com aviso e anexos.

**Architecture:** Separar reconhecimento do menu de áreas e compactação da pergunta. Reutilizar componentes, opções e handlers existentes; nenhuma alteração em controladores de postagem ou relatórios.

**Tech Stack:** JavaScript ESM, Node test runner, JSDOM, Vite e harness de navegador existente.

**Spec:** `docs/superpowers/specs/2026-10-24-home-report-shortcuts-design.md`

## Global Constraints

- Preservar os14 blocos `SIGNATURE_GESTURE_LOCK_START/END`.
- Nenhum atalho em submenu, poll histórico ou fluxo ativo; ocupado desabilita os controles.
- Manter o aviso de transferência, os anexos e as permissões/opções já existentes.
- Validar com dados fictícios e publicar apenas em Windows/web, Google Play interno e TestFlight.
- Execução nativa nesta sessão, conforme autorização de execução sem perguntas; um único lote coeso de correção e revisão antes de publicar.

## Review Focus

- Aviso e pergunta na mesma linha, com CRLF ou em parágrafos separados.
- Poll que apenas cita o menu inicial, mas não oferece opções de área.
- Re-renderização e troca de submenu sem duplicar handlers/mascotes.
- Fluxo ativo, histórico e estado ocupado preservam suas restrições.
- Aviso e anexo transferido continuam visíveis; clique abre o relatório sem selecionar uma opção da conversa.

### Task 1: Reconhecimento e regressão do retorno ao início

**Files:** `apps/energetico-mobile/src/ui/chat-view.js`, `tests/chat-view.test.mjs`, fixture/teste de navegador do menu inicial existente.

**Interfaces:** `renderChatMarkup(state)` e `createChatView(root)` mantêm assinaturas e eventos `open-*-report`; entram polls com pergunta completa, opções `group_*` e bandeja existente; saem os mesmos atalhos interativos do menu inicial normal.

- [ ] Escrever testes de regressão com o aviso literal do usuário; exigir os22 atalhos, aviso e anexo preservados, dispatch correto sem `select-reply`, sem atalhos em contexto indevido e bloqueio durante busy.
- [ ] Executar testes e registrar falhas pelo reconhecimento da primeira linha, não por erro de fixture.
- [ ] Corrigir somente o reconhecimento em `chat-view.js`, mantendo a compactação antiga do prompt simples e o texto completo do retorno.
- [ ] Executar regressões JSDOM e navegador320/390/1365px, abrindo relatório real com dados fictícios.
- [ ] Fazer revisão independente focada no diff; corrigir achados com RED/GREEN antes da suíte completa final.
- [ ] Rodar suíte completa, builds web/PWA, checks iOS/segredos e guard14; commit/PR, conferir CI e merge normal.
- [ ] Acompanhar os runs main da mesma revisão até sucesso, verificar Play interno e build TestFlight VALID/READY/ATTACHED; abrir web publicado e conferir assets; registrar evidências.
