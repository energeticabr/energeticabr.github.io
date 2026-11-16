# Continuar sem observações no lançamento

Na etapa de texto aberta após **Sim** em **Efetuar lançamento**, o botão
**Continuar sem observações** avança com a descrição em branco. A configuração
usa a ação `blank_option` do motor e mantém a entrada de texto disponível.

A alteração é em `worker/workflow_config.json` do serviço compartilhado pelo
Android, iOS e Windows/web. O teste de regressão usa o motor e o bridge com
armazenamento, fornecedores e anexos fictícios.

```sh
WORKFLOW_CONFIG_PATH=/path/to/candidate/worker/workflow_config.json \
  /opt/energetica-whatsapp/.venv/bin/python -B test_regression.py -v
```
