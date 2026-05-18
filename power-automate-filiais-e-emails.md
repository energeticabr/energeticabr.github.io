# Power Automate: filiais, tickets e e-mails

Este documento deixa o fluxo pronto para configurar sem editar dados existentes.

## E-mail de tickets e comunicacoes

Use a acao **Send an email (V2)** nos fluxos de tickets e comunicacoes.

## Regra anti-duplicidade SharePoint -> site

Para qualquer lista do SharePoint que alimente o site, a chave de sincronizacao deve ser sempre:

```text
sharepoint_item_id = @{triggerOutputs()?['body/ID']}
```

Esse valor e o ID interno fixo do item na lista. Quando o item e editado no SharePoint, esse ID permanece igual; por isso a Supabase faz **update** no registro existente. Se o fluxo usar `Identifier`, `UniqueId`, `GUID`, `Title`, nome, codigo visual ou outro campo variavel como chave, uma edicao pode virar um novo registro duplicado no site.

Assunto recomendado:

```text
@{coalesce(triggerBody()?['record']?['payload']?['email_subject'], triggerBody()?['record']?['titulo'], triggerBody()?['record']?['assunto'], concat('Atendimento (', coalesce(triggerBody()?['record']?['payload']?['email_index'], triggerBody()?['record']?['ticket_codigo'], triggerBody()?['record']?['comunicacao_codigo'], triggerBody()?['record']?['id']), ') do Cliente ', triggerBody()?['record']?['cliente_nome']))}
```

Se o gatilho for SharePoint em vez de webhook Supabase, use:

```text
@{coalesce(triggerOutputs()?['body/Title'], triggerOutputs()?['body/Assunto'], concat('Atendimento (', coalesce(triggerOutputs()?['body/TicketCodigo'], triggerOutputs()?['body/ComunicacaoCodigo'], triggerOutputs()?['body/ID']), ') do Cliente ', triggerOutputs()?['body/ClienteNome']))}
```

Marque **Is HTML** como **Yes** e use este corpo:

```html
<div style="margin:0;padding:24px;background:#f3f7fb;font-family:Arial,Helvetica,sans-serif;color:#12324a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #d9e5ef;border-radius:12px;overflow:hidden;">
    <tr>
      <td style="padding:22px 26px;background:#0f5f8f;color:#ffffff;">
        <div style="font-size:20px;font-weight:700;">Energetica</div>
        <div style="font-size:13px;opacity:.9;">Atendimento ao cliente</div>
      </td>
    </tr>
    <tr>
      <td style="padding:26px;">
        <h1 style="margin:0 0 14px;font-size:22px;line-height:1.25;color:#12324a;">@{coalesce(triggerBody()?['record']?['payload']?['email_subject'], triggerBody()?['record']?['titulo'])}</h1>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">Uma nova movimentacao foi registrada no atendimento.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0 8px;margin:0 0 18px;">
          <tr>
            <td style="width:140px;padding:10px 12px;background:#f4f8fb;border:1px solid #d9e5ef;border-radius:8px 0 0 8px;font-size:13px;color:#52677a;font-weight:700;">Indice</td>
            <td style="padding:10px 12px;background:#ffffff;border:1px solid #d9e5ef;border-left:0;border-radius:0 8px 8px 0;font-size:14px;color:#12324a;">@{coalesce(triggerBody()?['record']?['payload']?['email_index'], triggerBody()?['record']?['ticket_codigo'], triggerBody()?['record']?['comunicacao_codigo'], triggerBody()?['record']?['id'])}</td>
          </tr>
          <tr>
            <td style="width:140px;padding:10px 12px;background:#f4f8fb;border:1px solid #d9e5ef;border-radius:8px 0 0 8px;font-size:13px;color:#52677a;font-weight:700;">Enviado por</td>
            <td style="padding:10px 12px;background:#ffffff;border:1px solid #d9e5ef;border-left:0;border-radius:0 8px 8px 0;font-size:14px;color:#12324a;">@{coalesce(triggerBody()?['record']?['payload']?['email_sender_name'], triggerBody()?['record']?['autor_nome'], triggerBody()?['record']?['cliente_nome'])}</td>
          </tr>
          <tr>
            <td style="width:140px;padding:10px 12px;background:#f4f8fb;border:1px solid #d9e5ef;border-radius:8px 0 0 8px;font-size:13px;color:#52677a;font-weight:700;">Tema</td>
            <td style="padding:10px 12px;background:#ffffff;border:1px solid #d9e5ef;border-left:0;border-radius:0 8px 8px 0;font-size:14px;color:#12324a;">@{coalesce(triggerBody()?['record']?['payload']?['email_theme'], triggerBody()?['record']?['payload']?['tema'], triggerBody()?['record']?['assunto'], triggerBody()?['record']?['titulo'])}</td>
          </tr>
        </table>
        <div style="padding:16px 18px;border-left:4px solid #0f5f8f;background:#eef6fb;border-radius:8px;font-size:15px;line-height:1.6;white-space:pre-wrap;">
          @{coalesce(triggerBody()?['record']?['payload']?['email_message'], triggerBody()?['record']?['mensagem'], triggerBody()?['record']?['descricao'])}
        </div>
        <p style="margin:20px 0 0;font-size:14px;line-height:1.6;color:#52677a;">Acesse o portal da Energetica para acompanhar o historico completo e anexos.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 26px;background:#f8fbfd;color:#617487;font-size:12px;">
        Mensagem automatica da Energetica.
      </td>
    </tr>
  </table>
</div>
```

