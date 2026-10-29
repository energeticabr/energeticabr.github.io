# Frequência recente das etapas em lançamentos

A pergunta ETAPA no fluxo compartilhado de lançamentos ordena todas as opções pela quantidade de ocorrências nos últimos 100 registros de LANCAMENTOS (Id decrescente), da maior para a menor. Empates preservam a ordem anterior. Vale para lançamentos simples e cada linha de múltiplos. As opções disponíveis e seus IDs não mudam; pesquisa e paginação usam a lista ordenada.

A consulta de apoio é somente leitura, solicita Id e ETAPA, top=100, sem distinct, sem filtro de filial e sem paginação completa. A contagem é normalizada e limitada novamente no serviço. Falhas no histórico mantêm o catálogo disponível. Não há gravação em registros financeiros nem em rascunhos para calcular a ordem.

Publicação: uma alteração no serviço da VM compartilhada atende PC/web, Android e iOS, sem necessidade de novos binários móveis. O pacote inclui diff público e hashes; a fonte completa e o arquivo tar permanecem privados. O instalador verifica deriva nos dois diretórios, lock, backups recuperáveis, hashes após instalação e saúde dos serviços.

Validação: seis testes do seletor contra fixtures reais, com histórico fictício, cobrem frequência, limite, normalização, empate, falha, atualização e isolamento dos demais campos/fluxos. A suíte histórica de unidade do produto apresenta as mesmas 44 ocorrências de erro em baseline e candidato (método legado ausente), sem mudança introduzida por este pacote. Revisão independente sem achados materiais.

Os testes de workflow dependem do backend privado e de tests/test_workflow.py. Execute no candidato isolado com DRY_RUN=true e LOCAL_DATA_DIR temporário. Nenhum teste grava em SharePoint.
