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
- 12 estados visuais (confirmação, catálogo, filtro e busca vazia em
  320/390/1200 px) aprovados, com nomes longos, botões acessíveis e sem overflow.

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

- [PR #745](https://github.com/energeticabr/energeticabr.github.io/pull/745)
  integrado como `8098aacef3964cb518def6b49fd2a53c6b8eca00`.
- [CI da revisão](https://github.com/energeticabr/energeticabr.github.io/actions/runs/41839641404)
  e [CI de main](https://github.com/energeticabr/energeticabr.github.io/actions/runs/41839879342):
  sucesso; 37 testes do instalador no Linux, sem skips.
- Na VM: 22 testes do fluxo e 37 do instalador aprovados antes da troca;
  depois da instalação, os mesmos 22 testes passaram importando diretamente
  `/opt/energetica-whatsapp/worker/workflow.py`.
- Manifesto revisado: `ee6796591185dd0941ac9a02fe918dfe412eb221f82a23ad65d302bca15f8f36`.
- Instalador retornou `deployed`, com saúde `ok` e hash instalado igual ao
  candidato. Verificação independente confirmou novamente esse hash.
- Backup: `/var/backups/energetica-whatsapp/order-supplier-registration-20261104T133823908593Z`.
- Hash do espelho preservado: `f9d768e9c6238a0f28e5377b14237692790cc16292c161d9af5e14c035d5c986`.
- Serviços ativos, saúde do bridge `ok`, gate removido após a instalação.
- Android, iOS e Windows/web recebem esta mudança pelo backend compartilhado;
  os bundles dos clientes não foram alterados. Não foi feito cadastro de
  fornecedor nem lançamento real para validar a alteração.
