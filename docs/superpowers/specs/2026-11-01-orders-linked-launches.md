# Pedido selecionavel na galeria

Tocar na ficha do pedido (ID, fornecedor ou dados) abre a consulta existente do pedido e seus lancamentos vinculados, sem entrar em edicao. O ID sera um botao nativo acessivel por teclado, com area de toque estendida ao conteudo da ficha. Anexos, editar e excluir permanecem controles independentes. Reutilizar openLinkedDetails e o servico existente, que consulta o ID exato por AGRUPAR e pagina as listas ativas e arquivadas.

Ao fechar/voltar, manter filtros, ordenacao, pagina e rolagem da galeria e retornar o foco ao pedido. Carregamento, erro, tentar novamente e cancelamento devem continuar funcionando; respostas antigas nao podem substituir outro pedido. Nenhuma gravacao ou alteracao de dados e necessaria. Preservar o layout compacto e os 14 blocos protegidos de assinatura; verificar toque, teclado e ausencia de overflow em 320/390px e desktop. Publicar Windows/web, Android interno e TestFlight com a mesma revisao validada.
