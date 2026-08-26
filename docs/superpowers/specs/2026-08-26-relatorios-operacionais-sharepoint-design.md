# Relatorios Operacionais SharePoint

## Objetivo

Adicionar ao portal administrativo uma area somente leitura para consultar e apresentar dados reais das listas SharePoint ja catalogadas e autorizadas para o usuario.

## Escopo

- Login continua exclusivamente Microsoft.
- SharePoint continua como unica fonte operacional.
- O usuario so pode selecionar entidades para as quais possui permissao `view` no modulo correspondente.
- Cada relatorio consulta uma unica entidade por vez, evitando combinar esquemas incompativeis.
- Filtros disponiveis: periodo, filial e status. Um filtro fica indisponivel quando a lista nao possui coluna compativel.
- Cartoes exibem registros carregados, registros filtrados, pendentes e finalizados. Pendentes e finalizados sao classificados somente por valores de status explicitamente reconhecidos; valores desconhecidos nao sao reclassificados.
- A tabela usa as colunas reais retornadas pelo SharePoint.
- Exportacao CSV e impressao representam exatamente o conjunto filtrado em tela.
- Nenhum dado e criado, editado ou removido pela area de relatorios.

## Arquitetura

`portal/reports/report-model.js` concentra deteccao de dimensoes, filtragem, metricas e serializacao CSV como funcoes puras. `portal/reports/report-data.js` resolve a lista e carrega colunas e itens pelo repositorio existente. `portal/reports/reports-page.js` controla a selecao da fonte, os filtros e a renderizacao. O catalogo, roteador, shell e `app.js` recebem somente a integracao necessaria para o novo modulo e a rota `#/reports`.

## Falhas e seguranca

Lista inexistente, acesso negado e falha de rede geram estados distintos. A rota e a lista de fontes aplicam as permissoes existentes antes da consulta. A pagina nao oferece operacoes de escrita. Conteudo vindo do SharePoint e escapado antes de ser inserido no HTML e no CSV e protegido contra formulas de planilha.

## Validacao

Testes cobrem deteccao de colunas, periodo inclusivo, filial/status, metricas, CSV, carga SharePoint, permissao de rota e marcacao da interface. A suite integral e a verificacao de sintaxe precisam passar antes do commit.
