# Ponte Power Automate: SharePoint tickets <-> Portal

Objetivo: manter o SharePoint como fonte oficial dos tickets e anexos, usando o Supabase apenas como cache temporario e fila de sincronizacao para o site.

## SharePoint

Site:

```text
https://energeticaltda.sharepoint.com/sites/energetica
```

Listas criadas:

```text
TICKETS CLIENTES
TICKET MOVIMENTACOES
```

`TICKETS CLIENTES` guarda o cabecalho do ticket. Use `Titulo` para o assunto e as colunas:

```text
TicketCodigo
SupabaseTicketId
ClienteId
ClienteNome
ClienteEmail
Status
UltimaAcaoPor
UltimaMensagem
SupabaseUpdatedAt
```

`TICKET MOVIMENTACOES` guarda cada mensagem, resposta, mudanca de status e anexo. Use `Titulo` para um resumo e as colunas:

```text
TicketCodigo
SupabaseTicketId
SupabaseMensagemId
SharepointTicketItemId
ClienteEmail
AutorTipo
AutorNome
TipoEvento
Mensagem
StatusNovo
ArquivoNome
ArquivoPath
ArquivoUrl
ArquivosJson
ProcessadoNoSupabaseEm
```

Arquivos devem ser adicionados como **anexo do proprio item** em `TICKET MOVIMENTACOES`. Assim a mensagem e o arquivo ficam na mesma linha do historico.

## Eventos de workflow

Use a coluna `TipoEvento` para indicar o que aconteceu. Esses valores tambem sao enviados pelo portal na fila `sharepoint_ticket_outbox.payload.tipo_evento`.

```text
ticket_criado          -> cliente abriu ticket pelo portal
ticket_criado_empresa  -> empresa abriu ticket para o cliente
resposta_cliente       -> cliente respondeu um ticket
resposta_empresa       -> empresa respondeu um ticket
ticket_finalizado      -> empresa finalizou/inativou o ticket
ticket_reativado       -> empresa reativou o ticket
documento_anexado      -> mensagem possui anexo/documento
erro_sincronizacao     -> Power Automate nao conseguiu concluir a acao
```

Regra de notificacao:

```text
ticket_criado, resposta_cliente        -> notificar empresa
ticket_criado_empresa, resposta_empresa, ticket_finalizado, ticket_reativado -> notificar cliente
erro_sincronizacao                      -> notificar empresa
```

Assunto sugerido do e-mail:

```text
[Energética] @{triggerOutputs()?['body/TipoEvento']} - Ticket @{triggerOutputs()?['body/TicketCodigo']}
```

Corpo sugerido:

```text
Ticket: @{triggerOutputs()?['body/TicketCodigo']}
Cliente: @{triggerOutputs()?['body/ClienteEmail']}
Evento: @{triggerOutputs()?['body/TipoEvento']}
Autor: @{triggerOutputs()?['body/AutorNome']}
Mensagem:
@{triggerOutputs()?['body/Mensagem']}

Acesse o portal:
https://energeticabr.com/cliente.html
```

## Fluxo A: SharePoint ticket -> portal

Gatilho:

```text
SharePoint - When an item is created or modified
Site Address: https://energeticaltda.sharepoint.com/sites/energetica
List Name: TICKETS CLIENTES
```

Acao HTTP:

```text
Method: POST
URI: https://cnbkllzbymyhpkcfnvsm.supabase.co/rest/v1/rpc/sharepoint_upsert_ticket_cache
```

Headers:

```json
{
  "apikey": "SUPABASE_ANON_KEY",
  "Authorization": "Bearer SUPABASE_ANON_KEY",
  "Content-Type": "application/json"
}
```

Body:

```json
{
  "p_token": "TOKEN_LIMITADO_DA_PONTE",
  "p_record": {
    "sharepoint_item_id": "@{triggerOutputs()?['body/ID']}",
    "ticket_codigo": "@{coalesce(triggerOutputs()?['body/TicketCodigo'], triggerOutputs()?['body/Title'])}",
    "cliente_id": "@{triggerOutputs()?['body/ClienteId']}",
    "cliente_nome": "@{triggerOutputs()?['body/ClienteNome']}",
    "cliente_email": "@{triggerOutputs()?['body/ClienteEmail']}",
    "titulo": "@{triggerOutputs()?['body/Title']}",
    "status": "@{coalesce(triggerOutputs()?['body/Status'], 'Ativo')}",
    "ultima_acao_por": "@{triggerOutputs()?['body/UltimaAcaoPor']}",
    "ultima_mensagem": "@{triggerOutputs()?['body/UltimaMensagem']}",
    "sharepoint_created_at": "@{triggerOutputs()?['body/Created']}",
    "sharepoint_updated_at": "@{triggerOutputs()?['body/Modified']}"
  }
}
```

## Fluxo B: SharePoint movimentacao -> portal

Gatilho:

```text
SharePoint - When an item is created or modified
Site Address: https://energeticaltda.sharepoint.com/sites/energetica
List Name: TICKET MOVIMENTACOES
```

Antes da chamada HTTP, use as acoes do SharePoint para obter os anexos do item. Monte `ArquivosJson` com nome e link dos anexos quando existir.

Acao HTTP:

```text
Method: POST
URI: https://cnbkllzbymyhpkcfnvsm.supabase.co/rest/v1/rpc/sharepoint_upsert_ticket_movimentacao_cache
```

Body:

