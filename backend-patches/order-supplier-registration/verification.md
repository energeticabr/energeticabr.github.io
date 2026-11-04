# Verificação

- Baseline ativa: `9b47b4448ead3a71a2b093758408c920969b3c36f43a4f63044f6c46beb181ad`.
- Candidato: `7c77bb2b4a4cf201120b8ca5f7d4efa4d56e3873343ecfa555dbb95386dfdc8d`.
- Escopo: somente `worker/workflow.py`; configuração e clientes preservados.
- 22 testes comportamentais passaram no Windows: formato ID/nome, ação no topo,
  filtros por ID/nome, catálogo além da página inicial, pesquisa vazia,
  catálogo anterior à atualização, retorno do cadastro, retorno sem concluir,
  controles antigos, separação entre fornecedor do pedido e fornecedor do
  lançamento, anexos, submissão sintética e propriedade de folha/IDFOLHA.
- 29 testes do instalador no Windows: 24 passaram e 5 restritos a Linux foram
  pulados. O CI executa os testes do instalador no Linux.
- Trava de assinatura: 14 blocos intactos; nenhum arquivo móvel foi alterado.
- Revisão independente: sem problemas Critical ou Important.

## Limitação da suíte legada

A fixture legada disponível localmente foi executada integralmente contra a
baseline ativa e contra o candidato. Ambas produziram exatamente os mesmos
571 testes, 376 falhas, 38 erros e 1 teste pulado, comparando os identificadores
de cada falha, erro e skip. Não é uma suíte aprovada nem evidência de regressão
nova. Os relatórios completos com os nomes e tracebacks estão em
`../private/full-baseline.json`, `../private/full-baseline.log`,
`../private/full-candidate.json` e `../private/full-candidate.log` no workspace
da tarefa, fora do Git. Exemplos inalterados:
`test_all_selection_fields_offer_blank_and_blank_is_not_persisted` e
`test_attachment_at_confirmation_compressed_queue_preserves_every_file`.

## Publicação

As evidências de CI, implantação, hashes e saúde serão registradas após a
publicação. Os testes sintéticos não cadastram fornecedores nem gravam
lançamentos reais.
