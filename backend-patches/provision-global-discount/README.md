# Desconto global da provisão com múltiplas linhas

Ao terminar as linhas de uma provisão múltipla com pelo menos dois itens, o app pergunta se há desconto global e, se SIM, solicita o valor em reais. O desconto deve ser positivo, com até duas casas decimais, e não pode exceder a soma dos produtos sem o frete.

Todas as linhas usam o mesmo fator: `(soma(QTD × UNITÁRIO) - desconto) / soma(QTD × UNITÁRIO)`. O fator reduz o valor unitário; não altera quantidades, frete, fornecedor, filial, anexos ou observações. A precisão do unitário é preservada na fronteira numérica do SharePoint; totais monetários do grupo são conferidos em centavos. A prévia mostra total original, desconto e total líquido antes de qualquer criação.

Na revisão, DESCONTO GLOBAL permite alterar ou remover o valor. Editar o preço/quantidade restaura os originais antes de recalcular. Se o desconto ficar acima do novo subtotal, o fluxo solicita outro valor. Resumos, filtros, retomadas e tentativas não aplicam o desconto novamente. Uma confirmação antiga ou uma prévia desatualizada não posta valores sem a revisão atual. Journals financeiros iniciados ficam congelados. Ao vincular a um descritivo existente, somente as linhas novas do lote recebem desconto; linhas já gravadas não são reescritas.

## Testes e instalação

`tests/test_global_discount.py` usa o WorkflowEngine real com dados sintéticos. Inclui proporção com quantidades distintas/frete, frações, preços, limites, 100%, edição, retomada, confirmação antiga, parent novo/existente, transporte numérico e recuperação sem duplicação. `tests/test_existing_workflows.py` reaplica os testes de frete e filiais explicitamente sem desconto.

Definir `ENERGETICA_BACKEND_TEST_ROOT` para um snapshot privado compatível e executar `python -B -m unittest discover -s backend-patches/provision-global-discount/tests -v`. Os módulos reutilizados dos patches anteriores devem estar disponíveis ao executar cópias fora do repositório. Os contratos de instalação executam com `python -B -m unittest discover -s backend-patches/provision-global-discount -v`.

`package.py PRIVATE_WORKSPACE` gera o diff público e o pacote privado a partir de `baseline/` e `candidate/`. Não publicar o código privado integral nem `source-files.tar`. O diretório de instalação é `/home/opc/provision-global-discount-20261022/release`. Executar a conferência `deploy.py --check SHA_DO_MANIFESTO` e a instalação via `deploy.sh SHA_DO_MANIFESTO` como root. O wrapper mantém escopo de três arquivos, hashes fixos, backup, lock compartilhado, gate/drain, CAS, reinício/saúde e rollback. O espelho de build é somente leitura.

Esta regra é do servidor comum ao Android, iOS e Windows/web; não modifica o cliente nem exige novas instalações nativas.
