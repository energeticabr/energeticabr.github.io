# Baixa parcial de provisões por descritivo

A tabela de revisão terá uma coluna de seleção à esquerda, uma caixa por linha pendente e um controle Selecionar todos abaixo. QTD e os valores de quantidade não quebram linha. Linhas já baixadas continuam visíveis, desabilitadas e apenas para consulta. Os pendentes começam marcados para preservar o comportamento dos clientes existentes; o usuário pode desmarcar todos e escolher apenas alguns.

Somente os IDs selecionados seguem para a confirmação, a tabela de lançamentos e as gravações de provisões/lançamentos/pedido. Seleção vazia, item estranho ao descritivo, linha já paga ou contexto alterado não autoriza gravação. A seleção local não realiza requisições a cada clique; Submeter e Editar levam a lista explícita ao servidor, que valida e persiste o contexto.

O descritivo permanece em aberto, sem data de pagamento efetuado, enquanto qualquer provisão vinculada não estiver efetivamente baixada. Antes de concluir o pai, reler as linhas vinculadas e confirmar o estado de todas. A data final corresponde à maior data efetiva dos pagamentos. Manter o valor integral do descritivo separado do valor cumulativo já baixado no pedido.

Todas as baixas do mesmo descritivo reutilizam um único IDPEDIDO, inclusive em dias diferentes e após retomada. Recuperar o vínculo existente e usar identidade idempotente estável por descritivo para impedir duplicação após falha antes de vincular a primeira linha. Validar a posse/coerência do pedido; vínculos conflitantes exigem revisão, não escolha arbitrária. Atualizar apenas o montante cumulativo efetivamente baixado, preservando a data e identidade do pedido.

Preservar diário de gravação, retomada, bloqueios e confirmação final. Não tocar em linhas desmarcadas nem executar testes financeiros reais. O ajuste anterior de Cadastrar etapa e filial padrão permanece no escopo. Publicar backend, PC/web, Android interno e TestFlight.

## Contrato

- `detail_table.kind = provision_settlement_review`, `selectionEnabled = true`, `selectedIds` e `rows[].selected`.
- `description_review_submit:<ids separados por vírgula>` e `description_review_edit:<ids>` levam a seleção explícita; comandos legados usam a seleção validada do servidor.
- `rows[].totalCents`, quando oferecido, é string inteira para projeção precisa do subtotal. O servidor calcula os valores autoritativos.
- `rows[].canSubmit` valida cada linha; assim, uma pendência inválida não impede a baixa de outra linha válida que foi selecionada. Clientes legados conservam a validação global.
- `pendingTotalDisplay` representa todas as pendências, separado do subtotal selecionado. Linhas indisponíveis usam `readonlyLabel` sem afirmar que já foram pagas.
- A seleção usa o mesmo bloqueio de interação da conversa durante envio de anexos, processamento e recuperação de conexão.
