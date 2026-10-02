# Relatório 2: Presenças vinculadas por pedido / IDPGTO

## Intenção e escopo

Adicionar ao painel de relatórios do Energético o segundo quadrado funcional, reproduzindo os dados e a hierarquia do HTML de PowerApps fornecido pelo usuário. O Relatório 1 continua disponível. Em telefones, inclusive na orientação horizontal, ambos os relatórios devem mostrar todos os campos dentro da largura da tela: cartões verticais substituem tabelas largas, sem rolagem lateral. Em telas grandes, o Relatório 1 mantém a tabela existente e o Relatório 2 usa colunas visuais compactas.

## Fontes e relações

- `DESCRITIVOPRESENCA` fornece as presenças com `IDPGTO` preenchido. Cada presença tem ID, DATA, FILIAL, IMOVEL, FORNECEDOR, ETAPA, ATIVIDADEEXECUTADA, PRESENCA, VLORDIARIO, OBS e MOTIVACAO quando disponíveis.
- `LANCAMENTOS` é consultada pelo ID numérico indicado em `IDPGTO`. `AGRUPAR` é o pedido; valor do lançamento é valor unitário × quantidade + frete. Ausência de lançamento não vira valor zero nem se mistura com outros pedidos ausentes.
- `FORNECEDORES` relaciona `CADASTRO` e `STATUS` pelo nome do fornecedor, como no PowerApps. Status desconhecido fica explícito; não é presumido como ativo.
- Carregar todas as páginas necessárias, nunca publicar totais de um conjunto truncado. Consultas de lançamentos únicos têm concorrência limitada. Erros de rede/autorização exibem falha e opção de tentar novamente; resposta atrasada não deve substituir uma sessão encerrada.

## Filtros e cálculo

Período inicial/final inclusivo por data de presença, filial, imóvel, fornecedor, status do fornecedor e etapa. Filtros combinam-se entre si. Status inicia em `ATIVO` quando existir, conforme referência; é possível escolher `Todos`. Data final inicia no dia atual e data inicial fica vazia. Os indicadores mostram quantidade de `IDPGTO` distintos, quantidade de presenças vinculadas e soma de `VLORDIARIO` filtrado. Se algum valor diário estiver ausente/inválido, o total é marcado incompleto, nunca apresentado como zero definitivo.

Após filtrar, agrupar presenças por `IDPGTO`; enriquecer cada grupo com seu lançamento; agrupar os pagamentos por `AGRUPAR`. Pedidos e IDPGTO seguem ordem numérica decrescente, presenças ordem cronológica crescente. Para cada pagamento, mostrar valor do lançamento, total das presenças e diferença (verde quando arredondada a centavos é zero, vermelha quando diverge). Mostrar período e contagem de presenças. Cada presença mostra dados de origem, valor diário, status do fornecedor, observação/motivação; ausência recebe vermelho, fornecedor divergente do lançamento recebe amarelo.

## Interface

Quadrado `2 · Presenças por pedido` abre a nova seção do painel. Cabeçalho, botão de atualizar, filtros, indicadores e grupos de pedido seguem o visual vermelho/azul do PowerApps. Na tela grande, cada pagamento é uma grade de cinco áreas (pedido, IDPGTO, lançamento, valores, presenças). Abaixo de 1000 px, essas áreas reorganizam-se em cartões de uma ou duas colunas e não têm largura mínima maior que o viewport. O Relatório 1 também converte suas tabelas de 13 e de detalhes em cartões com rótulos de campo abaixo desse limite. Rolagem vertical é permitida; rolagem lateral não é necessária para ler nenhum dado. Títulos, estados vazios, aviso de consulta incompleta e controles são acessíveis.

## Verificação

Testes puros cobrem normalização dos campos SharePoint, filtros inclusivos, agrupamento, totalização, dados ausentes, status e divergências. Testes do adaptador cobrem paginação completa, dados vinculados únicos, 404 de lançamento, falha transitória e cancelamento. Testes DOM cobrem abertura do quadrado 2, filtros, atualização, erro/retentativa, escape de HTML, e rótulos dos cartões do Relatório 1. Testar visualmente telefone horizontal e desktop, compilar web/PWA e seguir o CI nativo/publicação existente.
