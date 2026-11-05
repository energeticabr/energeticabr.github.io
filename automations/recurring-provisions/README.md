# Contas recorrentes sem valor

`repair_definition.py` aplica uma proteção à definição existente do fluxo
PAGAMENTO RECORRENTE. Contas cujo VALORMENSAL está ausente, vazio, contém apenas
espaços ou apenas `R$` ficam em `Contas_aguardando_fatura` no histórico da execução.
Elas continuam cadastradas e conservam DATAFIM até que exista um valor de fatura.
O fluxo não cria provisão de valor zero nem avança a data dessas contas.

Valores preenchidos seguem a validação numérica original, inclusive a rejeição
de conteúdo inválido. As ações financeiras existentes e suas verificações de
duplicidade permanecem intactas. A mudança é no serviço em nuvem e atende os
clientes Android, iOS e Windows sem atualização dos aplicativos.

```sh
python automations/recurring-provisions/repair_definition.py definition-before.json definition-after.json
```

A ferramenta transforma somente a definição WDL; não publica nem reexecuta
automaticamente. Antes de aplicar, salvar a versão atual, verificar concorrência
e comparar a definição publicada com a desejada.
