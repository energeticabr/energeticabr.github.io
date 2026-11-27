# Vínculo à folha pelo empreiteiro do pedido

O fluxo lê o fornecedor do pedido em NOTASPENDENTES usando o AGRUPAR dos lançamentos confirmados. Se esse fornecedor for empreiteiro, as linhas dos demais fornecedores ficam disponíveis no seletor. Após a seleção e a escolha da competência, essas linhas vão para a folha do empreiteiro como AJUDA DE CUSTO. O lançamento permanece com o fornecedor original, usado também para validar a origem dos anexos. O tipo de pagamento das linhas próprias continua à escolha do usuário.

A escolha de folha continua individual ou por competência compartilhada. A gravação automática usa o token por lançamento e salva a seleção antes de escrever. Uma tentativa inconclusiva exige que o usuário acione TENTAR NOVAMENTE. O vínculo já verificado é recuperado pelo token no SharePoint.

A correção roda no servidor compartilhado pelo Android, iOS e Windows/web. O pacote verifica os hashes do patch e dos dois ambientes, aplica o patch com o tráfego drenado, guarda os originais e verifica os serviços após a instalação.

Os testes usam o runtime privado do backend com SharePoint e gravações simulados.

```sh
PYTHONPATH=/path/to/backend/worker:/path/to/backend python -B test_order_contractor.py -v
```
