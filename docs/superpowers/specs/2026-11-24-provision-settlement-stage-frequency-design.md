# Ordenar etapas na baixa de pagamento

## Intenção

Ao escolher uma etapa durante `BAIXAR PAGAMENTO`, mostrar primeiro as etapas mais usadas nos 100 lançamentos mais recentes. Isso facilita reapontar a etapa comum sem alterar o cadastro ou os dados financeiros.

## Abordagens

- Ordenar em cada aplicativo: exigiria manter a mesma consulta e regra em web/Windows, Android e iOS.
- Estender o ranking já existente no backend compartilhado: uma única regra atende todos os clientes e mantém a busca/paginação existente. **Escolhida**, por já haver um helper que consulta `LANCAMENTOS` para `launch/etapa_lancamento`.

## Comportamento

- Aplicar ao fluxo `payment_settlement`, etapa `etapa_baixa`, usando o valor `ETAPA` de `LANCAMENTOS` ordenados por `Id` decrescente e limitados a 100.
- Normalizar os nomes para contar; ignorar valores vazios na contagem, mas manter seus registros dentro da janela de 100.
- Ordenar por frequência decrescente. Em empate, preservar a ordem atual do catálogo; manter disponíveis todas as opções sem uso.
- Manter `NOVA_ETAPA_BAIXA_PROVISAO` no topo como ação de cadastro, sem contá-la como etapa.
- Se a leitura falhar, preservar integralmente a lista e a ordem atual. Não gravar lançamentos, provisões, anexos ou rascunhos ao calcular a ordem.

## Limites e publicação

A mudança fica no backend compartilhado de chat. Os clientes Android, iOS e Windows/web já consultam esse serviço; não há mudança de bundle ou binário. O espelho de build permanece somente leitura. A implantação deve fixar a revisão/hash, obter backup, usar o gate existente, reiniciar o serviço do chat, confirmar saúde local e HTTPS e preservar rollback.

## Decisões para implementação

Reaproveitar `_rank_recent_launch_stage_options`, limitando a nova regra ao par fluxo/etapa de baixa. Preservar inalterado o ranking já existente em `launch/etapa_lancamento`.