```json
{
  "p_token": "TOKEN_LIMITADO_DA_PONTE",
  "p_record": {
    "sharepoint_item_id": "@{triggerOutputs()?['body/ID']}",
    "sharepoint_ticket_item_id": "@{triggerOutputs()?['body/SharepointTicketItemId']}",
    "ticket_codigo": "@{triggerOutputs()?['body/TicketCodigo']}",
    "cliente_email": "@{triggerOutputs()?['body/ClienteEmail']}",
    "autor_tipo": "@{triggerOutputs()?['body/AutorTipo']}",
    "autor_nome": "@{triggerOutputs()?['body/AutorNome']}",
    "tipo_evento": "@{coalesce(triggerOutputs()?['body/TipoEvento'], 'mensagem')}",
    "mensagem": "@{triggerOutputs()?['body/Mensagem']}",
    "status_novo": "@{triggerOutputs()?['body/StatusNovo']}",
    "arquivo_nome": "@{triggerOutputs()?['body/ArquivoNome']}",
    "arquivo_path": "@{triggerOutputs()?['body/ArquivoPath']}",
    "arquivo_url": "@{triggerOutputs()?['body/ArquivoUrl']}",
    "arquivos": "@{if(empty(triggerOutputs()?['body/ArquivosJson']), json('[]'), json(triggerOutputs()?['body/ArquivosJson']))}",
    "sharepoint_created_at": "@{triggerOutputs()?['body/Created']}"
  }
}
```

## Fluxo C: portal -> SharePoint

Use um fluxo agendado a cada 1 minuto.

1. HTTP `POST` para:

```text
https://cnbkllzbymyhpkcfnvsm.supabase.co/rest/v1/rpc/sharepoint_list_pending_outbox
```

Body:

```json
{
  "p_token": "TOKEN_LIMITADO_DA_PONTE",
  "p_limit": 20
}
```

2. Para cada registro retornado:

- `acao = criar_ticket`: crie item em `TICKETS CLIENTES` e crie a primeira linha em `TICKET MOVIMENTACOES` com `TipoEvento = payload.tipo_evento` ou `ticket_criado`.
- `acao = responder_ticket`: crie item em `TICKET MOVIMENTACOES` com `TipoEvento = payload.tipo_evento` ou `mensagem`.
- `acao = alterar_status`: atualize o item em `TICKETS CLIENTES` e crie linha de historico em `TICKET MOVIMENTACOES` com `TipoEvento = payload.tipo_evento` ou `ticket_finalizado`.
- Se houver `arquivos`, baixe cada `signedUrl` e adicione como anexo no item criado em `TICKET MOVIMENTACOES`.

3. Ao terminar cada item, chame:

```text
https://cnbkllzbymyhpkcfnvsm.supabase.co/rest/v1/rpc/sharepoint_mark_outbox
```

Body de sucesso:

```json
{
  "p_token": "TOKEN_LIMITADO_DA_PONTE",
  "p_id": "ID_DA_FILA",
  "p_status": "sincronizado",
  "p_erro": null
}
```

Body de erro:

```json
{
  "p_token": "TOKEN_LIMITADO_DA_PONTE",
  "p_id": "ID_DA_FILA",
  "p_status": "erro",
  "p_erro": "mensagem do erro"
}
```

## Fluxo D: notificar empresa

Gatilho:

```text
SharePoint - When an item is created or modified
Site Address: https://energeticaltda.sharepoint.com/sites/energetica
List Name: TICKET MOVIMENTACOES
```

Condicao:

```text
TipoEvento is equal to ticket_criado
OR TipoEvento is equal to resposta_cliente
OR TipoEvento is equal to erro_sincronizacao
```

Acao:

```text
Office 365 Outlook - Send an email (V2)
To: bernardonotini@energeticabr.com
Subject: [Portal Energética] Novo andamento no ticket @{triggerOutputs()?['body/TicketCodigo']}
```

Corpo:

```text
Foi registrado um andamento que exige atenção da empresa.

Ticket: @{triggerOutputs()?['body/TicketCodigo']}
Cliente: @{triggerOutputs()?['body/ClienteEmail']}
Evento: @{triggerOutputs()?['body/TipoEvento']}
Autor: @{triggerOutputs()?['body/AutorNome']}

Mensagem:
@{triggerOutputs()?['body/Mensagem']}
```

## Fluxo E: notificar cliente

Gatilho:

```text
SharePoint - When an item is created or modified
Site Address: https://energeticaltda.sharepoint.com/sites/energetica
List Name: TICKET MOVIMENTACOES
```

Condicao:

```text
TipoEvento is equal to ticket_criado_empresa
OR TipoEvento is equal to resposta_empresa
OR TipoEvento is equal to ticket_finalizado
OR TipoEvento is equal to ticket_reativado
```

Acao:

```text
Office 365 Outlook - Send an email (V2)
To: @{triggerOutputs()?['body/ClienteEmail']}
Subject: [Energética] Atualização no ticket @{triggerOutputs()?['body/TicketCodigo']}
```

Corpo:

```text
Olá,

A Energética registrou uma atualização no seu atendimento.

Ticket: @{triggerOutputs()?['body/TicketCodigo']}
Evento: @{triggerOutputs()?['body/TipoEvento']}
Mensagem:
@{triggerOutputs()?['body/Mensagem']}

Acesse sua área do cliente:
https://energeticabr.com/cliente.html
```

## Fluxo F: registrar log operacional

Opcionalmente, crie uma terceira lista chamada `TICKET WORKFLOW LOG` com as colunas:

```text
TicketCodigo
TipoEvento
Destino
Resultado
MensagemErro
ExecutadoEm
```

Ao final dos fluxos D e E, crie um item nessa lista com `Resultado = Enviado`. Se o e-mail falhar, use uma acao configurada com **run after has failed** e registre `Resultado = Erro`.

## Observacao

O site so deve ficar com `ENERGETICA_SHAREPOINT_TICKETS.enabled = true` depois que os tres fluxos estiverem salvos e testados no Power Automate.
