# Cadastrar tipo despesa

`➕ CADASTRAR TIPO DESPESA` aparece antes dos tipos nas perguntas de despesa do
produto, inclusive no cadastro de produto aberto dentro de uma provisão de
pagamento. Cobre cadastro de produto, lançamento e baixa; busca, página seguinte,
catálogo vazio e conversas já abertas preservam a ação.

Reutiliza `supply_material_type_registration`: nome obrigatório, validação de
duplicidade e confirmação antes da gravação em `CADASTROTIPOMATERIAL`. Ao concluir,
o tipo é selecionado na pergunta de origem. Campos, anexos, edição, token de
idempotência, linhas e retornos aninhados da provisão são preservados. Cancelar
ou voltar restaura a pergunta sem criar registros. Controles atrasados e toque
repetido no botão não podem virar nomes de tipos.

Somente `worker/workflow.py` e `worker/financial_catalog_registration.py` da raiz
ativa são alterados. O instalador preserva o espelho divergente, confere hashes,
usa lock compartilhado e gate de requisições, faz backup, instalação atômica,
health check e rollback. Não altera configuração nem registros existentes.

## Verificação

`EXPENSE_TYPE_SOURCE` aponta ao snapshot privado completo, incluindo fixtures
históricas `tests/test_workflow.py`. Testes usam apenas dados fictícios.

```sh
EXPENSE_TYPE_SOURCE=/private/candidate python -B test_registration.py -v
python -B test_deploy.py -v
EXPENSE_TYPE_SOURCE=/private/candidate python -B export_fixture.py /private/packets.json
node verify_ui.mjs /private/packets.json /private/screenshots
python -B package.py --baseline /private/baseline --candidate /private/candidate --stage /private/release
```

O servidor compartilhado entrega esta alteração a Android, iOS e Windows/web
nos clientes instalados, sem novo binário. Consulte `verification.md` para as
evidências de teste e de publicação.
