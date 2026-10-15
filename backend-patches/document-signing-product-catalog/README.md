# Produtos do comprovante de pagamento

O seletor em **Assinar documentos → Comprovante de pagamento** deve listar
produtos históricos e atuais do `CADASTROPRODUTO`, do maior `Id` para o menor.
Um produto bloqueado para novos lançamentos ainda pode constar de um pagamento
anterior; sua seleção para o comprovante não altera o cadastro ou o status.

No diagnóstico de 15/10/2026, a lista continha 619 registros: 572 `ATIVO` e
47 `BLOQUEADO`. O filtro anterior mostrava só 572. A direção `asc` também
revertia a ordenação por ID do cliente SharePoint. Por fim, o campo de busca
do portal envia `reply_id=filter_query` e a expressão em `text`; o tratador
usava o ID como busca e respondia incorretamente “selecione um produto”.

`patch_workflow.py` aceita somente o hash conhecido do `workflow.py` e três
âncoras exatas. O resultado instala apenas `worker/workflow.py` nos espelhos
de produção e build. `deploy.py` usa o deployer compartilhado com trava,
hashes, backup, instalação atômica, reinício, health check e rollback. Não há
gravação em SharePoint nem mudança de documentos já assinados.

Na VM, executar os testes da versão candidata e conferir o catálogo real:

```sh
sudo env PRODUCT_CATALOG_SOURCE=/home/opc/document-signing-product-catalog-20261015/candidate \
  /opt/energetica-whatsapp/.venv/bin/python /home/opc/document-signing-product-catalog-test-20261015.py -v
sudo env PRODUCT_CATALOG_SOURCE=/home/opc/document-signing-product-catalog-20261015/candidate \
  /opt/energetica-whatsapp/.venv/bin/python /home/opc/document-signing-product-catalog-20261015/diagnose.py
```

Executar `deploy.py --check <sha256-do-manifesto>` antes de `--deploy` e
confirmar depois os hashes dos dois espelhos, os serviços e o health endpoint.
