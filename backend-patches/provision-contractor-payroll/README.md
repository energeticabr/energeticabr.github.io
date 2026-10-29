# Vínculo opcional à folha após baixa de provisão

Após a baixa confirmada de uma provisão, o serviço pergunta SIM/NÃO se houver fornecedor com EMPREITEIRO=SIM. No grupo, o usuário pode escolher os pagamentos elegíveis e a folha de cada fornecedor. As opções e os tipos de pagamento seguem o fluxo de folha já existente.

O vínculo em FOLHAPGTO contém IDFOLHA e IDPROVISAO; IDLANCAMENTO só é preenchido com um lançamento relacionado existente. A pergunta também funciona sem geração de lançamento. Cada linha da folha representa o valor total pago da provisão (incluindo frete), com quantidade 1. O fornecedor individual permanece preservado.

As perguntas ocorrem depois da baixa confirmada e antes do recibo final. NÃO conclui normalmente, sem gravar FOLHAPGTO. Falha na consulta de empreiteiro mantém uma ação de retomada que não repete a baixa. Gravações usam chave estável por IDPROVISAO, sem merge, e exigem verificação positiva antes de confirmar. A mesma provisão não gera uma nova linha ao repetir a tentativa. Uma marca por lote evita perguntar novamente depois da decisão.

Os testes utilizam canal, workflow e estado otimista reais com SharePoint e dados fictícios. Cobrem baixa simples, em grupo, sem lançamento, recusa, fornecedor não empreiteiro, falha/retomada de consulta, folha de outro fornecedor, confirmação negativa da gravação e regressões do fluxo de lançamentos. Não há gravações financeiras em produção para QA. As prévias usam mensagens reais do canal fictício e o renderizador do app em 390 e 320 px.

O journal de baixa em grupo permanece congelado. Somente as respostas de texto nas quatro etapas de folha passam pelo bloqueio após a confirmação de todas as linhas. Os dados confirmados do recibo prevalecem sobre snapshots anteriores, e repetir uma mensagem de retomada não representa consentimento para vincular.

O pacote altera worker/workflow.py e worker/provision_description_settlement.py na VM e no espelho, com hashes independentes, lock, backup, rollback e verificação de saúde. O bundle integral permanece privado; apenas diff, manifesto e instalador são versionados. Android, iOS e PC/web consomem a alteração pelo serviço compartilhado, sem novos binários.