## FILIAIS: SharePoint para Supabase

1. Rode `site-src/supabase-filiais-sharepoint.sql` no Supabase.
2. Configure no Supabase o mesmo token que sera enviado pelo Power Automate:

```sql
alter database postgres set app.sharepoint_bridge_token = 'COLOQUE_UM_TOKEN_FORTE_AQUI';
```

3. No Power Automate, crie um fluxo com gatilho **When an item is created or modified** na lista **FILIAIS**.
4. Adicione uma acao **HTTP** com metodo `POST`.
5. URL:

```text
https://SEU-PROJETO.supabase.co/rest/v1/rpc/sharepoint_upsert_filial_cache
```

6. Headers:

```text
apikey: SUA_SUPABASE_ANON_KEY_OU_SERVICE_KEY
Authorization: Bearer SUA_SUPABASE_SERVICE_ROLE_KEY
Content-Type: application/json
```

7. Body:

```json
{
  "p_token": "O_MESMO_TOKEN_CONFIGURADO_NO_SUPABASE",
  "p_record": {
    "sharepoint_item_id": "@{triggerOutputs()?['body/ID']}",
    "Title": "@{triggerOutputs()?['body/Title']}",
    "nome": "@{triggerOutputs()?['body/Title']}",
    "un": "@{triggerOutputs()?['body/UN']}",
    "powerapps_id": "@{triggerOutputs()?['body/__PowerAppsId__']}",
    "codigo": "@{triggerOutputs()?['body/Codigo']}",
    "cidade": "@{triggerOutputs()?['body/Cidade']}",
    "estado": "@{triggerOutputs()?['body/Estado']}",
    "valor_visita": "@{triggerOutputs()?['body/VALORVISITA']}",
    "endereco": "@{triggerOutputs()?['body/Endereco']}",
    "telefone": "@{triggerOutputs()?['body/Telefone']}",
    "email": "@{triggerOutputs()?['body/Email']}",
    "status": "@{triggerOutputs()?['body/Status']}",
    "raw": "@{string(triggerOutputs()?['body'])}"
  }
}
```

Colunas vistas na lista atual:

```text
Titulo
UN
__PowerAppsId__
STATUS
VALORVISITA
CIDADE
```

As linhas visiveis foram registradas em `site-src/filiais-seed.json` apenas como seed de conferencia. Esse arquivo nao altera o SharePoint nem o Supabase.

Importante: o campo `sharepoint_item_id` deve sempre receber `@{triggerOutputs()?['body/ID']}`. Nao use `Identifier`, `UniqueId`, `GUID`, `Title` ou outro campo como chave; isso faz uma edicao do SharePoint ser entendida como novo cadastro no Supabase.

## CADASTRO CLIENTE: SharePoint para Supabase

1. Rode `site-src/supabase-clientes-sharepoint-lock.sql` no Supabase.
2. Use o mesmo token ja configurado em `app.sharepoint_bridge_token`.
3. No Power Automate, crie ou ajuste um fluxo com gatilho **When an item is created or modified** na lista **CADASTRO CLIENTE**.
4. Adicione uma acao **HTTP** com metodo `POST`.
5. URL:

```text
https://SEU-PROJETO.supabase.co/rest/v1/rpc/sharepoint_upsert_cliente_cache
```

6. Headers:

```text
apikey: SUA_SUPABASE_ANON_KEY_OU_SERVICE_KEY
Authorization: Bearer SUA_SUPABASE_SERVICE_ROLE_KEY
Content-Type: application/json
```

7. Body:

