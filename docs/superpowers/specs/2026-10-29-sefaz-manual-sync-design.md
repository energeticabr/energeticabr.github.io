# Busca fiscal manual e aviso persistente

O botão de sincronizar da galeria SEFAZ deve iniciar uma busca real nas três fontes (NF-e, CT-e e NFS-e nacional), continuar fora da tela/app e exibir um diálogo global ao terminar, inclusive após reabertura. O usuário autorizou implementação e publicação sem nova aprovação de desenho.

## Abordagem

Uma fila durável na VM, com proprietário autenticado, recebe ações fixas do portal. O Windows com A1 consome pedidos usando os coletores e os mesmos dados/locks existentes. A sessão global do app recupera pedidos pendentes e resultados não reconhecidos. Apenas clicar Entendi reconhece o resultado. Persistência local cobre perda de resposta ao POST; a fila do servidor cobre reinstância da sessão. Uma operação presa à galeria perderia o aviso ao fechar; somente armazenamento local não faria a busca continuar com o app fechado.

## Contrato compartilhado

- Portal autenticado: ações `sefaz_refresh` e `sefaz_refresh_status`, envelope `sefazRefresh`.
- Criar: `{action:'sefaz_refresh',requestId:<32 hex minúsculos>}`. Repetição idempotente; cliques da mesma identidade acompanham pedido ativo, sem nova coleta duplicada.
- Consultar: `{action:'sefaz_refresh_status',requestId}`. Recuperar: `{action:'sefaz_refresh_status',mode:'pending'}` => `{status:'pending',requests:[...]}`. Reconhecer: `{action:'sefaz_refresh_status',requestId,acknowledge:true}` => `{status:'acknowledged',requestId}`.
- Recibo: `requestId`, `status` (`queued|running|waiting|succeeded|partial|failed`), `startedUtc`, `completedUtc` quando terminal, `sources` objeto com exatamente `NFE`, `CTE`, `NFSE`.
- Cada fonte: `status` (`queued|running|waiting|succeeded|failed`), `documents` inteiro >=0 opcional (documentos processados, nunca rotular como novas notas), `code` opcional entre `COOLDOWN|WORKER_UNAVAILABLE|SYNC_FAILED|DELIVERY_PENDING|BUSY|INCOMPLETE`, `nextAllowedAt` ISO opcional.
- Sucesso somente com as três fontes concluídas e entregas confirmadas. Esperas SEFAZ continuam como waiting. Falha/resultado parcial produz aviso fiel, nunca sucesso fictício. Nenhum XML, segredo ou comando vem do cliente.
- A fila reutiliza `_portal_identity()` e sua autorização corporativa existente (Graph, membro, domínio e OID), sem criar uma lista restrita ao proprietário DDA. Cada usuário já autorizado pode solicitar e acompanha somente seus pedidos, isolados pelo OID. As permissões SharePoint de leitura da galeria continuam aplicadas às consultas do próprio usuário. Não alterar perfis nem reaproveitar/reimplantar o módulo DDA antigo do overlay.

## Execução

Preservar agendamento 09/15/20, NSUs, arquivos, deduplicação, regras PDF/WhatsApp e limites fiscais. Usar slot manual opaco para CT/NFS, sem tratar rodada programada antiga como nova busca. Usar worker NF-e com adaptador local de fila e aux desativado nessa chamada manual, mantendo locks e cooldown. Falha/reinício retoma por fonte, sem reconsultar fontes já confirmadas. O resultado é durável antes da confirmação ao cliente. O computador desligado deixa o pedido aguardando e deve ser informado com clareza.

O botão fica indisponível durante pedido ativo e informa progresso por fonte. A galeria recarrega ao terminar, preservando dados em erro de leitura. O diálogo pertence à sessão, aparece em qualquer tela, persiste enquanto não reconhecido e não atravessa troca de conta. Compatibilidade Android/iOS/web; sem alterar blocos protegidos de assinatura.
