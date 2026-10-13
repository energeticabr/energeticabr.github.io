# Nova atividade durante a criação do demonstrativo

Na pergunta `atividade_demonstrativo_etapa`, a opção final
**➕ CRIAR NOVO DEMONSTRATIVO ETAPA** cadastra uma atividade na lista
`ATIVIDADE EXECUTADA`, não um segundo demonstrativo.

O cadastro herda FILIAL e ETAPA do demonstrativo pausado; esses dois campos
não podem ser alterados no resumo do filho. Depois de sua confirmação e
gravação, o ID e a descrição da atividade são selecionados automaticamente,
e o demonstrativo continua na pergunta de observações.

Campos, respostas, anexos, token do pai e eventual retorno externo para
validação de presença são preservados. Cancelar o filho retorna ao seletor
original, inclusive ao digitar CANCELAR no nome/edição ou usar o botão
Cancelar de um resumo anterior depois de voltar. Voltar na primeira
pergunta, antes de informar a atividade, também
retorna ao pai. Duplicatas, repetição da confirmação e falha de gravação não
criam um demonstrativo nem confirmam uma presença.

## Validação e empacotamento

Os testes usam o WorkflowEngine real e o harness existente
`tests/test_workflow.py`; SharePoint, mídia, canal e estado são apenas
adaptações em memória. Executar num sandbox com `worker/` e `tests/`:

São 15 testes funcionais e 8 de segurança do deployer. A suíte legada é
comparada com o baseline, sem aceitar novos casos de falha/erro.

```sh
PYTHONPATH=tests python -B -m unittest test_demonstrative_new_activity -v
python -B -m unittest test_deploy -v
```

Baseline SHA-256 de `worker/workflow.py`:
`74f9c1e789d1124f671efe7d63637c95731855123dd84cf2e332f1c3b33c47f1`.
`package.py` gera somente o diff e o manifesto; não inclui configurações,
credenciais, estado de conversas ou registros.

## Publicação

`deploy.py` reutiliza o deployer compartilhado por hash fixado, com lock,
verificação de drift, backup, cópia atômica, health check e rollback.
Somente `worker/workflow.py` é instalado nos dois roots existentes.
As configurações particulares de cada root não são copiadas.

A mudança é no servidor compartilhado consumido por Android, iOS e Windows.
Não altera código nativo nem exige uma nova distribuição de binários.
