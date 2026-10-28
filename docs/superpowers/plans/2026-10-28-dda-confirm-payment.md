# Confirmação manual de pagamento DDA

**Goal:** Botão check em cada cartão DDA abre confirmação; Sim registra pagamento manual e remove de pendências sem efetuar pagamento bancário.
**Architecture:** Campos SharePoint PGTO_CONFIRMADO, PGTO_CONFIRMADO_EM, PGTO_CONFIRMADO_POR persistem separadamente do retorno bancário. A situação efetiva nos cartões, filtros, relatório, métricas e lembretes é Pago quando a confirmação manual existe. O coletor não escreve nesses campos, preservando a decisão nas sincronizações.
**Tech stack:** UI JavaScript, API privada Python autenticada existente, SharePoint REST/ETag.
**Spec:** Pedido e imagem desta conversa; check à direita, popup Sim/Cancelar, distinguir confirmação do usuário de liquidação bancária.

- [ ] Testes red/green do botão, cancelamento, duplicação, falha/timeout, recibo inválido, atualização imediata e exclusão de pendências.
- [ ] Endpoint privado idempotente, ator obtido no servidor, campos SharePoint e readback. Sem marcar boletos reais nos testes.
- [ ] Integração UI e callback autenticado; auditoria visível; proteger sessão/fechamento.
- [ ] Revisão independente, guard, suíte, builds e prévia fictícia 390/320.
- [ ] Implantar backend com hashes/check/deploy; PR/merge e publicação mesma revisão web, Play internal e TestFlight. Verificar app publicado sem confirmar boleto real.

## Review focus
- Confirmação manual deve sobreviver à atualização de SITUACAO pelo banco.
- Repetição após resposta perdida não altera autor/data originais.
- Sem confirmação explícita, não há gravação.
- Timeout não é sucesso e não deixa botão preso; logout não atualiza outra sessão.
- Nova autenticação não deve habilitar ator fora do escopo DDA existente.

## Registro
- Usuário dispensa aprovações rotineiras. Fonte branch main 25c39159, branch isolada feat/dda-confirm-payment-20261028; guard 14 blocos intactos.
