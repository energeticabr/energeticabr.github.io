# Pesquisa contínua nas galerias

A galeria deve pesquisar durante a digitação, sem exigir uma pausa de três segundos. A regra vale para todas as galerias do aplicativo. O campo ativo, texto, seleção do cursor, teclado e filtros escolhidos permanecem utilizáveis enquanto apenas os resultados são atualizados.

## Abordagem

A inspeção encontrou 3.000 ms configurados em lançamentos, 180 ms no formulário automático compartilhado e pesquisa local imediata nos cadastros. Lançamentos já mantém um carregamento restrito aos resultados e valida a versão da resposta. RH consulta em modo discreto; o descarte de respostas precisa invalidar a deduplicação e proteger também falhas antigas.

Escolha de implementação: usar o próximo ciclo de eventos, com atraso zero, no formulário compartilhado e remover a exceção de três segundos de lançamentos. Isso agrupa eventos síncronos duplicados e devolve o controle à entrada nativa antes da consulta. A alternativa síncrona executaria a filtragem dentro do evento de digitação; manter espera por inatividade contrariaria o comportamento solicitado. Os cadastros já imediatos serão verificados na mesma matriz de galerias. A mesma validação do filtro atual usada em respostas de RH também deve proteger falhas antigas que cheguem entre um novo input e sua consulta.

## Contrato

- Cada alteração efetiva inicia a pesquisa sem aguardar silêncio; eventos duplicados de input/change/search não repetem a mesma consulta.
- Respostas e erros antigos não substituem os resultados do filtro mais recente.
- Resultados e totais correspondem ao texto atual, inclusive ao apagar tudo ou retornar a uma consulta anterior.
- Digitação em composição (IME) é aplicada ao terminar a composição.
- A resposta não recria ou desabilita o campo ativo, nem muda seu foco ou seleção.
- Filtros específicos continuam em interseção com a busca e o filtro de opções de um seletor não muda sua seleção.
- Fechar/destruir cancela eventos pendentes e ignora respostas atrasadas.

O callback automático cancela somente seu agendamento, preservando qualquer seletor aberto após o input. RH sincroniza a deduplicação ao reabrir. Cadastros mantêm o último texto concluído durante composição, inclusive em redesenhos disparados por outro filtro.

Sem novos pacotes, mudanças de backend ou alterações nos 14 blocos de gestos protegidos. Abertura inicial e atualização manual preservam seu comportamento. O pedido e as instruções permanentes autorizam execução, integração e publicação em Windows/web, Android interno e TestFlight, sem pausas de aprovação.
