# Auditoria de pagamento, linhas e assinatura — Design

## Objetivo

Entregar os itens 4, 5, 6 e 7 confirmados pelo usuário:

1. Exibir a conferência da auditoria de pagamento em tabela com IDs, soma do valor diário e valor do lançamento.
2. Permitir finalizar diretamente nas telas de seleção de produtos de EPI e comprovante de pagamento, sem a pergunta intermediária sobre adicionar outra linha.
3. Remover o rótulo “ASSINADO DIGITALMENTE POR” e dar mais área visual à assinatura, preservando nome e data.
4. Quando não houver pendência na data da última validação, mostrar a data, a quantidade de pendências e o botão para consultar outras datas.

## Restrições

- Não alterar os itens 1, 2 e 3 do levantamento, pois o usuário confirmou que já foram feitos.
- Não editar nenhum bloco entre `SIGNATURE_GESTURE_LOCK_START` e `SIGNATURE_GESTURE_LOCK_END`.
- Manter o contrato existente de mensagens da VM e aceitar aliases estruturados para a tabela de auditoria.
- O comando de finalização continuará sendo enviado como `FINALIZAR`.

## Abordagem

- A UI reconhecerá `payment_audit_table`/`paymentAuditTable` e também `detail_table.kind = "payment_audit"`, renderizando colunas e totais sem interpretar HTML da VM.
- Polls de seleção de produto no fluxo `document_signing` receberão uma opção `FINALIZAR` no topo. Quando a VM ainda devolver a pergunta intermediária “outro produto”, o cliente a avançará automaticamente com a opção positiva para chegar à lista de produtos.
- O PDF e o marcador de posicionamento passarão a usar somente nome e data na legenda; a altura reservada à legenda será menor, aumentando a área da assinatura.
- O escopo de presenças conservará todas as opções e adicionará um resumo estruturado quando a data selecionada não possuir opções.

## Verificação

- Testes unitários da view, controlador, escopo de presenças, posicionamento e geração de PDF.
- `pnpm guard:signature-gestures` antes e depois.
- `pnpm test` e `pnpm build` antes da publicação.
