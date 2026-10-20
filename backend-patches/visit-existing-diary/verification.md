# Verificação — diário já existente na visita

## Escopo executado em 20/10/2026

- 16 testes específicos do motor passaram, incluindo cinco status e limites de dia/filial.
- 9 testes do instalador passaram; pacote combinado: 25 testes.
- Os testes novos reproduziram o comportamento antigo antes da correção. A revisão reproduziu
  também o POST aceito remotamente mas ainda invisível, usando `SharePointClient.ensure_item`
  real; os dois novos testes falharam antes do checkpoint e passaram após a proteção.
- Os dois serviços usam PrivateTmp do systemd. A coordenação foi fixada no diretório
  compartilhado do estado durável; um teste falhou antes dessa correção e passou depois.
- Testes root/portal: 1.130 totais, 1.124 aprovados, seis skips de plataforma, zero falhas.
- Guard de assinatura: 14 blocos protegidos intactos. Nenhum arquivo do cliente foi alterado.
- Consulta real exclusivamente GET confirmou DATA como DateTime e encontrou diário já cadastrado
  hoje na filial selecionada. Nenhum diário, visita, pedido ou lançamento foi criado nesse teste.

## Limitação conhecida da suíte legada

O fixture local `tests/test_workflow.py` é anterior ao backend em produção. Baseline e candidato
executaram 571 testes com as mesmas 373 falhas, 31 erros e um skip. Foram comparados os nomes
dos 404 testes falhos/com erro, sem adicionar novos nomes. Essa suíte não é apresentada como verde.
Exemplos preexistentes: `test_all_selection_fields_offer_blank_and_blank_is_not_persisted`,
`test_attachment_at_confirmation_compressed_queue_preserves_every_file`,
`test_attachment_at_confirmation_refreshes_summary_without_submitting`,
`test_attachment_at_confirmation_resumes_after_compression_selection` e
`test_attendance_batch_resumes_action_after_reconnect`.
Os diagnósticos completos permanecem privados porque podem conter dados de outros fluxos.

## Publicação

A regra é executada no servidor compartilhado pelos clientes Android, iOS e web/Windows.
Não há alteração de código nativo nem necessidade de uma nova build nas lojas.
A implantação usa hashes fixos, backup recuperável, checagem de deriva e saúde após reiniciar.
O recibo da implantação e a confirmação da revisão integrada são registrados na PR.
Nenhuma duplicidade histórica é removida por este pacote.
