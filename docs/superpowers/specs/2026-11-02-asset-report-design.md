# Relatório do imobilizado

Tocar no conteúdo de um cartão em CADASTROS IMOBILIZADOS ou LANÇAMENTOS IMOBILIZADOS abre um relatório somente leitura. O cabeçalho identifica o bem pelo ID da lista IMOBILIZADOS. Primeiro aparecem os dados cadastrais atuais; abaixo, todo o histórico da lista LANCAMENTOSIMOBILIZADOS, ordenado por competência decrescente, com percentual, valor depreciado, residual, filial e ID financeiro quando preenchido.

A foto mostra a galeria de lançamentos: seu ID de cartão é o ID do histórico, portanto o vínculo usa exclusivamente ID IMOBILIZADO. Na galeria de cadastros usa o próprio ID. Nunca relacionar por nome, nome vazio, patrimônio ou ID do histórico. Anexos e edição permanecem independentes.

Escolha de implementação: modal com rolagem própria e retorno à mesma busca, página, posição e foco, usando o padrão existente do app. Uma navegação que recarrega a galeria perderia esse contexto; inserir o histórico em cada cartão criaria leituras em massa. Nenhuma alteração nas listas nem no fluxo.

Consultas por ID com metadados comprovados, todas as páginas e falha explícita para paginação incompleta, metadados ambíguos ou cadastro indisponível. Cancelar ao fechar, trocar de bem, sair ou atualizar a galeria; respostas antigas não substituem o relatório atual. Texto SharePoint renderizado como texto, sem interpretar HTML legado. Estados de carregamento, vazio, erro e tentar novamente, teclado/foco e telas 320/390/1365px. Publicar web/Windows, Android interno e TestFlight.

Autorização: o usuário solicitou execução direta e publicação, dispensando perguntas e aprovações intermediárias.
