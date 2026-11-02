# Acionamento sob demanda do Windows

O aplicativo continua usando os pedidos autenticados de DDA e de sincronização fiscal existentes. Este componente troca a descoberta periódica desses pedidos por avisos em uma conexão SSH persistente. Atende os clientes Android, iOS e Windows sem alterar seus binários ou contratos HTTP.

`demand_watch.py` roda no servidor como `energetica-whatsapp`, observa as substituições atômicas de `state.json` com inotify e emite apenas `dda` ou `fiscal`. Respeita leases e `nextAllowedAt`; reconectar redescobre pedidos pendentes. O heartbeat de disponibilidade é de 30 segundos e não executa consultas fiscais nem inicia tarefas sem trabalho. Avisos de trabalho ainda não assumido podem ser repetidos após 15 segundos.

`Start-DemandAgent.ps1` mantém uma única instância silenciosa no Windows. Recebe os avisos, permite somente as duas filas conhecidas e inicia as tarefas existentes pelo Agendador, sem shell ou comandos recebidos do servidor. IgnoreNew e as travas originais evitam execução concorrente. O agente reconecta após queda de rede e inicia ao login; o computador precisa estar ligado, conectado e com a sessão do usuário iniciada, como os trabalhadores anteriores.

Somente estas tarefas perdem o gatilho de minuto:

- `Energetica - DDA consultas pelo aplicativo` (usa `-Once` para sair após o pedido).
- `ENERGETICA-SEFAZ-Sincronizacao-Manual`.

Coletor automático, recuperação de histórico, reenvios, avisos e DDA programado preservam os agendamentos. O erro preexistente `GAP_FAILURE` da recuperação de histórico não é alterado por este componente.

## Validação e instalação

1. Executar `python -m unittest discover -s backend-patches/on-demand-workers -p 'test_*.py'` no Windows e no Linux. No Windows, o teste específico do inotify é pulado; deve passar no servidor Linux.
2. Executar `Test-DemandAgent.ps1`. Executar `Test-DemandIntegration.ps1` apontando `RemoteProbe` para a fixture `probe_stream.py` em um diretório temporário do servidor. A fixture usa filas isoladas, simula reconexão e aviso duplicado e deve produzir um único início de uma tarefa benigna com exit code 37. Não utiliza filas fiscais reais.
3. Instalar somente `demand_watch.py` em `/opt/energetica-whatsapp/worker/demand_watch.py`, arquivo root:root 0644. Não reiniciar nem alterar o portal.
4. Executar `Install-DemandAgent.ps1`. A instalação usa `%USERPROFILE%\.codex\local-tools\demand-agent`, fora da virtualização AppData do Codex. Faz backup das duas tarefas, valida o agente conectado, remove seus gatilhos periódicos e compara os XMLs dos cinco agendamentos automáticos. Uma falha de instalação restaura as duas tarefas anteriores.

O instalador registra `Energetica - Agente sob demanda` ao login e compila um iniciador gráfico sem console com o compilador .NET Framework já instalado no Windows. `status.json`, `agent.jsonl` e `deployment.json` ficam no diretório da instalação; não contêm credenciais nem documentos.

Para reverter, executar `Restore-DemandAgent.ps1 -BackupDirectory <backup registrado em deployment.json>`. Isso restaura o estado das duas tarefas anterior à migração e remove apenas a tarefa do agente. O arquivo do observador pode permanecer inativo no servidor.
