# Busca fiscal pelo botão da galeria

O botão de sincronizar da galeria NOTAS FISCAIS SEFAZ solicita uma operação durável com NF-e, CT-e e NFS-e nacional. Não se limita a recarregar o SharePoint. O agendamento 09/15/20 permanece independente.

O portal autentica a identidade corporativa antes das ações fixas `sefaz_refresh` e `sefaz_refresh_status`. A fila `sefaz_sync.py` mantém propriedade por OID, idempotência, reservas e recibos não reconhecidos. Ações do cliente não aceitam CNPJ, endpoint, código executável, certificado ou valores fiscais. As permissões existentes de leitura da galeria e dos anexos continuam no SharePoint.

`ENERGETICA-SEFAZ-Sincronizacao-Manual` verifica pedidos a cada minuto no Windows, usando o runtime e a chave SSH já instalados. O A1 continua no Windows. Cada fonte usa seus arquivos, cursor e trava atuais. CT-e e NFS-e usam o slot `manual:<requestId>`; uma rodada programada anterior não satisfaz o pedido manual. NF-e só confirma sucesso após observar resposta nova 137/138 durante aquele pedido e concluir entrega/ACK; apenas reenviar uma outbox antiga não equivale a consultar novamente.

Resultados locais são persistidos antes do progresso remoto. Uma falha SSH após conclusão repete a confirmação sem consultar novamente. Espera fiscal e concorrência ficam pendentes com data de nova tentativa; não há reset de NSU nem contorno de consumo indevido. Solicitações sem conclusão após 24h geram resultado incompleto explícito. Contagens são de documentos processados, incluindo atualizações; não representam quantidade de notas novas.

O diálogo pertence à sessão global autenticada, e não à galeria. Navegar, minimizar ou fechar o app não reconhece a operação. Ao abrir novamente, o app recupera pedidos e resultados da conta no servidor. Somente Entendi reconhece o resultado; perda de conexão no reconhecimento é retomada sem descartar o recibo. Outra conta não lê nem reconhece o pedido.

## Implantação

1. Testar o módulo Python e o instalador `backend-patches/sefaz-manual-sync`; estagiar e executar `install.py --check`, depois `--deploy` com hashes revistos. Verificar a rota autenticada, além de `/health`.
2. Instalar 18 arquivos com `Install-UnifiedFiscalRuntime.ps1 -Mode Install` e evidência de preservação dos dados/configurações.
3. Executar `Install-ManualFiscalTask.ps1 -Mode Install`; confirmar tarefa habilitada e heartbeat remoto. A sessão do usuário Windows precisa estar ativa, com computador ligado e internet.
4. Publicar app web/Android interno/TestFlight. Conferir um pedido real, incluindo sair da tela/reabrir antes de reconhecer o pop-up.

## Testes offline

`ManualFiscalSync-Tests.ps1`, `ManualFiscalAdapters-Tests.ps1`, `ManualFiscalSlots-Tests.ps1`, `AuxiliaryFiscal-Tests.ps1` e `UnifiedWorker-Tests.ps1` não fazem consultas governamentais. Os testes dos adapters usam o worker real com coletor sintético ou estado de cooldown, cobrindo a diferença entre resposta nova e replay da outbox. Os testes de fila exercitam isolamento, aliases, timestamps e reservas; testes do app cobrem POST/ACK perdido, reabertura, navegação e larguras 320/390px.

Rollback: desabilitar somente `ENERGETICA-SEFAZ-Sincronizacao-Manual`, restaurar módulo/hook pelo backup da implantação e reverter a revisão do app. Preservar recibos, dados fiscais e tarefas diárias.
