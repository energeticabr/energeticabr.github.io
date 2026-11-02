# Seletores por linha no resumo de presenças

Adiciona `cell.editor = {value, options:[{value,label}]}` às células IDDESCRITIVO e ATIVIDADEEXECUTADA na confirmação em lote. Os valores são comandos opacos `attendance_inline:` com revisão aleatória, ID do registro, campo e índice; somente a whitelist da tabela atual é aceita. Android/iOS/Windows usam o mesmo transporte `select-reply`, sem endpoint novo. Clientes antigos continuam usando o resumo textual e a confirmação existente.

A alteração fica no rascunho da linha. Trocar o descritivo copia IMOVEL/ETAPA disponíveis e deixa ATIVIDADEEXECUTADA vazia até nova escolha. Selecionar o mesmo descritivo preserva a atividade. A confirmação bloqueia linhas alteradas com atividade vazia, falha de catálogo e as inconsistências já verificadas pelo motor. Cada entrada do journal recebe seus próprios `updates`; a recuperação continua idempotente e usa os controles existentes de ETag/conflito. Voltar não grava no SharePoint; edição global substitui os overrides dos campos envolvidos.

Catálogos reutilizam uma consulta por seletor/contexto de filtros declarados, dentro da emissão de cada tabela. Fontes com recomendações/condicionais/desconhecidas usam contexto completo. O cliente recebe o valor atual mesmo se ausente do catálogo, como escolha inerte. Falhas preservam os valores e oferecem CARREGAR SELETORES; uma confirmação recebida durante a falha somente recarrega o resumo, exigindo confirmação posterior. A whitelist é renovada após cada seleção/reconexão e limpa ao sair/iniciar/concluir o lote.

## Artefatos e geração

`package.py` exige as duas fontes byte a byte em `baseline/workflow-app.py` e `baseline/workflow-build.py`, com SHA256 fixados no script. Aplica âncoras únicas e produz candidatos separados, patches e manifesto. As fontes já divergiam; uma raiz nunca sobrescreve a versão da outra. `baseline/` e `candidate/` estão ignorados no Git. Nenhum arquivo de configuração, credencial, estado de usuário ou anexo faz parte do patch.

```sh
python3 package.py
```

No servidor, o pacote revisável está em `/home/opc/attendance-inline-20261102`; os sandboxes são `sandbox-app`, `sandbox-red` e `sandbox-build-with-app-helpers`. O sandbox usa cópias dos módulos de produção, a fixture `tests/test_workflow.py` do build e todos os serviços externos em memória. O build isolado já apresenta falha de importação de `provision_money` em seus helpers; para testar seu workflow sem mudar produção, foi usada a mesma cópia dos helpers de produção.

## Verificação em 02/11/2026

- RED no motor vigente, com navegação `choice:data_presenca_pendente:1814`: 14 testes, 2 falhas e 12 erros, antes da implementação.
- Candidato final app: 15 testes em 3.670s, OK. Candidato build: 15 testes em 5.299s, OK.
- Segurança de publicação (Linux/POSIX): 9 testes em 0.122s, OK. Inclui CAS/drift, candidato adulterado, raízes independentes, check sem escrita, rollback por restart/health e preservação de alteração concorrente.
- Após publicar, `verify_deployed.py` importou explicitamente `/opt/energetica-whatsapp/worker/workflow.py` e executou novamente os 15 testes com serviços externos em memória: 15 testes em 2.000s, OK.
- Os 15 testes incluem envio de metadados pela classe real ChannelMessenger (extraída via AST para não inicializar serviços), isolamento por linha, limpeza/reseleção, replay inválido, cancelamento, reconexão, erro/retry de catálogo, cache por contexto, edição global, consistência e recuperação de lote parcialmente gravado.
- Comparação dos 112 testes legados de presenças: resultados baseline/candidato idênticos; 20 passam, 87 falhas, 4 erros e 1 skip preexistentes. O comparador mantém todos os testes e não altera a fixture. Esse legado divergente não é relatado como suíte aprovada. A lista completa de falhas/erros/skips comuns ao baseline e candidato está em [legacy-results.json](legacy-results.json).
- `deploy.py --check` concluído com `status=checked`; publicação concluída em seguida com `status=deployed` e health `status=ok/channel=generic`. Os dois serviços estão ativos, e os hashes instalados correspondem ao manifesto. Backup: `/var/backups/energetica-whatsapp/attendance-inline-20261102T170232232840Z`. Recibo em [deployment-receipt.json](deployment-receipt.json). Nenhum registro de usuário foi escrito pelos testes.

```sh
cd /home/opc/attendance-inline-20261102/sandbox-app
ATTENDANCE_INLINE_SOURCE=$PWD PYTHONPATH=$PWD sudo -n --preserve-env=ATTENDANCE_INLINE_SOURCE,PYTHONPATH /opt/energetica-whatsapp/.venv/bin/python -B ../test_inline.py -v
cd /home/opc/attendance-inline-20261102
python3 -B -m unittest discover -s . -p test_deploy.py -v
```

## Publicação concluída

Manifesto SHA256: `0f30087006563cc7050e213c8f3a4a17ba6f12486699439b21351999dc3328c7`. O deployer exige esse hash, trava global com `flock`, verifica os hashes de ambas as raízes, cria backups, instala cada candidato de forma atômica, reinicia somente a ponte e verifica os dois serviços e `/health`. Em falha, tenta restaurar ambas as fontes e reiniciar; preserva arquivos que terceiros alteraram e informa `rollback_incomplete` nesses casos.

```sh
cd /home/opc/attendance-inline-20261102
sudo -n /opt/energetica-whatsapp/.venv/bin/python -B deploy.py --check 0f30087006563cc7050e213c8f3a4a17ba6f12486699439b21351999dc3328c7
# Comando já executado após a revisão e autorização da integração:
sudo -n /opt/energetica-whatsapp/.venv/bin/python -B deploy.py --deploy 0f30087006563cc7050e213c8f3a4a17ba6f12486699439b21351999dc3328c7
```



