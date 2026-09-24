# Galeria de Despesas Recorrentes — G19

## Objetivo

Adicionar ao menu de Suprimentos uma galeria de consulta para `DESPESASRECORRENTES`, baseada nos registros, campos e filtros de `G19- HISTÓRICOLOCACOES` do Power Apps. O botão ficará imediatamente abaixo de `GAL. PGTOS PREVISTOS`, na coluna secundária já usada pelas galerias.

## Dados e apresentação

- Consultar a lista SharePoint `DESPESASRECORRENTES` com a sessão Microsoft atual, paginação e autorização já usadas pelas outras galerias.
- Exibir ID, status, descrição do pagamento, equipamento/produto, imóvel, filial, fornecedor, valor mensal, forma de pagamento, responsável, recorrência, início, próximo agendamento/fim e metadados de criação/modificação quando disponíveis.
- Incluir pesquisa e filtros equivalentes aos controles da G19: ID, imóvel, filial, fornecedor, produto/equipamento, responsável pela locação, forma de pagamento e status. Também oferecer recorrência como filtro útil para a consulta.
- Formatar datas como `dd/mm/aaaa`, valores monetários como BRL e recorrências SharePoint `Day`, `Week`, `Month`, `Year` como Diário, Semanal, Mensal e Anual.
- Paginar a lista e mostrar detalhes completos em modo somente leitura. Anexos abrem no visualizador compartilhado do app.
- Não reproduzir edição, exclusão nem execução do fluxo `CRIARPREVISAOPGTO` nesta galeria.
- Funcionar no app web e nas distribuições Android/iOS que compartilham esta interface.

## Correção associada do atalho de baixa

O check de pagamento pendente deve identificar o fluxo ativo mesmo quando a mensagem de assistente mais recente não é um poll. Usar o estado ativo do controlador como fallback para o contexto do último poll; preservar a proteção que interrompe a operação quando há confirmação de rascunho ou fluxo incompatível.

## Critérios de aceite

1. O check inicia a baixa de um pagamento quando o app permanece no fluxo de anexos de provisão e a última resposta não contém poll, navegando por Pendências sem descartar um rascunho.
2. `GAL. DESPESAS RECORRENTES` aparece abaixo de `GAL. PGTOS PREVISTOS` no menu Suprimentos, sem ser enviado à VM como resposta do fluxo.
3. A galeria busca apenas `DESPESASRECORRENTES`; aplica filtros e pesquisa localmente, apresenta campos G19, pagina resultados e não faz escritas.
4. Datas, valores e recorrências são formatados corretamente; anexos abrem pelo visualizador comum.
5. Fechar a galeria e trocar de conta invalidam operações em andamento, seguindo o ciclo de vida das demais galerias.
