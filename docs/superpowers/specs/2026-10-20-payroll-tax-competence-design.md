# INSS/FGTS na folha da competência

## Objetivo e autorização

O usuário pediu rubricas literais INSS e FGTS, vínculo ao IDFOLHA do mês de
competência (normalmente anterior ao pagamento), passo explícito no fluxo de
lançar pagamentos da folha e regularização das linhas anteriores identificáveis.
A instrução permanente autoriza implementar/testar/publicar sem menus de aprovação.
Não autoriza inventar rateio individual, conceder permissões ou duplicar obrigações.

## Desenho

1. Rubricas canônicas INSS e FGTS junto às existentes. Resumos/histórico incluem
   os encargos; grade semanal de desdobramento mantém apenas as rubricas semanais.
2. Competência separada da data de pagamento, sugerida como mês-calendário anterior
   à data informada, com passagem dezembro/janeiro. A confirmação explícita permite
   competência histórica de pagamento em atraso. Nunca usar o relógio atual para
   invalidar uma competência histórica confirmada.
3. No lançamento de folha, linhas normais usam a folha já escolhida. Linhas INSS/FGTS
   usam uma folha fiscal confirmada do MESMO funcionário e competência. Lote misto
   pode apontar salário e encargos para folhas distintas; resumo identifica ambas.
   Lote somente de encargos não exige uma folha normal fictícia.
4. No formulário que vincula lançamento existente a FOLHAPGTO, tipos INSS/FGTS
   mostram competência e somente as folhas correspondentes. O serviço revalida
   fornecedor, mês e valores antes de criar FOLHAPGTO. Este formulário nunca cria
   LANCAMENTOS, pedidos ou provisões. POST incerto não autoriza repetição cega.
5. Tipo inexistente em coluna Choice fechada não é inventado: exige catálogo
   compatível. Campos Text recebem texto; Number recebem números. Sem novas colunas.
6. Retomada mantém a mesma intenção/competência/folhas; alteração após início é
   recusada. Linhas já vinculadas à mesma origem não devem gerar novo pagamento.
7. Auditoria real somente GET inicialmente. Backfill só para origem individual,
   funcionário, rubrica, competência e IDFOLHA inequívocos, sem mudar valores,
   status ou datas financeiras. Provisão pendente continua pendente; nenhum
   LANCAMENTO é criado antes da baixa. Guias agregadas sem memória individual
   são reportadas para definição de rateio, nunca copiadas inteiras para cada folha.
8. Preservar a correção de vencimentos, o draft RH e os blocos protegidos de assinatura.

## Validação e entrega

Testes RED/GREEN de data/ano, lote misto e somente encargos, fornecedor alheio,
competência errada, ausência/ambiguidade de folha, paginação incompleta, replay e
POST incerto. UI sintética com dados não reais. Suítes completas app e portal,
builds nativo/PWA, trava de 14 blocos. Revisão independente. Publicar web/Windows,
Google Play internal e TestFlight na mesma revisão; confirmar recibos de envio.

Nenhuma obrigação real será criada/alterada para testar o código. O relatório final
separa publicação do código, vínculos realmente regularizados e casos bloqueados.