```json
{
  "p_token": "O_MESMO_TOKEN_CONFIGURADO_NO_SUPABASE",
  "p_record": {
    "sharepoint_item_id": "@{triggerOutputs()?['body/ID']}",
    "NOME": "@{triggerOutputs()?['body/NOME']}",
    "CPF": "@{triggerOutputs()?['body/CPF']}",
    "TELEFONE": "@{triggerOutputs()?['body/TELEFONE']}",
    "IM_x00d3_VELADQUIRIDO": "@{triggerOutputs()?['body/IM_x00d3_VELADQUIRIDO']}",
    "DESCRI_x00c7__x00c3_O": "@{triggerOutputs()?['body/DESCRI_x00c7__x00c3_O']}",
    "FILIAL": "@{triggerOutputs()?['body/FILIAL']}",
    "CORRETOR": "@{triggerOutputs()?['body/CORRETOR']}",
    "RG": "@{triggerOutputs()?['body/RG']}",
    "DATAVENDA": "@{triggerOutputs()?['body/DATAVENDA']}",
    "DATAASSINATURAPROPCOMEVEND": "@{triggerOutputs()?['body/DATAASSINATURAPROPCOMEVEND']}",
    "STATUS": "@{triggerOutputs()?['body/STATUS']}",
    "EMAIL": "@{triggerOutputs()?['body/EMAIL']}"
  }
}
```

O site fica bloqueado para edicao cadastral de clientes. Altere nome, status, filial, imovel/unidade, telefone e demais dados apenas no SharePoint; o fluxo replica para a Supabase.

O SQL tambem cria um bloqueio para impedir novo cadastro de cliente com e-mail ja existente. O e-mail e normalizado em minusculas antes de gravar.

Importante: em clientes, o SQL grava o ID do SharePoint tanto em `sharepoint_item_id` quanto em `sharepoint_cliente_item_id`, para evitar duplicidade entre cargas antigas e novas. O fluxo deve continuar enviando `sharepoint_item_id` com `@{triggerOutputs()?['body/ID']}`.

## IMOVEL CADASTRADO: SharePoint para Supabase

1. Rode `site-src/supabase-imoveis-sharepoint.sql` no Supabase.
2. No Power Automate, crie ou ajuste um fluxo com gatilho **When an item is created or modified** na lista **IMOVEL CADASTRADO**.
3. Adicione uma acao **HTTP** com metodo `POST`.
4. URL:

```text
https://SEU-PROJETO.supabase.co/rest/v1/rpc/sharepoint_upsert_imovel_cache
```

5. Headers:

```text
apikey: SUA_SUPABASE_ANON_KEY_OU_SERVICE_KEY
Authorization: Bearer SUA_SUPABASE_SERVICE_ROLE_KEY
Content-Type: application/json
```

6. Body:

```json
{
  "p_token": "O_MESMO_TOKEN_CONFIGURADO_NO_SUPABASE",
  "p_record": {
    "sharepoint_item_id": "@{triggerOutputs()?['body/ID']}",
    "FILIAL": "@{triggerOutputs()?['body/FILIAL']}",
    "IMOVEL": "@{triggerOutputs()?['body/IMOVEL']}",
    "STATUS": "@{triggerOutputs()?['body/STATUS']}",
    "IDPROV": "@{triggerOutputs()?['body/IDPROV']}",
    "STATUSVISUAL": "@{triggerOutputs()?['body/STATUSVISUAL']}",
    "raw": "@{string(triggerOutputs()?['body'])}"
  }
}
```

Os imoveis ficam apenas como espelho de consulta no site. Altere os dados no SharePoint; o fluxo replica para o Supabase. O valor `TODOS` da coluna `IMOVEL` nao aparece como opcao no cadastro de clientes.

Importante: o fluxo de imoveis tambem deve usar `@{triggerOutputs()?['body/ID']}` em `sharepoint_item_id`. Se o mesmo imovel ja existir de uma carga antiga sem ID do SharePoint, o SQL atualizado tenta reaproveitar o registro por `FILIAL + IMOVEL` antes de inserir.

## APONTAMENTOSCOMERCIAIS: SharePoint para Supabase

1. Rode `site-src/supabase-apontamentos-comerciais-sharepoint.sql` no Supabase.
2. No Power Automate, crie ou ajuste um fluxo com gatilho **When an item is created or modified** na lista **APONTAMENTOSCOMERCIAIS**.
3. Adicione uma acao **HTTP** com metodo `POST`.
4. URL:

```text
https://SEU-PROJETO.supabase.co/rest/v1/rpc/sharepoint_upsert_apontamento_comercial_cache
```

5. Headers:

```text
apikey: SUA_SUPABASE_ANON_KEY_OU_SERVICE_KEY
Authorization: Bearer SUA_SUPABASE_SERVICE_ROLE_KEY
Content-Type: application/json
```

6. Body:

