# Descritivo da provisão: cluster e detalhamento

## Intenção

Na Galeria Programação de Pagamentos, mostrar em cada provisão o seu vínculo
DESCRITIVOPROVISAO e permitir consultar todas as provisões desse descritivo.
O usuário delegou as decisões de implementação e a publicação sem nova aprovação.

## Abordagem

Usar um bloco azul no cartão e um diálogo de consulta, seguindo os estilos de
clusters e diálogos existentes. Navegar para a galeria de descritivos não atende
à listagem de filhos; expandir todos os filhos dentro do cartão alongaria a
galeria. O diálogo mantém o filtro/página e restaura o foco ao fechar.

## Comportamento

- Bloco "Descritivo da provisão", ID e indicação de ver provisões vinculadas.
  Vínculo vazio/inválido fica identificado, sem ação nem consulta inventada.
- A consulta é nova a cada abertura e independente do filtro, página, fornecedor
  ou status da galeria. Inclui todas as linhas cujo vínculo atual seja o ID exato.
- Exibir identificação do descritivo, quantidade e soma das linhas, além de
  cartões de provisão com ID, fornecedor, descrição, quantidade, valor unitário,
  frete, total, vencimento, status e demais campos úteis presentes.
- Utilizar os cálculos e a formatação existentes, sem duplicar a multiplicação
  da quantidade. Cartões alternam branco e azul claro para facilitar leitura.
- Leitura SharePoint com metadados do vínculo, paginação completa limitada a
  100 páginas de 100 registros; rejeitar resposta parcial, cursor incompleto ou
  cíclico, IDs conflitantes/duplicados e identidade de descritivo incorreta.
- Carregamento com mascote, fechamento disponível, falha com nova tentativa e
  prazo de 30 segundos. Fechar/reabrir, atualizar, destruir a galeria ou encerrar
  a sessão cancela a consulta e impede resultados atrasados de reaparecer.
- Foco contido no diálogo, Escape/fechar e retorno ao acionador; texto sempre
  escapado e layout utilizável em 320px, 390px e Windows.

## Limites e validação

Somente leitura: não modificar registros, vínculos, anexos, status ou esquema.
Não alterar os 14 blocos protegidos da assinatura. Cobrir leitura completa,
filtragem exata, vazios/erros, corridas de resposta e teclado com testes reais dos
componentes; validar visualmente com dados fictícios. Executar suíte/builds,
revisão independente e publicar a mesma revisão em web/Windows, Play interna e
TestFlight. Verificar o cluster e o detalhamento no app publicado sem gravações.
