# Fluxo Power Automate: SharePoint CADASTRO CLIENTE -> Supabase

Este fluxo sincroniza a lista **CADASTRO CLIENTE** do SharePoint com a tabela `public.clientes` no Supabase.

## Antes de criar o fluxo

No Supabase, copie a chave **service_role** em:

`Project Settings > API > Project API keys > service_role`

Use essa chave somente no Power Automate. Nao coloque essa chave no site.

Endpoint Supabase:

```text
https://cnbkllzbymyhpkcfnvsm.supabase.co/rest/v1/clientes?on_conflict=sharepoint_item_id
```

## Fluxo 1: SharePoint para Supabase

1. Acesse Power Automate.
2. Crie um fluxo automatizado.
3. Nome: `Sincronizar CADASTRO CLIENTE com Supabase`.
4. Gatilho: **SharePoint - When an item is created or modified**.
5. Configure:
   - Site Address: seu OneDrive/SharePoint onde está a lista.
   - List Name: `CADASTRO CLIENTE`.

## Ação HTTP

Adicione uma ação **HTTP**.

Method:

```text
POST
```

URI:

```text
https://cnbkllzbymyhpkcfnvsm.supabase.co/rest/v1/clientes?on_conflict=sharepoint_item_id
```

Headers:

```json
{
  "apikey": "COLE_A_SERVICE_ROLE_KEY_AQUI",
  "Authorization": "Bearer COLE_A_SERVICE_ROLE_KEY_AQUI",
  "Content-Type": "application/json",
  "Prefer": "resolution=merge-duplicates,return=minimal"
}
```

Body:

```json
{
  "sharepoint_item_id": "@{triggerOutputs()?['body/ID']}",
  "nome": "@{triggerOutputs()?['body/NOME']}",
  "cpf": "@{triggerOutputs()?['body/CPF']}",
  "telefone": "@{triggerOutputs()?['body/TELEFONE']}",
  "imovel_adquirido": "@{triggerOutputs()?['body/IMOVEL_x0020_ADQUIRIDO']}",
  "empreendimento": "@{triggerOutputs()?['body/IMOVEL_x0020_ADQUIRIDO']}",
  "descricao_sharepoint": "@{triggerOutputs()?['body/DESCRICAO']}",
  "filial": "@{triggerOutputs()?['body/FILIAL']}",
  "corretor": "@{triggerOutputs()?['body/CORRETOR']}",
  "rg": "@{triggerOutputs()?['body/RG']}",
  "data_venda": "@{triggerOutputs()?['body/DATA_x0020_VENDA']}",
  "data_assinatura": "@{triggerOutputs()?['body/DATA_x0020_ASSINATURA']}",
  "sharepoint_status": "@{triggerOutputs()?['body/STATUS']}",
  "status": "@{if(equals(triggerOutputs()?['body/STATUS'], 'ATIVO'), 'Aprovado', 'Pendente')}",
  "etapa": "Cadastro",
  "synced_from_sharepoint_at": "@{utcNow()}"
}
```

## Observacao importante sobre nomes internos

O SharePoint pode usar nomes internos diferentes dos nomes exibidos na tela. Se algum campo vier vazio, abra uma execucao do fluxo, entre no gatilho e veja o JSON de saida em **Outputs**.

Campos que talvez precisem ajuste:

- `IMOVEL_x0020_ADQUIRIDO`
- `DESCRICAO`
- `DATA_x0020_VENDA`
- `DATA_x0020_ASSINATURA`

## Fluxo 2: Supabase para SharePoint

Para o sentido inverso, recomenda-se sincronizar apenas eventos do portal, nao todos os dados cadastrais.

Exemplos:

- ticket aberto;
- resposta enviada;
- documento anexado;
- cliente solicitou cadastro.

O caminho recomendado:

1. Criar uma lista SharePoint chamada `PORTAL CLIENTE EVENTOS`.
2. Criar uma Supabase Edge Function ou webhook.
3. Quando houver evento no Supabase, enviar para o Power Automate.
4. Power Automate cria item em `PORTAL CLIENTE EVENTOS`.

Assim o SharePoint continua dono dos dados cadastrais e o Supabase continua dono do portal.
