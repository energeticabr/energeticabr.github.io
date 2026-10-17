# Busca de provisões sem valor na baixa

Uma provisão pendente com valor ausente já era retornada pela consulta agrupada,
mas `group_options` a eliminava da seleção. A busca por fornecedor retornava
“nenhuma opção”, embora o descritivo e o vínculo existissem.

O menu agora inclui esses descritivos com `VALOR PENDENTE`, fornecedor, vencimento
e IDs das provisões. Cada pesquisa/seleção recarrega as opções, inclusive em
conversas abertas antes da correção. Selecionar um item incompleto informa quais
provisões corrigir na galeria e mantém a etapa e os anexos. Os valores não são
substituídos por zero e nenhuma baixa é efetuada nessa seleção.

A leitura estrita ocorre antes de aplicar a opção ao rascunho. Somente os erros
numéricos conhecidos de QTD, VALOR TOTAL e FRETE produzem a orientação de
correção. Falhas de transporte, esquema, paginação e identidade continuam sendo
erros de leitura. A confirmação, o journal, os totais e a gravação financeira
permanecem com suas validações existentes.

## Validação

- Falha reproduzida contra o código anterior: opções ausentes, cache antigo e
  alteração de estado antes da validação.
- Nove testes novos exercitam a função real de opções e o handler real de seleção.
- Regressão sobre o runtime candidato: **106 passed, 1 deselected**. O único
  teste desmarcado é a expectativa histórica de esconder opções inválidas,
  substituída pelos novos testes. Os demais contratos de consulta, totais,
  concorrência, journal e baixa continuam cobertos.
- Revisão independente aprovada após restringir a captura de ValueError.

`tests/run_regression.py` recebe como argumento a pasta dos testes arquivados em
`../grouped-provision-settlement/tests`. Executar com o worker e a raiz do runtime
candidato no PYTHONPATH, pytest e as dependências existentes do backend. Todas as
operações de escrita nos testes usam conectores em memória.

## Publicação

Alteração somente no servidor compartilhado por Android, iOS e Windows; não há
modificação no pacote nativo. Stage privado: `/home/opc/provision-search-20261017`.
O bundle privado contém apenas os dois arquivos de código fixados pelo manifesto;
não deve ser adicionado ao repositório. O instalador usa o runner compartilhado
de `../launch-payroll-per-payment/deploy.py`, com hash e finais de linha LF.

```sh
sudo -n /opt/energetica-whatsapp/.venv/bin/python /home/opc/provision-search-20261017/deploy.py --check 55c792d943dc9d3274baf756034915879fd55f1e5a2c2a9235250e7c5bb8e601
sudo -n /opt/energetica-whatsapp/.venv/bin/python /home/opc/provision-search-20261017/deploy.py --deploy 55c792d943dc9d3274baf756034915879fd55f1e5a2c2a9235250e7c5bb8e601
```

Publicado em 2026-10-17 às 04:02:54 UTC. Produção e espelho conferidos por SHA-256;
bridge reiniciado e ambos os serviços ativos, `/health` retornando `status: ok`.
Backup recuperável: `/var/backups/energetica-whatsapp/provision-search-20261017T040254515565Z`.
A consulta real após publicação retornou as duas opções esperadas para o
fornecedor pesquisado. Não foram alterados registros financeiros ou anexos.