```json
{
  "p_token": "O_MESMO_TOKEN_CONFIGURADO_NO_SUPABASE",
  "p_record": {
    "sharepoint_item_id": "@{triggerOutputs()?['body/ID']}",
    "FILIAL": "@{triggerOutputs()?['body/FILIAL']}",
    "IMOVEL": "@{triggerOutputs()?['body/IMOVEL']}",
    "IDCONTRATO": "@{triggerOutputs()?['body/IDCONTRATO']}",
    "COMPRADOR": "@{triggerOutputs()?['body/COMPRADOR']}",
    "RELACAOMARCO": "@{triggerOutputs()?['body/RELACAOMARCO']}",
    "TIPOMARCO": "@{triggerOutputs()?['body/TIPOMARCO']}",
    "DESCRICAO": "@{triggerOutputs()?['body/DESCRICAO']}",
    "DATAINICIO": "@{triggerOutputs()?['body/DATAINICIO']}",
    "DATAFIM": "@{triggerOutputs()?['body/DATAFIM']}",
    "DATAFATAL": "@{triggerOutputs()?['body/DATAFATAL']}",
    "STATUS": "@{triggerOutputs()?['body/STATUS']}",
    "NOME": "@{triggerOutputs()?['body/NOME']}",
    "raw": "@{string(triggerOutputs()?['body'])}"
  }
}
```

Os apontamentos comerciais ficam apenas como historico de consulta no imovel. Nao crie nem edite esses registros pelo site; altere sempre no SharePoint para o fluxo refletir a mudanca na Supabase.

Importante: o fluxo de apontamentos deve usar `@{triggerOutputs()?['body/ID']}` em `sharepoint_item_id`. O SQL atualizado atualiza o apontamento existente por esse ID e so insere quando for um item realmente novo.

## TICKETS e COMUNICACOES: SharePoint para Supabase

1. Rode `site-src/supabase-sharepoint-atendimento-cache.sql` no Supabase.
2. Use o mesmo token ja configurado em `app.sharepoint_bridge_token`.
3. Para as listas de tickets/comunicacoes e suas movimentacoes, use gatilho **When an item is created or modified**.
4. Cada fluxo deve chamar a RPC correspondente com metodo `POST`:

```text
Tickets:               /rest/v1/rpc/sharepoint_upsert_ticket_cache
Movimentacoes ticket:  /rest/v1/rpc/sharepoint_upsert_ticket_movimentacao_cache
Comunicacoes:          /rest/v1/rpc/sharepoint_upsert_comunicacao_cache
Movimentacoes comunic: /rest/v1/rpc/sharepoint_upsert_comunicacao_movimentacao_cache
```

5. Headers:

```text
apikey: SUA_SUPABASE_ANON_KEY_OU_SERVICE_KEY
Authorization: Bearer SUA_SUPABASE_SERVICE_ROLE_KEY
Content-Type: application/json
```

6. Body base obrigatorio em todos:

```json
{
  "p_token": "O_MESMO_TOKEN_CONFIGURADO_NO_SUPABASE",
  "p_record": {
    "sharepoint_item_id": "@{triggerOutputs()?['body/ID']}"
  }
}
```

Inclua tambem os campos usados no site, conforme a lista:

```text
Ticket: ticket_codigo, cliente_id, cliente_nome, cliente_email, titulo, status, ultima_acao_por, ultima_mensagem, Created, Modified.
Movimentacao de ticket: sharepoint_ticket_item_id, ticket_codigo, cliente_email, autor_tipo, autor_nome, tipo_evento, mensagem, status_novo, arquivo_nome, arquivo_path, arquivo_url, arquivos, Created.
Comunicacao: comunicacao_codigo, supabase_comunicacao_id, cliente_id, cliente_nome, cliente_email, assunto, descricao, status, data_solicitacao, horario, ultima_acao_por, ultima_mensagem, Created, Modified.
Movimentacao de comunicacao: sharepoint_comunicacao_item_id, comunicacao_codigo, cliente_email, autor_tipo, autor_nome, tipo_evento, mensagem, status_novo, arquivo_nome, arquivo_path, arquivo_url, arquivos, Created.
```

Importante: essas RPCs tambem usam `sharepoint_item_id` como chave unica. Edicoes no SharePoint atualizam o cache do site; somente itens com novo `body/ID` viram novos registros.

## Supabase para SharePoint

O site nao deve editar diretamente filiais, imoveis, apontamentos comerciais nem cadastro mestre de clientes. Esses dados devem nascer ou ser editados no SharePoint e depois replicados para a Supabase pelo Power Automate.

Quando o cliente for espelhado para SharePoint, inclua tambem os campos:

```text
filial
filial_id
sharepoint_filial_item_id
```

Assim, a vinculacao feita pelo administrador no site acompanha o cadastro do cliente nos dois lados.
