# Equivalência de separadores nas pesquisas

A regra de comparação do worker se aplica a listas do chat, buscas de documentos,
fornecedor de novo pedido e pesquisa geral de lançamentos. O filtro usa uma cópia
normalizada de cada texto. A grafia, o ID e o valor originais da opção permanecem
disponíveis para exibição e seleção.

## Preparação e verificação

Gerar o candidato com `python patch_search.py <snapshot-worker> <candidate/worker>`.
Conferir os hashes de origem e destino em `deploy-manifest.json`. Os arquivos
privados da VM ficam fora do repositório.

Executar `test_search.py <candidate/worker/logic.py>` e `test_runtime.py` no
ambiente Python do worker. Para testar o candidato, definir `SEARCH_CANDIDATE`
como o diretório `candidate/worker`. Para testar a instalação, omitir essa
variável. A verificação usa opções fictícias, sem persistir uma provisão.

## Publicação

Preparar um diretório de estágio exclusivo do root com os candidatos, o
manifesto como `manifest.json`, `deploy.py` e `deploy.sh`. Incluir o
`deploy.py` de `launch-payroll-per-payment` como `shared-deploy.py` e o
`deployment_gate.sh` de `single-launch-order-supplier` com quebras de linha LF.

O script `deploy.sh <sha256-do-manifesto>` usa o lock de implantação e
drena o bridge antes de trocar os três módulos ativos. O instalador verifica os
hashes, guarda cópias dos arquivos, reinicia o bridge e o worker WhatsApp e
confere ambos os endpoints de saúde. Se a instalação falhar, restaura os
arquivos anteriores. O espelho da árvore de build fica preservado.
