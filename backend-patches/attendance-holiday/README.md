# Atalho FERIADO na validação de presenças

Adiciona `🗓️ FERIADO` imediatamente abaixo de AUSENTE na revisão de uma presença, no menu de seleção em lote e na escolha de presença após editar o lote.

O atalho reutiliza a regra já existente: `PRESENCA=AUSENTE` e `MOTIVACAO=FERIADO`. Não cria uma situação de pagamento nem muda a política de cálculo existente. O motivo é preenchido sem nova pergunta; a confirmação continua obrigatória. O lote mostra o motivo em cada linha antes de submeter. Não há escrita no SharePoint em testes: o motor real usa os serviços externos em memória.

Menus novos têm FERIADO como opção 4 e SOLICITAR EXCLUSÃO como 5. Menus salvos antes da alteração mantêm a opção 4 original. A configuração de cada raiz não é modificada: o motor copia apenas as opções do menu novo antes de inserir o atalho.

Os dois menus de presença em lote usam o transporte de lista, sem o limite de três botões do adaptador Meta. Os IDs de resposta da lista e os IDs brutos de menus antigos continuam roteáveis. O teste do adaptador real intercepta apenas o envio HTTP, sem acesso externo.

## Verificação

O script `test_holiday.py` requer `ATTENDANCE_HOLIDAY_SOURCE` apontando para um sandbox com o `worker` vigente e `tests/test_workflow.py` (fixtures em memória). Executar usando o ambiente Python já provisionado do servidor, não as conexões SharePoint reais.

`fixture-menu.patch` atualiza somente a expectativa do menu no teste legado (FERIADO como 4 e exclusão como 5) e três leituras do prompt dos menus em lote, agora enviados como lista em vez de botões. Não remove nem ignora testes. Aplicar no sandbox candidato, nunca no baseline.

```sh
ATTENDANCE_HOLIDAY_SOURCE=/home/opc/attendance-holiday-20261013/candidate /opt/energetica-whatsapp/.venv/bin/python -B test_holiday.py -v
```

`test_deploy.py` reaproveita os testes de drift, manifesto, candidato, modo check, backup e recuperação do deployer compartilhado, com arquivos temporários locais e sem reiniciar serviços reais.

Verificação de 13/10/2026 (UTC): 12 testes específicos e 8 testes de publicação passaram. A suíte legada completa executou 570 testes em cada versão; baseline e candidato final têm as mesmas 146 falhas, 29 erros e 1 skip, com lista de falhas/erros idêntica. Essas falhas preexistentes não foram corrigidas nem ocultadas nesta alteração. O patch de fixture altera só quatro expectativas de menu/transporte. Revisão independente aprovou a correção do transporte Meta.

## Publicação

Somente `worker/workflow.py` é instalado em `/opt/energetica-whatsapp` e `/home/opc/energetica-build`. O manifesto fixa os hashes antes/depois. O wrapper exige também o hash do deployer compartilhado, que faz CAS, trava, backup, instalação atômica, reinício e health check com rollback em caso de erro.

No estágio `/home/opc/attendance-holiday-20261013`, colocar `deploy.py`, `deploy-manifest.json`, o deployer compartilhado como `shared_deploy_runner.py` e o arquivo revisado em `candidate/worker/workflow.py`. Comparar os hashes locais/remotos e executar `--check HASH_DO_MANIFESTO`, depois `--deploy HASH_DO_MANIFESTO` somente após testes/revisão.

Por ser uma mudança no servidor compartilhado, os clientes Android, iOS e Windows/PWA existentes recebem a opção. Não há mudança de binário ou de código mobile.
