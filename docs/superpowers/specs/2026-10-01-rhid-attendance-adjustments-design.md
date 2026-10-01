# Ajustes auditáveis no relatório RHID

## Objetivo

Permitir que um usuário autorizado complete batidas ausentes após o encerramento do dia e corrija horários de pessoas com inconsistências, sem apagar ou alterar os dados recebidos do RHID. O relatório e o PDF devem usar o horário efetivo, enquanto o detalhe da célula mostra o original, o ajuste e sua justificativa.

## Classificação

Cada batida RHID é classificada pelo horário civil da data do relatório: `05:00–08:00` entrada 1; `11:00–12:29` saída 1; `12:30–13:30` entrada 2; `15:30–23:59` saída 2. Os limites são inclusivos, exceto 12:30 para saída 1. Valores fora das faixas, duas batidas na mesma faixa, horários inválidos ou ordem impossível são inconsistências visíveis; nunca se atribuem automaticamente à coluna seguinte. Os horários brutos permanecem disponíveis no detalhe do colaborador. O cálculo de horas e a sinalização de parcial usam as quatro marcações efetivas, não a posição original da lista RHID.

## Ajustes e interface

Depois do fechamento do dia (regra já existente: a partir de 17:15 em São Paulo), células vazias são selecionáveis. Células de uma linha inconsistente também podem ser editadas. O diálogo solicita `HH:MM`, justificativa não vazia e confirmação. Um ajuste manual em célula originalmente vazia aparece azul-claro; um ajuste que substitui uma batida RHID aparece laranja. Clicar em uma célula ajustada mostra o horário RHID original (ou “não registrado”), o horário efetivo, a justificativa, o responsável e a data do ajuste, com opção de novo ajuste. Células RHID sem ajuste mantêm as cores atuais.

## Persistência e autorização

O aplicativo envia data, identificador estável da pessoa RHID (ou ID da linha SharePoint), coluna, novo horário e justificativa a uma ação autenticada na VM. A VM verifica a identidade já autorizada para o portal, confirma que a pessoa existe no relatório daquela data e registra cada alteração em armazenamento SQLite persistente ao lado do estado do serviço. O histórico é somente aditivo; a leitura retorna a alteração mais recente por pessoa, data e coluna. A lista `RHID PRESENÇAS` e o campo `BATIDAS_RHID` não são modificados. O servidor obtém o valor RHID original da fonte, sem confiar em valores enviados pelo navegador.

## Atualização e erros

Após salvar, o aplicativo busca novamente o relatório da mesma data e atualiza somente a mensagem aberta. Falha de rede ou validação mantém o diálogo e não apresenta sucesso. Uma nova coleta RHID não apaga ajustes; a comparação mostra o RHID mais recente e o ajuste. Uma correção não pode ser gravada em data futura nem antes do fim do dia. Testes cobrem limites horários, duplicatas, preenchimento, substituição, auditoria, autorização, persistência, atualização do relatório e PDF.
