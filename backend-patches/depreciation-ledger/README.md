# Histórico de depreciação em lista

O fluxo diário DEPRECIACAO cria o lançamento financeiro original e grava o histórico em LANCAMENTOSIMOBILIZADOS. A linha contém bem, filial, percentual, competência, depreciação, residual, ID IMOBILIZADO e o ID LANÇAMENTO devolvido pela criação financeira. A atualização do cadastro depende do sucesso dessa gravação.

`build-flow.mjs` transforma uma cópia da definição existente. Conserva os cálculos, seleção de itens, lançamento financeiro, próxima data, saldo e relatório consolidado. Retira somente a escrita `item/HTML` do cadastro. O HTML legado permanece e os vínculos financeiros antigos ficam vazios.

## Implantação

`Deploy.ps1` utiliza a sessão Microsoft existente e exige uma pasta de evidências externa ao git com `flow-before.json`, `assets-before.json` e `history-before.json`. Não grave tokens nessa pasta. Modos em ordem:

1. `Prepare`: confere a definição atual, cria somente a coluna opcional numérica `IDLANCAMENTO` na lista histórica, resolve os nomes reais das oito colunas e gera a definição.
2. `Probe`: executa as expressões reais em um fluxo temporário sem conectores, com três bens fictícios, valida 27 resultados e remove esse fluxo. A aprovação fica vinculada ao SHA256 da definição e do mapa de colunas.
3. `Publish`: exige essa aprovação, ausência de execução pendente e definição original intacta; atualiza somente o fluxo alvo.
4. `Verify`: relê a definição, conexão, schema e todos os cadastros e históricos para comprovar preservação.

O script nunca dispara o fluxo de produção. A recorrência original continua responsável pelas depreciações reais. Falhas de gravação não avançam a data/saldo do cadastro. Esta alteração não implementa compensação ou retomada idempotente do lançamento financeiro original.

## Verificação local

```powershell
node --test backend-patches/depreciation-ledger/tests/*.test.mjs
node --test apps/energetico-mobile/tests/asset-launches-gallery.test.mjs
```

Para rollback, compare primeiro a definição live com `definition-after.json` e verifique se houve execução após a publicação. Restaure exclusivamente a definição de `flow-before.json` mantendo as conexões originais. Não apague a lista, a coluna, nem os registros criados; revise qualquer depreciação já processada antes de uma reexecução.

## Número do pedido

`build-order-link.mjs` acrescenta somente `item/IDPEDIDO` ao histórico, a partir de `Create_item.body.AGRUPAR` (ID de NOTASPENDENTES). Valores nulos/vazios permanecem vazios. A criação financeira e o restante da definição não mudam.

Para essa extensão, usar uma pasta de evidências nova e executar `Link-Orders.ps1 -Mode Prepare`, `Deploy.ps1 -Mode Probe`, `Deploy.ps1 -Mode Publish`, `Link-Orders.ps1 -Mode Backfill` e `Link-Orders.ps1 -Mode Verify`, todos com o mesmo EvidenceRoot. Prepare cria apenas a coluna numérica opcional NÚMERO DO PEDIDO e os backups; Probe verifica pedido numérico/nulo/vazio junto aos cálculos originais, sem conectores. Publish exige o hash exato aprovado.

Backfill comprova a cadeia IDLANCAMENTO → AGRUPAR → pedido existente e usa MERGE de apenas IDPEDIDO com o ETag concreto da linha. Linhas sem ID financeiro ficam sem vínculo inferido. Verify exige preservação do campo nas linhas não planejadas e valor exato nas planejadas, além de preservar os demais dados. Após Backfill, use o Verify de Link-Orders, pois o verificador da primeira implantação exige que nenhum histórico tenha sido editado. Reexecutar Backfill mantém os valores já confirmados e não repete a escrita.
