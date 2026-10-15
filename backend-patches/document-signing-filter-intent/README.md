# Busca de produtos no comprovante de pagamento

Em **Assinar documentos → Comprovante de pagamento**, digitar no filtro não
seleciona um produto. Uma busca numérica como `12` procura nos títulos dos
produtos ativos, e uma busca sem resultado mostra uma mensagem neutra. Somente
o toque em uma opção com seu `reply_id` avança para a quantidade. O filtro
`SATUS=ATIVO` e a ordenação decrescente por `Id` não são alterados; os produtos
bloqueados continuam ocultos.

O problema reproduzido era duplo: `resolve_option` consumia `12` como ID antes
do filtro, e a função compartilhada `filter_options` descartava buscas
compostas apenas por dígitos. Em consultas sem correspondência, o seletor
enviava indevidamente “SELECIONE UM PRODUTO DA LISTA”.

`patch_workflow.py` exige o hash conhecido da versão vigente e cria um
candidato separado, sem alterar a origem. Os testes ficam em
`../document-signing-product-catalog/test_product_catalog.py` e devem ser
executados contra o candidato e, antes da mudança, contra a versão vigente
para confirmar as falhas esperadas. O deployer compartilhado verifica hashes,
salva backups dos espelhos de produção e build, instala atomicamente, reinicia
o serviço e verifica a saúde; qualquer falha aciona rollback. O backup é
preservado.

Preparação remota: copiar `deploy.py`, `deploy-manifest.json`, o candidato em
`candidate/worker/workflow.py` e
`../launch-payroll-per-payment/deploy.py` como `shared_deploy_runner.py`
para a mesma pasta de estágio. Conferir o SHA-256 do manifesto, rodar
`deploy.py --check <hash>` e só então `--deploy <hash>`.
