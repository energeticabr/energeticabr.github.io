# Recuperação do fluxo ao reabrir o ENERGÉTICO

O app deve mostrar uma prévia do fluxo anterior e preservar o texto ainda não enviado após fechamento. A VM continua sendo a autoridade; nenhuma resposta, anexo ou confirmação é reenviada automaticamente.

- Cache local pequeno por homeAccountId, acessível apenas após autenticação dessa conta. Sair limpa a cópia local da conta; fechar não limpa.
- Prévia inclui título, dados já recebidos pela VM, última pergunta, rascunho e nomes de anexos pendentes. Não persistir credenciais, URLs de mídia, corpos de arquivo ou histórico completo.
- Texto salva com atraso curto, sem reconstruir o chat a cada tecla; flush ao ocultar/fechar. Falha de armazenamento deve informar sem impedir a conversa.
- Ao reabrir, mostrar prévia não interativa enquanto retoma a VM. Restaurar o rascunho no campo apenas se contexto ainda coincide e não havia envio em andamento. Se houve mudança ou envio incerto, preservar como referência recuperável por ação explícita.
- Uma resposta atual da VM substitui a pergunta antiga. Não ressuscitar fluxo concluído; manter regras de inatividade de 30 minutos existentes.
- Anexos enviados permanecem na VM. Para arquivos apenas selecionados, informar necessidade de selecionar novamente; não simular restauração dos bytes.
- Nenhum custo, mudança de autenticação ou novo serviço.

Contrato aditivo: activeFlow mantém id/title e acrescenta contextId opaco, paused boolean e rows de label/value, provenientes do resumo read-only existente da VM. Clientes antigos continuam funcionando.

## Ampliação solicitada durante a execução

Ao retornar ao menu principal ou sair de um fluxo incompleto, a VM deve guardar rascunho durável por conversa. O menu principal exibe “X rascunhos aguardando” e permite selecionar e retomar cada fluxo no mesmo ponto, preservando respostas e anexos. Todas as perguntas de fluxos recebem “Salvar rascunho e retornar ao menu principal”.

O catálogo usa o state_store existente, não um serviço novo. Gravar um candidato pendente antes de abandonar o estado atual e ativá-lo somente após a transição confirmada por ETag; recibos duráveis permitem concluir a ativação após uma falha. Ao retomar, gravar o estado ativo antes de retirar o rascunho e reconciliar a retirada antes de permitir outras operações. Não guardar concluídos nem menus vazios. Anexos enviados antes da escolha de um fluxo são preservados em um rascunho próprio. Manter guardas de operações em execução e regras de inatividade/diário. A VM do WhatsApp usa os mesmos caminhos.

Subfluxos preservam a referência ao pai mais recente, sem reabrir pais concluídos. A limpeza de anexos considera referências de todos os rascunhos e suas variantes; se não for possível verificar o catálogo, os bytes são mantidos. Falhas de manutenção do catálogo após um cadastro confirmado não transformam esse cadastro em erro nem repetem sua gravação.

Respostas públicas indicam draft_saved:true nas saídas que preservaram rascunho e draft_resumed:true na retomada. O app associa texto ainda não enviado à referência local do contexto, sem submetê-lo como resposta à pergunta/menu.

## Painel de lançamentos múltiplos

Durante o lançamento múltiplo, um painel expansível acima do compositor mostra somente o total agregado quando fechado. Aberto, mostra todas as linhas já adicionadas, com produto, quantidade, valor unitário, frete e total. O painel fica fora do histórico e divide o orçamento de altura com os anexos, com rolagem interna em telas pequenas.

A projeção opcional activeFlow.launches contém id opaco estável por lote, currency BRL, count, total decimal canônico, totalDisplay e lines com index/product/unit/quantity/unitPrice/unitPriceDisplay/freight/freightDisplay/total/totalDisplay. É calculada somente a partir dos campos persistidos na VM, sem gravações, consultas adicionais ou reaplicação de desconto/frete. Usa o cálculo Decimal existente; o navegador não recalcula valores monetários. Não há corte no limite de 50 linhas do resumo textual.

Não contar a linha herdada que ainda está sendo editada. A primeira linha completa pode ser exibida na pergunta de acrescentar linha, antes da primeira captura, mas nunca duplicada. Ao atualizar uma resposta, editar/excluir uma linha ou retomar um rascunho, o painel recebe o estado atual. Abrir/fechar é local e preserva o foco do teclado; aberto/rolagem persistem apenas em memória pelo lote. Menu, conclusão e logout removem o painel. Falhas mantêm o último snapshot confirmado. O painel não entra no cache local de recuperação.
