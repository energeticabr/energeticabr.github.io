# Lançamento com anexos do DDA pago

Após validar a confirmação de pagamento do DDA, oferecer iniciar um lançamento com os anexos da mesma linha. A pergunta aparece no diálogo existente, com Sim e Não; Não retorna à galeria sem iniciar lançamento. Sim abre o fluxo normal de lançamentos e inclui os arquivos do DDA na bandeja, preservando os arquivos existentes.

O pagamento só é confirmado uma vez. Falhas de consulta/download ou abertura do lançamento permitem tentar o encaminhamento novamente, sem repetir a baixa. Nenhum anexo é removido do item de origem; nenhum lançamento é submetido automaticamente. A transferência fica vinculada ao item, à conta e à sessão de origem e deve ser cancelada quando a sessão/modal for encerrada.

## Abordagem

Reutilizar o diálogo compartilhado pela galeria e pelo relatório DDA e injetar `onStartLaunch({itemId,key,signal})` pelo controller. O controller consulta os anexos do item e usa o fluxo de lançamentos e a fila de anexos existentes. Uma segunda confirmação independente duplicaria a gestão de foco; navegação direta antes de baixar os arquivos tornaria a recuperação de falhas mais frágil.

O usuário autorizou execução sem perguntas e publicação PC/web, Android interno e iOS/TestFlight. A validação usa dados fictícios, sem confirmar pagamentos reais.
