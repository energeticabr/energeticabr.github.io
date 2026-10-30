# SEFAZ Neutral Empty Retentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Exibir retenções ausentes ou zeradas como `-` em cinza neutro e reservar vermelho para retenções positivas obrigatórias.

**Architecture:** A renderização nativa da galeria normaliza ausências e zeros para o valor neutro; o decorador SEFAZ aplica o tom vermelho somente aos campos reconhecidos por `buyerWithholding` como retenção obrigatória do comprador. A regra fiscal de `buyerWithholding` permanece inalterada.

**Tech Stack:** JavaScript ESM, JSDOM, CSS, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-30-sefaz-neutral-empty-retentions-design.md`

### Task 1: Normalizar e colorir clusters de retenção

**Files:**
- Modify: `apps/energetico-mobile/tests/notas-sefaz-gallery.test.mjs`
- Modify: `apps/energetico-mobile/src/ui/registration-gallery-view.js`
- Modify: `apps/energetico-mobile/src/ui/sefaz-invoice-card.js`
- Modify: `apps/energetico-mobile/src/ui/sefaz-invoice-card.css`

1. Alterar o teste de retenções ausentes para exigir `-`, tom neutro e ausência de rosa; adicionar caso zero e caso positivo obrigatório vermelho.
2. Executar o teste focado e confirmar falha pela apresentação atual.
3. Trocar o fallback de retenção analisada para `-` e aplicar uma classe neutra ou vermelha conforme o valor positivo reconhecido.
4. Executar o teste focado até passar.
5. Rodar a trava de gestos, testes SEFAZ, build e validação visual em 320 px e 390 px.
6. Commitar e submeter a revisão/publicação nos canais autorizados.

## Review Focus

- Ausente, vazio, zero numérico e zero formatado não podem parecer retenção.
- Valor positivo obrigatório continua vermelho e continua acionando o aviso do comprador.
- Campos comuns de tributos não mudam de cor ou conteúdo.
- Layout não pode criar quebra desnecessária em 320 px e 390 px.
