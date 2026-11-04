# Asset launches layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproduzir a Foto 2 na galeria existente e publicar nas plataformas aplicáveis.
**Architecture:** Renderizador de apresentação e CSS escopados, com formatação, busca, filtros e relatório existentes.
**Tech Stack:** JavaScript DOM, CSS, Node test/JSDOM, Vite, Chrome, GitHub Actions.
**Spec:** docs/superpowers/specs/2026-11-03-asset-launches-layout-design.md

## Global Constraints
Preservar assinatura, dados, filtros, relatório e campos legados. Testar nomes longos, zeros, ID ausente e 320/390/768/1365px. Sem novas dependências.

## Review Focus
Ordenação de toda a lista antes da paginação; valores zero e ausentes; vínculo numérico do relatório; recuperação do foco; CSS sem afetar outras galerias.

### Task 1: Galeria e ordenação
**Files:** src relativos a apps/energetico-mobile: ui/asset-launches-card.js, ui/asset-launches-card.css, ui/registration-gallery-view.js, chat/registration-gallery-data.js; testes asset-launches-gallery.test.mjs e fixture/browser existentes.
**Interfaces:** renderAssetLaunchesCard({ document, container, rowId, title, value }); value recebe nome de campo e devolve valor já formatado.
- [ ] Testar ordenação por nome com acentos, alternância para recentes, busca, filtro e paginação; rodar teste e observar falha.
- [ ] Implementar agrupamento com ícones SVG decorativos, ordenação externa e layout da referência.
- [ ] Conferir medidas e capturas nas larguras requeridas; manter dados e relatório.
- [ ] Rodar testes focados, guard, suite completa e builds nativo/PWA.
- [ ] Revisar diff, commit, PR e integrar; verificar CI e publicação por plataforma.
