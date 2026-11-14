# Data da visita em obra

O fluxo pergunta a data depois de confirmar o valor. A data escolhida aparece no resumo e preenche `DATA PEDIDO`, a observação do pedido, `DATA`, `DATA RMS`, `DATA PGTO PREVISTO` e `DATA PGTO EFETUADO` do lançamento e `DATA` do diário opcional. A busca por diário existente usa a filial e a data escolhidas.

O patch altera `worker/workflow.py` e `worker/workflow_config.json` no servidor compartilhado por Android, iOS e Windows. Aplique `source.patch` aos snapshots correspondentes e use o executor de implantação da VM com verificação de hashes, backup e verificação de saúde.

Execute os testes abaixo com o Python do servidor e `ENERGETICA_BACKEND_TEST_ROOT` apontando para a raiz a validar. Inclua a raiz do backend e os dois diretórios de testes no `PYTHONPATH`. Os testes simulam o SharePoint em memória.

```sh
python -B -m unittest test_visit_date test_visit_diary
```
