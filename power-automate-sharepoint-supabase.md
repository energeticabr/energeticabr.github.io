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

- `acao = criar_ticket`: crie item em `TICKETS CLIENTES` e crie a primeira linha em `TICKET MOVIMENTACOES`.
- `acao = responder_ticket`: crie item em `TICKET MOVIMENTACOES`.
- `acao = alterar_status`: atualize o item em `TICKETS CLIENTES` e crie linha de historico em `TICKET MOVIMENTACOES`.
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

## Observacao

O site so deve ficar com `ENERGETICA_SHAREPOINT_TICKETS.enabled = true` depois que os tres fluxos estiverem salvos e testados no Power Automate.
