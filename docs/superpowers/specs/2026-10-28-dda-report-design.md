# Relatório DDA no menu inicial

O usuário pediu um novo relatório dos DDAs da empresa, com filtro inicial somente Em aberto e botão imediatamente abaixo do mascote de provisões pendentes, o primeiro da coluna esquerda. A execução e a publicação web, Android interno e TestFlight estão autorizadas sem perguntas.

Será um relatório próprio, em tabela, usando a leitura autenticada e completa da lista DDAS SICOOB já empregada pela galeria. A galeria atual continuará independente. A alternativa de apenas reabrir a galeria não oferece a visão consolidada solicitada; criar outra integração bancária duplicaria uma fonte já disponível. Escolha de implementação: reutilizar a fonte e o ciclo de sessão das galerias e criar uma apresentação de relatório com totais.

Ao abrir, Situação = Em aberto; não há corte por vencimento. Ordem de vencimento crescente, datas inválidas no final. Filtros de situação, banco e pesquisa por fornecedor/documento/ID; o usuário pode selecionar Todas. Quantidade, valor nominal total e indicadores de vencimento refletem o filtro. Valor ausente/inválido não será tratado como zero. Situação desconhecida não será inferida como aberta ou paga.

Tabela com ID, vencimento, fornecedor, documento, banco, valor nominal, situação e acesso aos espelhos existentes. Paginação local e impressão de todos os resultados filtrados pelo mecanismo padrão. Leitura apenas; nenhuma ação de pagamento, exclusão ou edição. Fechar, sair da conta ou navegar invalida consultas e prévias pendentes. Falha na leitura não apresenta um relatório parcial como completo.

O botão reutiliza o mascote existente e recebe uma identificação DDA; demais atalhos da esquerda descem uma posição. O relatório participa da navegação e impressão existentes. Layout segue os relatórios horizontais do app, incluindo celular, tablet e Windows. Nenhuma alteração nos blocos protegidos de assinatura.
