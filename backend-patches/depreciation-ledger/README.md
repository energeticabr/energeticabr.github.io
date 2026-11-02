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
