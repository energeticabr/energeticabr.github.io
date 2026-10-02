# Relatório 1 — Controle de empreiteiros no Energético

## Objetivo e escopo

O menu principal do chat oferece uma entrada **Relatórios**. Ela abre um painel de relatórios com o quadrado 1, **Controle de empreiteiros**, funcional. A estrutura admite outros quadrados no futuro, sem apresentar números ou dados fictícios para relatórios ainda não especificados. O painel e o relatório funcionam na mesma interface web usada por iOS, Android e PC.

## Fonte e semântica

O relatório é somente leitura e usa as listas SharePoint `EMPREITEIRO`, `DOCUMENTOS_1`, `LANCAMENTOS` e `DESCRICAOMEDICOES` no site pessoal, por meio da autenticação Microsoft e do repositório do app. Os seis filtros são ID da linha de empreiteiro, filial, fornecedor, etapa da obra, atividade executada e status. Todos podem ser combinados; as opções vêm dos valores reais carregados. O resultado é ordenado por data de início decrescente e, em empate, por ID decrescente.

Os indicadores obedecem à fórmula fornecida: linhas com status ATIVO, linhas com status INATIVO, quantidade distinta de `IDCONTRATO` preenchidos e soma de `VALORGLOBALESTIMADO` das linhas ativas. Valores numéricos inválidos não entram na soma, mas permanecem visíveis na tabela como pendência. O filtro de ID seleciona a linha `EMPREITEIRO.ID`, mesmo que `IDCONTRATO` seja outro número.

A tabela principal apresenta as 13 colunas do PowerApps. Dados não preenchidos exibem PENDENTE em laranja. O status ATIVO fica verde, INATIVO vermelho. IDs de documentos são coloridos pelo status da linha correspondente em `DOCUMENTOS_1`: SUBMETIDO verde e PENDENTE vermelho; falha de consulta não equivale a documento submetido. A tabela deve manter todos os campos acessíveis em telas pequenas, com rolagem horizontal e coluna ID fixa.

Quando se filtra um ID, o relatório mostra lançamentos `CONTRATO = ID da linha` e medições `NUMEROCONTRATO = ID da linha`, ordenados por ID decrescente. Os lançamentos calculam `quantidade × valor unitário + frete`, e a classificação de pagamento usa `CONCLUÍDO` segundo a fórmula original. A navegação não altera as listas.

## Estados e falhas

Mostrar carregamento, vazio, erro com tentativa novamente e cancelamento de consultas ao fechar ou trocar o ID. Resolver nomes internos de colunas a partir de metadados; não assumir que o nome exibido é o nome Graph. Recusar resultados truncados em limite de paginação, em vez de exibir indicadores falsamente completos. Evitar inserir texto SharePoint como HTML.

## Layout e validação

Recriar o estilo visual: filtros com cabeçalho vermelho, quatro indicadores coloridos, tabela azul-escuro, células de pendência/situação e detalhes condicionais. No celular, os filtros e indicadores reorganizam-se em duas colunas ou uma coluna e a tabela rola horizontalmente; no PC, o conteúdo usa a largura disponível. Testes cobrem mapeamento de campos, paginação, filtros, métricas, detalhes e integração da entrada do menu. Verificar suite, build web/PWA e projetos nativos antes da publicação.
