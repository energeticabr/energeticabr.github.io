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

O catálogo usa o state_store existente, não um serviço novo. Gravar o rascunho antes de abandonar o estado atual; ao retomar, gravar o estado ativo antes de retirar o rascunho. Não guardar concluídos nem menus sem fluxo. Manter guardas de operações em execução e regras de inatividade/diário. A VM do WhatsApp usa os mesmos caminhos.

Respostas públicas indicam draft_saved:true nas saídas que preservaram rascunho e draft_resumed:true na retomada. O app associa texto ainda não enviado à referência local do contexto, sem submetê-lo como resposta à pergunta/menu.
