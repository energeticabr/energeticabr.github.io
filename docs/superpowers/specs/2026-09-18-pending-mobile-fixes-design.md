# Correções pendentes do Energético — design

## Objetivo

Entregar em um único lote as correções já implementadas, porém ainda não distribuídas, e completar as melhorias pendentes do fluxo de entrega de EPI e das telas de confirmação.

## Requisitos funcionais

1. Toda tela final de criação deve enviar a ação de confirmação antes do cartão de resumo.
2. O fluxo de entrega de EPI não pode oferecer novamente um produto já adicionado ao comprovante.
3. A primeira assinatura desenhada deve abrir diretamente o posicionamento; a assinatura não deve aparecer como anexo comum.
4. Depois de posicionar a assinatura do EPI, o sistema deve gerar o PDF assinado, mostrar primeiro os controles de confirmação e, depois, o resumo dos campos de `DOCUMENTOS` e a prévia exata do PDF. Nenhum item pode ser criado antes da confirmação positiva.
5. Voltar da confirmação do EPI deve preservar os dados e reabrir o posicionamento. Confirmar deve gravar exatamente o PDF mostrado.
6. A faixa do PDF que contém nome do signatário e data/hora deve ter fundo branco opaco somente na área da legenda, sem cobrir a imagem da assinatura.
7. As correções já existentes para popups de provisões/lembrete e canvas de assinatura devem permanecer cobertas por testes móveis.
8. A publicação final deve ir apenas ao TestFlight e ao teste interno do Google Play, nunca à produção.

## Arquitetura

O servidor continuará sendo a autoridade do fluxo. O PDF assinado será preparado uma única vez e guardado temporariamente no repositório de mídia durante uma nova etapa de confirmação do EPI. A confirmação positiva reutilizará esse mesmo binário ao criar o item em `DOCUMENTOS`; a volta descartará somente a prévia assinada e preservará documento, assinatura e dados coletados.

As confirmações comuns continuarão centralizadas em `_summarize_and_confirm`, mas a ordem de envio será ação primeiro e cartão depois. Os caminhos de restauração/cancelamento que reenviam ambos seguirão a mesma ordem.

## Critérios de aceite

- A primeira mensagem da confirmação comum é do tipo `actions`; a mensagem seguinte é a imagem de resumo.
- Ao selecionar CAPACETE e escolher adicionar outro produto, CAPACETE não aparece na nova lista.
- Posicionar a assinatura de EPI não chama `ensure_item` nem `ensure_attachment`.
- A confirmação do EPI mostra ações, resumo e PDF assinado, nessa ordem lógica, e somente `confirmar` grava o item.
- O PDF gravado é byte a byte o mesmo PDF mostrado na prévia.
- O fundo da legenda da assinatura é preenchido; o retângulo da assinatura permanece sem preenchimento.
- Testes móveis, build web e testes focados do servidor passam.

