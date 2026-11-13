# Vínculo existente à folha na baixa de provisão

O SharePoint devolve o campo numérico IDPROVISAO como decimal integral. A baixa agora compara o identificador numericamente e confirma um IDFOLHA positivo antes de oferecer qualquer inclusão. A folha já registrada é preservada.

Conversas que estavam nas etapas opcionais de folha são reconciliadas ao responder ou retomar. Em lotes mistos, só as linhas ainda sem vínculo ficam nas perguntas. As escolhas válidas das linhas restantes e os pagamentos cuja gravação já foi verificada são preservados. Se a consulta falhar, a recuperação fica pendente em uma ação de nova consulta, com a baixa já confirmada.

As duas versões do diff correspondem às revisões distintas do serviço e do espelho. O manifesto fixa a origem, o diff e a revisão instalada. O instalador aplica os candidatos compilados com lock, backup, rollback e checagem de saúde dos serviços. Android, iOS e Windows recebem a correção pelo serviço compartilhado.

Os testes podem ser executados com o caminho do workflow de uma das raízes em WORKFLOW_SOURCE e `python -m unittest discover -s tests`. Eles usam respostas simuladas do SharePoint e executam a lógica dos fluxos de baixa e retomada sem lançar pagamentos.
