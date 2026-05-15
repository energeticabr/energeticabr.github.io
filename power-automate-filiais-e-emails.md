# Power Automate: filiais, tickets e e-mails

Este documento deixa o fluxo pronto para configurar sem editar dados existentes.

## E-mail de tickets e comunicacoes

Use a acao **Send an email (V2)** nos fluxos de tickets e comunicacoes.

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
2. No Power Automate, crie um fluxo com gatilho **When an item is created or modified** na lista **FILIAIS**.
3. Adicione uma acao **HTTP** com metodo `POST`.
4. URL:

```text
https://SEU-PROJETO.supabase.co/rest/v1/rpc/sharepoint_upsert_filial_cache
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

## Supabase para SharePoint

Por enquanto o site apenas permite vincular clientes a filiais cadastradas. Ele nao edita a lista de filiais, justamente para evitar alteracao acidental da base do SharePoint.

Quando o cliente for espelhado para SharePoint, inclua tambem os campos:

```text
filial
filial_id
sharepoint_filial_item_id
```

Assim, a vinculacao feita pelo administrador no site acompanha o cadastro do cliente nos dois lados.
