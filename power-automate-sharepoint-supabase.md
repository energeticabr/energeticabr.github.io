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

`TICKETS CLIENTES` guarda o cabecalho do ticket. Essa lista e a fonte oficial do estado do ticket. Use `Titulo` para o assunto e mantenha as colunas abaixo:

```text
TicketCodigo        texto, valor unico quando possivel
PortalTicketId      texto, UUID criado pelo portal em sharepoint_ticket_outbox.id
ClienteId           texto
ClienteNome         texto
ClienteEmail        texto
Status              escolha: Ativo, Inativo
UltimaAcaoPor       texto ou escolha: cliente, empresa, sistema
UltimaMensagem      varias linhas
SupabaseUpdatedAt   data e hora
```

O campo `Status` do cabecalho deve ser atualizado sempre que o portal enviar `acao = alterar_status`. Nao use o campo tecnico `status` da fila do Supabase para isso: na fila ele significa apenas `pendente`, `processando`, `sincronizado` ou `erro`. O status real do ticket vai em `payload.status` e deve alimentar a coluna `Status` do SharePoint.

`TICKET MOVIMENTACOES` guarda cada mensagem, resposta, mudanca de status e anexo. Use `Titulo` para um resumo e mantenha as colunas:

```text
TicketCodigo             texto
SharepointTicketItemId   texto, ID do item pai em TICKETS CLIENTES
ClienteEmail             texto
AutorTipo                escolha ou texto: cliente, empresa, sistema
AutorNome                texto
TipoEvento               texto
Mensagem                 varias linhas
StatusNovo               escolha ou texto: Ativo, Inativo, vazio quando nao for mudanca de status
ArquivoNome              texto
ArquivoPath              texto
ArquivoUrl               hiperlink ou texto
ArquivosJson             varias linhas
ProcessadoNoSupabaseEm   data e hora
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
    "portal_ticket_id": "@{triggerOutputs()?['body/PortalTicketId']}",
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

## Fluxo C: portal -> SharePoint em tempo real

Nao use fluxo agendado para este caminho. O desenho correto e em tempo real:

```text
Site -> sharepoint_ticket_outbox no Supabase -> Database Webhook do Supabase -> Power Automate HTTP -> SharePoint
```

No Power Automate, o gatilho deve ser:

```text
Request - When an HTTP request is received
```

Depois de salvar o fluxo, o Power Automate gera uma URL HTTP. Essa URL deve ser usada em um **Database Webhook** do Supabase apontado para a tabela `sharepoint_ticket_outbox`, evento `INSERT`.

Observacao importante: se o gatilho HTTP nao aparecer no Power Automate, ele pode estar bloqueado pela licenca/ambiente. A documentacao da Microsoft descreve esse gatilho como a forma de disparar fluxos por uma chamada HTTP, e a documentacao do Supabase descreve Database Webhooks como disparos em eventos `INSERT`, `UPDATE` e `DELETE`.

O corpo enviado pelo Database Webhook deve conter a linha criada na fila. Dentro do fluxo, leia `record` ou `body.record` conforme o formato exibido no teste do Power Automate.

1. O fluxo recebe o item de `sharepoint_ticket_outbox`.

```text
Trigger: When an HTTP request is received
Method recebido pelo Supabase Webhook: POST
```

Schema sugerido:

```json
{
  "type": "object",
  "properties": {
    "type": { "type": "string" },
    "table": { "type": "string" },
    "record": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "acao": { "type": "string" },
        "status": { "type": "string" },
        "cliente_id": { "type": ["string", "null"] },
        "cliente_nome": { "type": ["string", "null"] },
        "cliente_email": { "type": "string" },
        "ticket_codigo": { "type": ["string", "null"] },
        "sharepoint_ticket_item_id": { "type": ["string", "null"] },
        "titulo": { "type": ["string", "null"] },
        "mensagem": { "type": ["string", "null"] },
        "autor_tipo": { "type": "string" },
        "autor_nome": { "type": ["string", "null"] },
        "arquivo_nome": { "type": ["string", "null"] },
        "arquivo_signed_url": { "type": ["string", "null"] },
        "arquivos": { "type": "array" },
        "payload": { "type": "object" },
        "created_at": { "type": "string" }
      }
    }
  }
}
```

2. Condicoes dentro do fluxo:

- `acao = criar_ticket`: crie item em `TICKETS CLIENTES` com `Status = payload.status` ou `Ativo`; depois crie a primeira linha em `TICKET MOVIMENTACOES` com `TipoEvento = payload.tipo_evento` ou `ticket_criado`.
- `acao = responder_ticket`: crie item em `TICKET MOVIMENTACOES` com `TipoEvento = payload.tipo_evento` ou `mensagem`.
- `acao = alterar_status`: atualize o item pai em `TICKETS CLIENTES` usando `Status = payload.status` (`Ativo` ou `Inativo`) e crie linha de historico em `TICKET MOVIMENTACOES` com `StatusNovo = payload.status` e `TipoEvento = payload.tipo_evento` ou `ticket_finalizado`.
- Se houver `arquivos`, baixe cada `signedUrl` e adicione como anexo no item criado em `TICKET MOVIMENTACOES`.

Mapeamento recomendado para criar/atualizar o item pai em `TICKETS CLIENTES`:

```text
Titulo: @{triggerBody()?['record']?['titulo']}
TicketCodigo: @{triggerBody()?['record']?['ticket_codigo']}
PortalTicketId: @{triggerBody()?['record']?['id']}
ClienteId: @{triggerBody()?['record']?['cliente_id']}
ClienteNome: @{triggerBody()?['record']?['cliente_nome']}
ClienteEmail: @{triggerBody()?['record']?['cliente_email']}
Status: @{coalesce(triggerBody()?['record']?['payload']?['status'], 'Ativo')}
UltimaAcaoPor: @{triggerBody()?['record']?['autor_tipo']}
UltimaMensagem: @{triggerBody()?['record']?['mensagem']}
SupabaseUpdatedAt: @{utcNow()}
```

Mapeamento recomendado para `TICKET MOVIMENTACOES`:

```text
Titulo: @{triggerBody()?['record']?['titulo']}
TicketCodigo: @{triggerBody()?['record']?['ticket_codigo']}
SharepointTicketItemId: ID do item criado/atualizado em TICKETS CLIENTES
ClienteEmail: @{triggerBody()?['record']?['cliente_email']}
AutorTipo: @{triggerBody()?['record']?['autor_tipo']}
AutorNome: @{triggerBody()?['record']?['autor_nome']}
TipoEvento: @{coalesce(triggerBody()?['record']?['payload']?['tipo_evento'], 'mensagem')}
Mensagem: @{triggerBody()?['record']?['mensagem']}
StatusNovo: @{triggerBody()?['record']?['payload']?['status']}
ArquivoNome: @{triggerBody()?['record']?['arquivo_nome']}
ArquivoPath: @{triggerBody()?['record']?['arquivo_temp_path']}
ArquivoUrl: @{triggerBody()?['record']?['arquivo_signed_url']}
ArquivosJson: @{string(triggerBody()?['record']?['arquivos'])}
ProcessadoNoSupabaseEm: @{utcNow()}
```

3. Ao terminar o item recebido, chame:

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

## Comunicacoes da empresa no SharePoint

Listas a criar no mesmo site:

```text
COMUNICACOES CLIENTES
COMUNICACAO MOVIMENTACOES
```

`COMUNICACOES CLIENTES` guarda o cabecalho da comunicacao. Use `Titulo` para o assunto e as colunas:

```text
ComunicacaoCodigo
SupabaseComunicacaoId
ClienteId
ClienteNome
ClienteEmail
Assunto
Descricao
Status
DataSolicitacao
Horario
UltimaAcaoPor
UltimaMensagem
SupabaseUpdatedAt
```

`COMUNICACAO MOVIMENTACOES` guarda cada resposta, mensagem e anexo. Use `Titulo` para um resumo e as colunas:

```text
ComunicacaoCodigo
SupabaseComunicacaoId
SupabaseRespostaId
SharepointComunicacaoItemId
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

