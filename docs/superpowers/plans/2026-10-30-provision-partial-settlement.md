# Provision partial settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Baixar apenas provisões selecionadas e reutilizar o pedido do descritivo até sua quitação integral.

**Architecture:** O cliente controla a seleção visual; o servidor valida IDs, conserva o grupo completo para conferir a quitação e processa somente as linhas selecionadas. O vínculo idempotente de pedido é estável por descritivo.

**Tech Stack:** Python WorkflowEngine e clientes SharePoint existentes, JavaScript/JSDOM/Vite/Capacitor.

**Spec:** `docs/superpowers/specs/2026-10-30-provision-partial-settlement-design.md`

## Global Constraints

- Não modificar as 14 áreas protegidas de assinatura.
- Não efetuar pagamentos nem gravar registros financeiros reais durante QA.
- Linhas não selecionadas ficam intactas; o pai só fica pago após todas estarem baixadas.
- Mesmo pedido em todas as parcelas/datas do descritivo, com recuperação idempotente.
- Manter no escopo o cadastro incorporado de etapa e a filial padrão solicitados antes.
- Publicar backend e três clientes após revisão e testes.

## Review Focus

- Seleção inválida/vazia/estranha ou linha paga não pode alcançar gravação.
- Falha após criar pedido e antes de vincular filhos não pode duplicar o pedido ao retomar.
- Novos filhos/conflitos entre revisão e confirmação impedem quitação prematura do pai.
- Várias datas e falhas parciais devem preservar valores individuais e data final correta.
- IDs, seleção e anexos não podem migrar entre contas/descritivos em rerenders.

### Task 1: Seleção na tabela

- [ ] Testes RED de checkbox por linha, Selecionar todos, linha paga, seleção vazia, preservação e comandos exatos.
- [ ] Implementar interface e QTD sem quebra; verificar com dados fictícios em 320/390/1365px.

### Task 2: Baixa parcial durável

- [ ] Testes RED: primeira parcela mantém pai aberto; segunda parcela em outra data reutiliza pedido e quita pai.
- [ ] Filtrar somente a seleção validada nos pagamentos, lançamentos, anexos e valores.
- [ ] Cobrir retomada, falha de confirmação, conflito de vínculo, filho criado durante a baixa e estado congelado.
- [ ] Revisão independente e integração dos hooks no WorkflowEngine, preservando o cadastro de etapa.

### Task 3: Publicação

- [ ] Empacotar somente os arquivos de backend revisados, com baseline, hashes, CAS, backup e rollback.
- [ ] Executar testes e builds apropriados; commit/PR/merge da implementação final.
- [ ] Publicar e verificar o backend com código instalado e catálogos fictícios.
- [ ] Acompanhar PC, Play interna e TestFlight; abrir o app público e registrar os resultados.
