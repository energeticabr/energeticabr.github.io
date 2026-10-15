# Produtos do comprovante de pagamento

O seletor em **Assinar documentos → Comprovante de pagamento** deve listar
somente produtos `ATIVO` do `CADASTROPRODUTO`, do maior `Id` para o menor.
Produtos `BLOQUEADO` permanecem ocultos, conforme a regra confirmada pelo usuário.

No diagnóstico de 15/10/2026, a lista continha 619 registros: 572 `ATIVO` e
47 `BLOQUEADO`. O filtro de status deve continuar a mostrar só os 572 ativos.
A direção `asc` revertia a ordenação por ID do cliente SharePoint. O campo de busca
do portal envia `reply_id=filter_query` e a expressão em `text`; o tratador
usava o ID como busca e respondia incorretamente “selecione um produto”.

`patch_workflow.py` aceita somente o hash conhecido do `workflow.py` e seis
âncoras exatas. O resultado instala apenas `worker/workflow.py` nos espelhos
de produção e build. `deploy.py` usa o deployer compartilhado com trava,
hashes, backup, instalação atômica, reinício, health check e rollback. Não há
gravação em SharePoint nem mudança de documentos já assinados.

Preparação do deploy: copiar `backend-patches/launch-payroll-per-payment/deploy.py`
para a mesma pasta remota do `deploy.py` deste patch com o nome
`shared_deploy_runner.py`. O wrapper confere o SHA-256 desse arquivo antes de
executá-lo. Copiar também `deploy-manifest.json`, o workflow candidato gerado
e os testes para os caminhos indicados no manifesto; rodar `--check` antes de
qualquer instalação.

Na VM, executar os testes da versão candidata e conferir o catálogo real:

```sh
sudo env PRODUCT_CATALOG_SOURCE=/home/opc/document-signing-product-catalog-20261015/candidate \
  /opt/energetica-whatsapp/.venv/bin/python /home/opc/document-signing-product-catalog-test-20261015.py -v
sudo env PRODUCT_CATALOG_SOURCE=/home/opc/document-signing-product-catalog-20261015/candidate \
  /opt/energetica-whatsapp/.venv/bin/python /home/opc/document-signing-product-catalog-20261015/diagnose.py
```

Executar `deploy.py --check <sha256-do-manifesto>` antes de `--deploy` e
confirmar depois os hashes dos dois espelhos, os serviços e o health endpoint.
