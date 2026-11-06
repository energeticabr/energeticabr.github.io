# Verificação da correção

- Causa reproduzida na baseline ativa: `step_with_create` desativava
  `auto_select_single` nos lançamentos/baixas e inseria um controle de cadastro.
- 10 testes direcionados passaram no candidato final, incluindo caminhos via
  `engine.handle`, seleção automática, múltiplas linhas, baixa, retomada,
  controles atrasados, cadastro filho antigo e prioridade do checkpoint financeiro.
- Cinco testes do cadastro de produto passaram: confirmação, cancelamento,
  retorno aninhado, duplicidade e voltar.
- 38 testes do instalador passaram; conferência remota do pacote retornou
  `checked` e saúde `ok`.
- Trava de assinatura: 14 blocos intactos. Nenhum arquivo dos clientes mudou.
- Revisão independente identificou e levou à correção da retomada do cadastro
  filho e do despacho antecipado da paginação. Controles globais mantêm seu fluxo.

## Limites dos diagnósticos históricos

A suíte histórica completa foi interrompida após seis minutos ainda na baseline,
sem concluir. Não foi considerada aprovada.

A suíte histórica de unidade executou 30 testes em cada versão, com 37 falhas de
asserção/subteste na baseline e 35 no candidato. Não surgiram falhas novas; duas
falhas de múltiplas linhas foram resolvidas. As demais incluem expectativas
antigas de navegação, como esperar produto antes da pergunta de fornecedor do
pedido. Identidades completas estão em `legacy-unit-comparison.json`.

Os testes funcionais usam fixtures e armazenamento sintéticos. Não gravaram
lançamentos, baixas ou cadastros reais. A disponibilidade nos três clientes
depende da publicação do mesmo backend, sem envio de novos binários às lojas.

## Pacote

Manifesto SHA-256: `faffed29493768bbab8e84ded1a2389d15f5b99740ea01b6de82efa50ca742b5`.
Somente os dois arquivos declarados no manifesto são instalados. A verificação
posterior à publicação será registrada em `publication.json`.
