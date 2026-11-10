# Sicoob Order Link Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans task by task.

**Goal:** Vincular pagamentos a pedidos com sugestões por valor ou recebedor.
**Architecture:** Serviço próprio de vínculo em MOVIMENTACOESFINANCEIRAS; seletor compartilhado com notas fiscais; coluna IDPEDIDO provisionada na base existente. Reutilizar fiscalSupplierSimilarity, mas igualdade monetária exata (sem tolerância de 5%).
**Tech Stack:** JavaScript, SharePoint REST/Graph, CSS, Node tests, Chrome.
**Spec:** docs/superpowers/specs/2026-11-10-sicoob-order-link.md

## Constraints and review focus
- Preservar assinatura bloqueada e dados bancários/anexos.
- Consulta paginada completa; falhar em dados malformados, não retornar opções parciais.
- Valor inválido/ausente não corresponde a zero; nomes genéricos e N/A não geram estrela.
- Não sobrescrever vínculo concorrente; ETag obrigatório e readback verificado.
- Fechar/atualizar relatório cancela seletor; retorno de foco e posição preservados.
- Largura em 320/390 px e PC; PDF inclui vínculo sem controles.

## Task 1 — Serviço e modelo
- [x] Criar src/chat/sicoob-order-link.js com SICOOB_ORDER_FIELD='IDPEDIDO', sicoobOrderId, rankSicoobOrderOptions(options,{supplier,amount}), createSicoobOrderLink({repository,siteKey='personal',assertSession}). loadOptions({signal}); save({movementId,orderId,expectedOrderId,signal}) -> {movementId,orderId}.
- [x] Integrar data.orderLink no adapter financial_movement, incluir IDPEDIDO no modelo/galeria sem edição genérica.
- [x] Testar ranking exato, nomes, placeholders, paginação, escrita somente de IDPEDIDO, ETag, readback, cancelamento e conflito.

## Task 2 — Coluna e seletor
- [x] Adicionar projeção orderId e coluna VINCULAÇÃO em sicoob-transaction-report-view.js, usando createReportLinkPicker.
- [x] Reutilizar seleção, estrelas e revisão; atualizar só a célula após salvar, mantendo posição.
- [x] CSS próprio de vínculo e seis colunas sem retornar margens laterais.
- [x] Testar seleção, sugestões, troca de vínculo, erro, fechamento/refresh e PDF.

## Task 3 — Schema, integração e publicação
- [x] Criar IDPEDIDO Number/0 decimais opcional em MOVIMENTACOESFINANCEIRAS e ler metadados de volta; sem alterar registros.
- [x] Verificar importadores preservam o campo; incluir script idempotente de schema no backend-patches.
- [x] Testar integração em navegador com dados fictícios e conferir screenshot.
- [ ] Revisão independente, testes focados/build/guard, merge e publicação nas três plataformas.

### Evidência de schema — 2026-11-10
Coluna IDPEDIDO criada e relida em MOVIMENTACOESFINANCEIRAS (ad287352-ea59-4f60-9c91-d18520bb1d08): Number, zero decimais, opcional. A credencial do importador só permitiu leitura do schema; criação feita pela conexão SharePoint do Power Platform já autorizada. Options=8 preserva o nome interno. As três colunas vazias com nome derivado do título, criadas durante o ajuste, foram removidas após consulta confirmar ausência de valores. Nenhum pagamento foi vinculado automaticamente. O importador confirmou o schema final com status ready.

### Verificação local
Serviço/adapter/modelo/relatório: 26 testes focados aprovados. Revisão independente: nenhuma correção necessária; 22 testes aprovados. Build mobile e PWA, guarda dos 14 blocos de assinatura e verificação de segredos aprovados. Suíte completa local encontrou falhas de infraestrutura Chrome/CDP no Windows em outros relatórios; não confundir com validação em CI.

Navegador real aprovado em 320/390/768/1365px e PWA390, incluindo toque na vinculação, sugestões ordenadas, rolagem e Cancelar com retorno de foco. Corrigido colapso da lista em320px com CSS restrito ao relatório Sicoob. Screenshot artifacts/sicoob-order-link-390.png revisado visualmente. Teste de navegador + DOM:12/12.

Suíte sem navegador:8.587 testes aprovados em408 arquivos, nenhuma falha. Revisão final do CSS compacto sem problemas.
