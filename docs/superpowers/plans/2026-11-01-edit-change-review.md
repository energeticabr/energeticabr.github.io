# Edit Change Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** destacar alteracoes e exigir confirmacao antes de salvar em todas as telas de edicao.
**Architecture:** revisao reutilizavel no portal dynamic-form e integracao dos editores customizados; persistencia permanece nos callbacks existentes.
**Tech Stack:** JavaScript, DOM, node:test, jsdom, Vite, Capacitor.
**Spec:** docs/superpowers/specs/2026-11-01-edit-change-review-design.md

## Global Constraints
- Campos alterados com fill laranja; restaurar original remove destaque.
- Tabela Campo/Antes/Depois; SUBMETER e CANCELAR; nenhum write antes de confirmar.
- Cancelamento preserva rascunho; validacao/ETags/retry/persistencia nao podem regredir.
- Criacao nao recebe confirmacao de edicao; nenhum bloco de assinatura pode mudar.
- Testes ficticios, revisar 390/320px; publicar Windows/web, Android internal e iOS TestFlight.

## Review Focus
- Tipos numericos/data/lookup/multiselecao equivalentes nao devem gerar falsas alteracoes.
- Anexos isolados/mistos e anexos RH externos precisam ser incluidos.
- Double click, Escape, cleanup e promessas pendentes nao podem salvar inesperadamente.
- Campos bloqueados/readonly/dependentes e pesquisas de seletores precisam respeitar a semantica original.
- Erro de save e refresh precisam preservar a recuperacao sem duplicar operacoes.

## Task 1: shared edit review
- [ ] Testes RED para laranja, revert, tabela, cancel/escape, save once, readOnly, attachments, creation unchanged.
- [ ] Implementar portal/ui/edit-review.js e integrar portal/ui/dynamic-form.js, incluindo CSS compartilhado carregado nos consumidores.
- [ ] Rodar testes focados e revisar implementacao.

## Task 2: coverage custom editors
- [ ] Inventariar todos os editores do app e consumidores de renderDynamicForm.
- [ ] Integrar editor lancamentos e anexos externos RH; adicionar testes comportamentais para lacunas.
- [ ] Verificar todos os caminhos do inventario cobertos, sem writes reais.

## Task 3: validation and delivery
- [ ] Testes apropriados, app/PWA builds, guard antes/depois, QA visual 390/320.
- [ ] Revisao independente e correcoes; commit, PR, merge e acompanhar CI.
- [ ] Confirmar web/Windows, Android internal e iOS TestFlight na revisao publicada.
