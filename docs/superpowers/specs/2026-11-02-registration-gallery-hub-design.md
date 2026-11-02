# Galeria de Cadastros

Adicionar em Suprimentos um botão cinza **GALERIA DE CADASTROS**, na mesma linha e à direita de **EFETUAR CADASTROS**. Abrir uma escolha local com **GALERIA GRUPO**, **GALERIA FAMÍLIA**, **GALERIA SUBFAMÍLIA** e **GALERIA PRODUTO**, nessa ordem, usando os acessos já existentes. Voltar de uma dessas galerias retorna à escolha; voltar da escolha retorna a Suprimentos. Início mantém a navegação padrão.

Reutilizar o comportamento de escolha de Imobilizados em um componente compartilhado, preservando seus controles, classes, proteção contra cliques duplicados e respostas de sessões encerradas. Abrir o menu não deve consultar listas nem enviar uma resposta ao servidor. As galerias existentes continuam disponíveis em Efetuar Cadastros.

Alternativas consideradas: duplicar o seletor de Imobilizados aumenta a manutenção; adicionar um novo fluxo remoto cria dependência desnecessária. A decisão é um seletor local compartilhado com os quatro destinos existentes. O usuário já determinou execução e publicação sem perguntas de aprovação.

Validar pareamento cinza/azul, quatro destinos reais, retorno, sessão encerrada, carregamento tardio e layout em 320/390 px e desktop com dados fictícios. Preservar os 14 blocos de assinatura e publicar a revisão validada no web/Windows, Android interno e TestFlight.