Arquivos devem ser anexados ao proprio item de `COMUNICACAO MOVIMENTACOES`, igual aos tickets.

Eventos de comunicacao:

```text
comunicacao_criada              -> empresa criou comunicacao para o cliente
resposta_cliente_comunicacao    -> cliente respondeu comunicacao
resposta_empresa_comunicacao    -> empresa respondeu comunicacao
comunicacao_finalizada          -> empresa finalizou/inativou comunicacao
erro_sincronizacao_comunicacao  -> erro na ponte
```

Regra de e-mail:

```text
comunicacao_criada, resposta_empresa_comunicacao, comunicacao_finalizada -> notificar cliente
resposta_cliente_comunicacao, erro_sincronizacao_comunicacao             -> notificar empresa
```

## Fluxo C2: comunicacoes portal -> SharePoint em tempo real

Crie outro fluxo com o mesmo gatilho:

```text
Request - When an HTTP request is received
```

No Supabase, crie um Database Webhook para a tabela `sharepoint_comunicacao_outbox`, evento `INSERT`, apontando para a URL gerada por esse fluxo.

Condicoes dentro do fluxo:

- `acao = criar_comunicacao`: crie item em `COMUNICACOES CLIENTES` e crie primeira linha em `COMUNICACAO MOVIMENTACOES` com `TipoEvento = comunicacao_criada`.
- `acao = responder_comunicacao`: crie item em `COMUNICACAO MOVIMENTACOES` com `TipoEvento = resposta_cliente_comunicacao` ou `resposta_empresa_comunicacao`.
- `acao = alterar_status`: atualize o item em `COMUNICACOES CLIENTES` e crie historico em `COMUNICACAO MOVIMENTACOES`.
- Se houver `arquivos`, baixe cada `signedUrl` e anexe no item criado em `COMUNICACAO MOVIMENTACOES`.

Ao terminar, marque a fila com:

