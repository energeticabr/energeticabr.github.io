# Pedidos pendentes do aplicativo

## Objetivo e autorização

Concluir os pedidos que ainda não têm implementação e publicação confirmadas. O usuário ordenou execução sem nova confirmação e publicação web/Windows, Android interno e TestFlight. Não criar registros financeiros reais durante testes.

## Frontend

1. Acrescentar pagamento: serializar VALORUNITARIO, QTD, IDFOLHA e IDLANCAMENTO conforme os metadados reais da lista FOLHAPGTO (atualmente texto). Preservar colunas numéricas quando houver e a recuperação idempotente de operações.
2. CANCELAR deve ficar no extremo esquerdo e SUBMETER no extremo direito dos rodapés em todas as telas que contêm ambos.
3. Galeria lançamentos: valor total em cluster destacado imediatamente à esquerda do lápis; status real no lugar anterior do total, abaixo dos controles à direita. Não modificar edição/exclusão ou cálculo.
4. Atualizar base de dados: botão disponível em todas as sete famílias de galerias, recarrega somente a galeria corrente, preserva filtros e evita consultas/gravações duplicadas durante uma atualização.
5. Resumo de confirmação: visualizador usa largura disponível no tablet e rolagem vertical para imagens altas; manter fotos normais, zoom, compartilhamento original e assinaturas intactos.

## Backend (plano independente)

Lançamento concluído com conta DINHEIRO cria um DOCUMENTOS PENDENTE não assinado, um por lançamento persistido, inclusive múltiplos. Usar o gerador atual de COMPROVANTE PAGAMENTO com a empresa ENERGÉTICA CONSTRUTORA, CNPJ 38.626.750/0001-46, produto, quantidade, valor unitário, frete e total exatos. O frete é linha separada e não altera o unitário. Recuperação não pode duplicar documento/lançamento nem reabrir documento já assinado.

Remover a pergunta de vinculação IDPGTO por soma de VLORDIARIO sem transformá-la em vinculação automática ou marcar presenças como pagas.

## Conclusão

Auditar pedidos antigos com referências de código e publicação; registrar qualquer pendência adicional. Executar testes sintéticos, validação visual móvel/tablet/Windows, revisão independente e publicação confirmada das três plataformas. Guard de assinatura deve manter 14 blocos intactos.
