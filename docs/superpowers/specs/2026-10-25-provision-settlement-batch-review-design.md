# Revisão única das provisões de um descritivo

## Intenção e contrato

Ao selecionar um descritivo em BAIXAR PAGAMENTO AGENDADO, apresentar uma tabela
com uma linha por provisão e colunas PRODUTO, QTD, VALOR UNITÁRIO, VALOR TOTAL.
A última linha é TOTAL GERAL. Oferecer SUBMETER e EDITAR ALGUMA LINHA. Editar
pergunta a linha e depois o campo; salvar retorna à tabela atualizada. Submeter
aceita os valores em lote e segue às perguntas comuns, sem confirmar quantidade
ou preço de cada item. Submeter esta tabela não efetua a baixa financeira.

## Escolhas de implementação

Escolha do agente, sob delegação do usuário: estender a coordenação agrupada
existente no runtime Python e o renderer compartilhado do app. Não automatizar
cliques/respostas do cliente no antigo questionário; o backend deve possuir o
novo estado e preservar o rascunho. Não criar outro formulário financeiro ou
outro mecanismo de gravação. Os controles continuam opções normais do chat.

Contrato opcional de apresentação: `detail_table.kind = provision_settlement_review`,
`descriptionId`, `title`, `notice`, `rows` (id, index, product, quantityDisplay,
unitPriceDisplay, totalDisplay, freightDisplay, paid), `totalDisplay`,
`pendingTotalDisplay`, `canSubmit`, `hasPaidRows`. Valores monetários são strings
calculadas no backend com Decimal; o app não recalcula nem arredonda com float.
Clientes antigos/canais sem tabela mantêm resumo textual completo e os botões.

## Limites e segurança

- O total segue QTD × valor unitário + frete; mostrar frete quando existir.
- Preservar a precisão do valor unitário. Valor ausente/inválido é PENDENTE,
  nunca zero; o backend impede submeter até a correção, mesmo com reply forjado.
- Mostrar as provisões já baixadas apenas para consulta, sem permitir edição;
  total geral inclui todas, total pendente distingue o que será baixado.
- Edição usa IDs estáveis e opções existentes de campos da linha; produto,
  quantidade, valor unitário e frete estão disponíveis. Total é calculado.
- Preservar data/conta/observação comuns, campos faltantes, decisão de lançamento,
  etapa, anexos, confirmação final, ETags, vínculos, journal e retomada idempotente.
- Rascunhos antigos sem marcador da nova revisão continuam no caminho legado.
- Nenhuma gravação financeira ao abrir, editar ou submeter a tabela. Testes e
  prévias usam apenas conectores em memória e dados fictícios.
- Não alterar credenciais, esquema de listas, registros reais ou os14 blocos de
  assinatura. Backend parte de snapshot fresco de produção e espelho pinado.

## Entrega e validação

Testar a conversa real, total decimal/frete, edição e retorno, inválidos,
linhas pagas, seleção obsoleta, retomada e grande quantidade de linhas sem
recursão. Conferir layout320/390px e Windows, escape de conteúdo e botões.
Revisão independente do diff completo. Deploy exato com backup/rollback e saúde,
seguido de publicação web/Windows, Play interna e TestFlight. Não efetuar baixa
real para comprovar o layout nem enviar à produção Play/revisão App Store.
