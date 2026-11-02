# Orders Open Cue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** deixar explicito o acesso por toque e corrigir a falsa ambiguidade FILIAL mostrada pelo usuario.
**Architecture:** realce e indicacao no cabecalho existente; excluir espelhos de metadados somente na comprovacao das colunas do relatorio.
**Tech Stack:** JavaScript DOM/CSS, node:test/jsdom, Chrome, Vite/Capacitor.
**Spec:** docs/superpowers/specs/2026-11-02-orders-open-cue.md

## Global Constraints
- Colunas reais unicas continuam obrigatorias; sem nomesfisicos assumidos nem dados vazios sinteticos.
- Sem gravacoes reais. Preservar pagina/filtro/foco, assinatura14 e controles independentes.
- Ver lancamentos/seta legiveis em320/390/desktop.
- Publicar web/Windows, Androidinterno e TestFlight; verificarentrega de mesma revisao.

## Review Focus
- Espelhos sem flag computed, espelhos isolados sem coluna real, duplicatas reais readonly.
- Paginacao e filtroAGRUPAR continuam exatos; nenhuma mudanca em valores/totais.
- Cabecalho comprido e area de editar/excluir nao sobrepoem indicacao.

## Task1: dados
- [x] ReproduzirRED com FILIAL/Title e espelhos do SharePoint.
- [x] Excluir auxiliares e provarGREEN com ambiguidades/missing rejeitados.
## Task2: cabecalho
- [x] Destacar cabecalho e indicacao Ver lancamentos com seta; verificar realhit e teclado.
## Task3: entrega
- [x] Revisao independente, testesfocados, builds/guard e QA320/390/desktop.
- [ ] Commit/PR/merge, CI e verificacao de entrega nos3clientes.
