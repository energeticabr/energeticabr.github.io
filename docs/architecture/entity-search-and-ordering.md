# Pesquisa e ordenação das galerias

As galerias consultam o SharePoint pelo Microsoft Graph sem percorrer listas inteiras no navegador.

## Pesquisa

- Um campo pesquisável precisa estar declarado em `searchFields`, existir na lista, ser textual, ter nome interno válido e estar indexado no SharePoint.
- Quando existe um único campo elegível, a consulta usa `startswith` nesse campo e mantém a paginação incremental do Graph.
- Quando existem de dois a oito campos elegíveis, o portal executa uma consulta `startswith` separada e limitada para cada campo, elimina duplicatas pelo ID do item e só aceita o resultado se ele couber integralmente no lote escolhido.
- O repositório recebe apenas campos e termo estruturados. Ele próprio monta o filtro; a interface não pode fornecer OData arbitrário.
- Se qualquer consulta tiver continuação, se o Graph devolver mais itens que `$top` ou se a união ultrapassar o tamanho do lote, a pesquisa falha fechada e solicita um texto mais específico. Nenhum item é truncado ou pulado silenciosamente.
- Pesquisa em vários campos não é combinada com filtros adicionais, pois isso exigiria filtrar mais de uma coluna indexada na mesma requisição.
- A pesquisa é por prefixo, não por ocorrência no meio do texto. Essa é a limitação deliberada que mantém a consulta indexada e evita a leitura integral da lista.

## Ordenação

- `$orderby` é enviado ao Graph apenas para colunas indexadas e de tipo compatível.
- Quando há filtro ou pesquisa em um campo, a ordenação remota só é aplicada ao mesmo campo indexado.
- A pesquisa limitada em vários campos não promete uma ordenação global entre consultas distintas.
- Quando a combinação não é segura, o portal mantém a ordem devolvida pelo SharePoint e informa a limitação; ele não ordena apenas o lote local como se fosse a lista completa.
