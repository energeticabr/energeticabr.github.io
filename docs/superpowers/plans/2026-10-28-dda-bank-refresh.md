# Consulta manual Sicoob pela Galeria DDA

**Objetivo:** o botão de sincronização pede uma consulta bancária completa, espera a gravação no SharePoint e recarrega a galeria.

**Arquitetura:** reutilizar portal-chat autenticado para uma fila privada de comando fixo, sem dados bancários. Um coletor Windows consulta essa fila por SSH já autorizado e executa o sincronizador existente com certificado local. A fila armazena somente identificador, responsável, estado, horários e contagens. Não há chave privada no servidor nem endpoint local exposto.

**Decisões:** acesso limitado ao responsável já autorizado da lista DDA; fila única e mutex compartilham trabalho concorrente; computador indisponível e falha parcial nunca aparecem como sucesso; apenas clique explícito consulta o banco. Fechar a galeria cancela o acompanhamento, não a execução já iniciada. Próximo clique acompanha a execução ativa. Rotina 07/12/17 e exclusões fixas preservadas.

- [ ] Testar fila: autenticação, isolamento, concorrência, indisponibilidade, prazo e confirmação.
- [ ] Implementar adaptador no portal e coletor local; instalar com backup e verificação.
- [ ] Testar cliente e botão: ordem banco/SharePoint, falha preserva cartões, múltiplos cliques e fechamento.
- [ ] Implementar feedback acessível e acompanhamento limitado, sem dados bancários nos logs.
- [ ] Testar consulta real; revisão independente, builds e publicação web/Android/iOS.