```text
https://cnbkllzbymyhpkcfnvsm.supabase.co/rest/v1/rpc/sharepoint_mark_comunicacao_outbox
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

## Fluxo G: notificar edicao de mensagem de ticket

Objetivo: quando a coluna `Mensagem` de uma linha em `TICKET MOVIMENTACOES` for alterada, enviar e-mail para o administrador mostrando o texto anterior e o texto novo.

Gatilho:

```text
SharePoint - When an item is created or modified
Site Address: https://energeticaltda.sharepoint.com/sites/energetica
List Name: TICKET MOVIMENTACOES
```

Acao 1:

```text
SharePoint - Get changes for an item or a file (properties only)
Site Address: https://energeticaltda.sharepoint.com/sites/energetica
List Name: TICKET MOVIMENTACOES
Id: ID do item do gatilho
Since: Trigger Window Start Token
Until: Trigger Window End Token
```

Condicao:

```text
Has Column Changed: Mensagem is equal to true
AND Modified is not equal to Created
```

Essa condicao evita e-mail na criacao do item e dispara apenas quando a mensagem existente for editada.

Acao 2, dentro do bloco verdadeiro:

```text
SharePoint - Send an HTTP request to SharePoint
Site Address: https://energeticaltda.sharepoint.com/sites/energetica
Method: GET
Uri: _api/web/lists/getbytitle('TICKET MOVIMENTACOES')/items(@{triggerOutputs()?['body/ID']})/versions?$top=2&$select=VersionLabel,Mensagem,Modified,Editor/Title&$expand=Editor
```

Acao 3, para limpar HTML do texto original:

```text
Data Operations - Compose
Name: TextoOriginal
Inputs:
@{coalesce(body('Send_an_HTTP_request_to_SharePoint')?['value']?[1]?['Mensagem'], body('Send_an_HTTP_request_to_SharePoint')?['d']?['results']?[1]?['Mensagem'], '')}
```

Se o campo `Mensagem` estiver retornando HTML rico do SharePoint, adicione a acao `Content Conversion - Html to text` usando o resultado de `TextoOriginal`. Faca o mesmo para a mensagem atual:

```text
Data Operations - Compose
Name: TextoAlterado
Inputs:
@{triggerOutputs()?['body/Mensagem']}
```

Acao final:

```text
Office 365 Outlook - Send an email (V2)
To: bernardonotini@energeticabr.com
Subject: [Portal Energética] Mensagem alterada no ticket @{triggerOutputs()?['body/TicketCodigo']}
```

Corpo em HTML:

```html
<div style="font-family:Arial,sans-serif;color:#082f49">
  <h2 style="margin:0 0 8px">Mensagem de ticket alterada</h2>
  <p>Uma movimentacao do ticket foi editada no SharePoint.</p>

  <table style="border-collapse:collapse;width:100%;max-width:760px;margin:16px 0">
    <tr>
      <td style="border:1px solid #d9e6f2;padding:8px;font-weight:700;background:#eef6fb">Ticket</td>
      <td style="border:1px solid #d9e6f2;padding:8px">@{triggerOutputs()?['body/TicketCodigo']}</td>
    </tr>
    <tr>
      <td style="border:1px solid #d9e6f2;padding:8px;font-weight:700;background:#eef6fb">Cliente</td>
      <td style="border:1px solid #d9e6f2;padding:8px">@{triggerOutputs()?['body/ClienteEmail']}</td>
    </tr>
    <tr>
      <td style="border:1px solid #d9e6f2;padding:8px;font-weight:700;background:#eef6fb">Autor</td>
      <td style="border:1px solid #d9e6f2;padding:8px">@{triggerOutputs()?['body/AutorNome']}</td>
    </tr>
    <tr>
      <td style="border:1px solid #d9e6f2;padding:8px;font-weight:700;background:#eef6fb">Alterado em</td>
      <td style="border:1px solid #d9e6f2;padding:8px">@{triggerOutputs()?['body/Modified']}</td>
    </tr>
  </table>

  <h3 style="margin:18px 0 8px">Texto original</h3>
  <div style="border-left:4px solid #b45309;background:#fff7ed;padding:12px;white-space:pre-wrap">@{outputs('TextoOriginal')}</div>

  <h3 style="margin:18px 0 8px">Texto alterado</h3>
  <div style="border-left:4px solid #15803d;background:#f0fdf4;padding:12px;white-space:pre-wrap">@{outputs('TextoAlterado')}</div>
</div>
```

Se o Power Automate renomear automaticamente as acoes, ajuste os nomes nas expressoes. Exemplo: se `Send_an_HTTP_request_to_SharePoint` virar `Obter_versoes_do_item`, troque esse nome na expressao do `TextoOriginal`.

## Observacao

O site pode ficar com `ENERGETICA_SHAREPOINT_TICKETS.enabled = true` e `ENERGETICA_SHAREPOINT_COMUNICACOES.enabled = true` para registrar novas acoes na fila. Sem o gatilho HTTP/Webhook configurado, os itens ficam pendentes na fila do Supabase e nao chegam ao SharePoint automaticamente.
