# Contas por frequência recente em lançamentos

A pergunta `QUAL É A CONTA?` de `launch/conta_lancamento` apresenta primeiro as
contas mais usadas nos últimos 100 registros de `LANCAMENTOS`, por `Id`
decrescente. Empates mantêm a ordem anterior do catálogo. Contas sem uso
continuam disponíveis. A contagem normaliza maiúsculas, acentos e espaços.

A consulta solicita apenas `Id` e `CONTA`, `top=100`, sem distinct ou filtro
de filial. Registros sem conta também ocupam posições na janela de 100.
Busca, paginação, IDs e valores selecionados são preservados. O histórico é
reconsultado ao carregar as opções; falhas mantêm a ordem do catálogo.

Somente `worker/workflow.py` do backend compartilhado muda. Android, iOS e
Windows/web recebem a regra pelos clientes já instalados, sem novo binário.
Nenhum lançamento financeiro, rascunho ou anexo é alterado pelo cálculo.

## Validação e publicação

`ACCOUNT_FREQUENCY_SOURCE` deve apontar para o backend privado com as fixtures
`tests/test_workflow.py`. Os testes de comportamento usam dados fictícios.

```sh
ACCOUNT_FREQUENCY_SOURCE=/private/candidate python -B test_regression.py -v
python -B -m unittest discover -s . -p test_deploy.py -v
python -B package.py --baseline /private/baseline --candidate /private/candidate --stage /private/release
```

O pacote fixa os hashes da fonte ativa e do espelho independente. A instalação
usa o lock compartilhado, gate/drenagem, backup, troca atômica, verificação de
saúde e rollback. O espelho é somente verificado e permanece inalterado.
O código completo do backend e credenciais permanecem privados.

Evidência inicial: 7 testes falharam na baseline pela ordenação ausente; os
10 testes de comportamento passaram no candidato. A validação Linux conjunta
passou com 64 testes: 10 de contas, 10 de tipo de despesa preservado, 6 de etapas
e 38 do instalador. Os 14 blocos protegidos de gestos de assinatura estão intactos.
Revisão independente sem achados materiais. Veja `publication.json` para o
resultado final da publicação e os limites da verificação.
