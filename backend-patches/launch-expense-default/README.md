# Tipo de despesa do produto nos lançamentos

Lançamentos e baixas voltam a selecionar automaticamente o tipo de despesa
vinculado ao produto em `CADASTROPRODUTO.TIPODESPESA`. A inclusão do botão de
cadastro havia desativado `auto_select_single` nesses fluxos. A escolha e o
cadastro de tipos ficam restritos ao cadastro de produto.

Conversas paradas na pergunta antiga recarregam o valor do produto no próximo
comando, descartando controles antigos de cadastro, seleção, busca e paginação.
Campos, linhas, anexos e token de idempotência são preservados. Nenhum registro
financeiro existente é alterado.

A correção altera somente `worker/workflow.py` e
`worker/financial_catalog_registration.py` no backend compartilhado de Android,
iOS e Windows/web. Os clientes instalados recebem o comportamento sem novo binário.

## Verificação

`EXPENSE_DEFAULT_SOURCE` aponta para um snapshot privado do backend com as
fixtures históricas `tests/test_workflow.py`. Os testes usam dados fictícios.

```sh
EXPENSE_DEFAULT_SOURCE=/private/candidate python -B test_regression.py -v
python -B test_deploy.py -v
python -B package.py --baseline /private/baseline --candidate /private/candidate --stage /private/release
```

O pacote fixa hashes da origem ativa e do espelho independente. Publicação usa
lock compartilhado, gate e drenagem de requisições, backup, instalação atômica,
verificação de saúde e rollback. A fonte privada não é incluída no repositório.
