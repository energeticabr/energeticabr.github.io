# Orders Linked Launches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** abrir os lancamentos vinculados selecionando o pedido na galeria.
**Architecture:** botao nativo no ID com alvo estendido ao conteudo da ficha; reutilizar openLinkedDetails e createOrdersLinkedReportData, preservando os controles independentes.
**Tech Stack:** JavaScript DOM, CSS, node:test/jsdom, Chrome, Vite/Capacitor.
**Spec:** docs/superpowers/specs/2026-11-01-orders-linked-launches.md

## Global Constraints
- Sem gravacoes reais; consultas por ID exato e paginacao existentes.
- Anexos/editar/excluir independentes; voltar preserva estado da galeria.
- Teclado e alvo minimo44px em320/390; preservar layout e assinatura14.
- Publicar web/Windows, Androidinternal e TestFlight na mesma revisao.

## Review Focus
- Fechar/trocar pedido durante leitura e ignorar respostas atrasadas.
- Erro/retry carrega somente o pedido selecionado.
- Cliques/toques em campos acionam consulta, controles de anexos/edicao/exclusao nao.
- Foco e estado da galeria preservados sem recarregar snapshot.

## Task1: implementar acesso direto
- [x] TesteRED de abrir pelo ID sem editor, manter contexto e retry/cancel.
- [x] Implementar botao e alvo estendido sem cobrir acoes independentes.
- [x] TestesGREEN dos dados/view/relatorio e QA real320/390/desktop.
## Task2: validar e publicar
- [x] Buildsapp/PWA, guard14, revisao independente e testes relevantes.
- [ ] Commit/PR/merge e verificar entrega web/Android/TestFlight.
