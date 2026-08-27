# Relatorios Operacionais SharePoint

## Objetivo

Adicionar ao portal administrativo uma area somente leitura para consultar e apresentar dados reais das listas SharePoint ja catalogadas e autorizadas para o usuario.

## Escopo

- Login continua exclusivamente Microsoft.
- SharePoint continua como unica fonte operacional.
- O usuario so pode selecionar entidades para as quais possui permissao `view` no modulo correspondente.
- Cada relatorio consulta uma unica entidade por vez, evitando combinar esquemas incompativeis.
- Filtros disponiveis: periodo, filial e status. Um filtro fica indisponivel quando a lista nao possui coluna compativel.
- Cartoes exibem registros consolidados, registros filtrados, pendentes e finalizados. Pendentes e finalizados sao classificados somente por valores de status explicitamente reconhecidos; valores desconhecidos nao sao reclassificados.
- A tabela usa as colunas reais retornadas pelo SharePoint.
- A tabela possui paginacao apenas visual; indicadores, opcoes de filtro, exportacao CSV e impressao usam o conjunto consolidado da consulta, nao somente a pagina visivel.
- A consulta percorre `@odata.nextLink` incrementalmente, com cursores validados para a mesma lista, progresso visivel e cancelamento ao trocar fonte, filtro ou rota.
- O teto operacional e de 5.000 itens, 25 paginas Graph e lotes de ate 200 itens. Se houver continuacao depois do teto, todos os artefatos identificam o resultado como `relatorio parcial` e nao afirmam contagens totais.
- Filtros Graph sao aplicados somente quando derivados de uma coluna real, indexada e de valor validado; os demais filtros continuam sendo aplicados localmente sobre o recorte consolidado.
- Nenhum dado e criado, editado ou removido pela area de relatorios.

## Arquitetura

`portal/reports/report-model.js` concentra deteccao de dimensoes, filtragem, metricas e serializacao CSV como funcoes puras. `portal/reports/report-data.js` resolve a lista e executa uma sessao Graph incremental pelo repositorio autorizado existente. `portal/reports/reports-page.js` controla fonte, filtros, cancelamento, progresso, paginacao visual e artefatos consolidados. O catalogo, roteador, shell e `app.js` recebem somente a integracao necessaria para o novo modulo e a rota `#/reports`.

## Falhas e seguranca

Lista inexistente, acesso negado e falha de rede geram estados distintos. Entidades com `available=false` nunca sao oferecidas. A rota, a lista de fontes e cada lote Graph aplicam as permissoes existentes antes da consulta. A pagina nao oferece operacoes de escrita. Conteudo vindo do SharePoint e escapado antes de ser inserido no HTML e no CSV; formulas de planilha sao neutralizadas mesmo quando precedidas por espacos, controles ou caracteres invisiveis.

## Validacao

Testes cobrem deteccao de colunas, periodo inclusivo, filial/status, metricas consolidadas, CSV seguro, paginacao Graph, validacao de `nextLink`, cancelamento, limite parcial, permissao de rota e marcacao da interface. A suite integral e a verificacao de sintaxe precisam passar antes do commit.
