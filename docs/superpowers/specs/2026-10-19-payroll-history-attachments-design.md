# Desdobramento: totais, histórico semanal e anexos

## Resultado solicitado

O total geral deve ser o previsto novo mais todo o pago da IDFOLHA selecionada, por rubrica, com centavos exatos. Um histórico de R$ 3.883,61 sem novos valores deve mostrar R$ 3.883,61 também no cabeçalho.

Cada sexta representa a semana de segunda a domingo que a contém. Pagamentos da mesma semana aparecem uma única vez, mesmo quando sexta e último dia do mês compartilham a semana. Pagamentos da folha fora do mês-calendário continuam no total e têm agrupamento histórico próprio. Semanas encerradas ficam cinza e recolhidas; a seta abre detalhes, nunca edição de quantidade, valor, data ou rubrica pagos. Registros com preços diferentes permanecem linhas distintas.

Cada linha nova e cada pagamento histórico tem seleção e submissão de anexos. Os valores históricos não são regravados para adicionar arquivos. Os anexos de salário seguem vínculos financeiros confirmados até PROVISÃO PGTOS, LANCAMENTOS e NOTASPENDENTES: provisões pendentes recebem o arquivo antes da baixa, e a baixa deve transferi-lo para lançamento e pedido. Para registros já baixados, o envio usa os destinos existentes. Nunca criar pagamentos, provisões ou pedidos fictícios para guardar arquivos; vínculos ausentes/ambíguos devem ser informados e não anunciados como sincronização completa.

## Segurança e recuperação

Somente a folha e o fornecedor selecionados podem receber arquivos. Revalidar os vínculos na submissão, não confiar em IDs manipuláveis da tela. Não sobrescrever arquivo homônimo com bytes diferentes. Comparar conteúdo e recuperar uploads com resposta perdida. Validar todos os arquivos antes de qualquer escrita. A retomada mantém os mesmos IDs e valores financeiros; não duplica linhas nem perde anexos silenciosamente. Arquivos selecionados ficam em memória; após reiniciar o app, exigir nova seleção dos mesmos bytes quando ainda necessários, usando manifesto de hashes persistido, sem serializar File como objeto vazio.

## Escopo técnico

Reutilizar calendário e post idempotente existentes. Acrescentar modelo puro de semanas/totais, detalhes pagos ao contexto e serviço isolado de anexos por pagamento. Manter as travas de assinatura intactas. Testar sem efetuar pagamentos reais. Publicar web/Windows, Android interno e TestFlight da mesma árvore validada; backend somente se a propagação existente não cobrir os vínculos.
