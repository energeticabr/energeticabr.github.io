-- Bloqueia edicao direta de clientes pelo site/Supabase e deixa o SharePoint como fonte de verdade.
-- O Power Automate deve chamar a RPC sharepoint_upsert_cliente_cache quando a lista CADASTRO CLIENTE for criada/modificada.

alter table public.clientes
  add column if not exists sharepoint_item_id text,
  add column if not exists cpf text,
  add column if not exists rg text,
  add column if not exists filial text,
  add column if not exists corretor text,
  add column if not exists imovel_adquirido text,
  add column if not exists descricao_sharepoint text,
  add column if not exists data_venda date,
  add column if not exists data_assinatura date,
  add column if not exists sharepoint_status text,
  add column if not exists synced_from_sharepoint_at timestamptz;

create unique index if not exists clientes_sharepoint_item_id_key
on public.clientes (sharepoint_item_id)
where sharepoint_item_id is not null;

alter table public.clientes enable row level security;

drop policy if exists "Admin atualiza clientes" on public.clientes;
drop policy if exists "Admin remove clientes" on public.clientes;
drop policy if exists "clientes_update_authenticated" on public.clientes;
drop policy if exists "clientes_delete_authenticated" on public.clientes;

revoke update, delete on public.clientes from anon, authenticated;

create or replace function public.sharepoint_upsert_cliente_cache(
  p_token text,
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_token text := current_setting('app.sharepoint_bridge_token', true);
  item_id text := nullif(coalesce(p_record ->> 'sharepoint_item_id', p_record ->> 'ID', p_record ->> 'Id'), '');
  nome_cliente text := nullif(coalesce(p_record ->> 'nome', p_record ->> 'NOME', p_record ->> 'Title'), '');
  email_cliente text;
  imovel_cliente text := nullif(coalesce(p_record ->> 'imovel_adquirido', p_record ->> 'IM_x00d3_VELADQUIRIDO', p_record ->> 'IMOVEL'), '');
  status_cliente text := coalesce(nullif(p_record ->> 'status', ''), nullif(p_record ->> 'STATUS', ''), 'Ativo');
  venda_raw text := nullif(coalesce(p_record ->> 'data_venda', p_record ->> 'DATAVENDA'), '');
  assinatura_raw text := nullif(coalesce(p_record ->> 'data_assinatura', p_record ->> 'DATAASSINATURAPROPCOMEVEND'), '');
  existing_id uuid;
  saved_id uuid;
begin
  if expected_token is null or expected_token = '' then
    raise exception 'Token da ponte SharePoint nao configurado';
  end if;

  if p_token is distinct from expected_token then
    raise exception 'Token invalido';
  end if;

  if item_id is null then
    raise exception 'sharepoint_item_id e obrigatorio';
  end if;

  if nome_cliente is null then
    nome_cliente := concat('Cliente ', item_id);
  end if;

  email_cliente := lower(coalesce(
    nullif(p_record ->> 'email', ''),
    nullif(p_record ->> 'EMAIL', ''),
    concat('sharepoint-cliente-', item_id, '@sem-email.local')
  ));

  select id into existing_id
  from public.clientes
  where sharepoint_item_id = item_id
  limit 1;

  if existing_id is null then
    insert into public.clientes (
      sharepoint_item_id,
      nome,
      email,
      telefone,
      empreendimento,
      unidade,
      etapa,
      status,
      cpf,
      rg,
      filial,
      corretor,
      imovel_adquirido,
      descricao_sharepoint,
      data_venda,
      data_assinatura,
      sharepoint_status,
      synced_from_sharepoint_at
    )
    values (
      item_id,
      nome_cliente,
      email_cliente,
      nullif(coalesce(p_record ->> 'telefone', p_record ->> 'TELEFONE'), ''),
      imovel_cliente,
      imovel_cliente,
      status_cliente,
      status_cliente,
      nullif(coalesce(p_record ->> 'cpf', p_record ->> 'CPF'), ''),
      nullif(coalesce(p_record ->> 'rg', p_record ->> 'RG'), ''),
      nullif(coalesce(p_record ->> 'filial', p_record ->> 'FILIAL'), ''),
      nullif(coalesce(p_record ->> 'corretor', p_record ->> 'CORRETOR'), ''),
      imovel_cliente,
      nullif(coalesce(p_record ->> 'descricao', p_record ->> 'DESCRI_x00c7__x00c3_O'), ''),
      case when venda_raw is null then null else venda_raw::timestamptz::date end,
      case when assinatura_raw is null then null else assinatura_raw::timestamptz::date end,
      status_cliente,
      now()
    )
    returning id into saved_id;
  else
    update public.clientes
    set
      nome = nome_cliente,
      email = email_cliente,
      telefone = nullif(coalesce(p_record ->> 'telefone', p_record ->> 'TELEFONE'), ''),
      empreendimento = imovel_cliente,
      unidade = imovel_cliente,
      etapa = status_cliente,
      status = status_cliente,
      cpf = nullif(coalesce(p_record ->> 'cpf', p_record ->> 'CPF'), ''),
      rg = nullif(coalesce(p_record ->> 'rg', p_record ->> 'RG'), ''),
      filial = nullif(coalesce(p_record ->> 'filial', p_record ->> 'FILIAL'), ''),
      corretor = nullif(coalesce(p_record ->> 'corretor', p_record ->> 'CORRETOR'), ''),
      imovel_adquirido = imovel_cliente,
      descricao_sharepoint = nullif(coalesce(p_record ->> 'descricao', p_record ->> 'DESCRI_x00c7__x00c3_O'), ''),
      data_venda = case when venda_raw is null then null else venda_raw::timestamptz::date end,
      data_assinatura = case when assinatura_raw is null then null else assinatura_raw::timestamptz::date end,
      sharepoint_status = status_cliente,
      synced_from_sharepoint_at = now(),
      updated_at = now()
    where id = existing_id
    returning id into saved_id;
  end if;

  return jsonb_build_object('ok', true, 'id', saved_id, 'sharepoint_item_id', item_id);
end;
$$;

grant execute on function public.sharepoint_upsert_cliente_cache(text, jsonb) to anon, authenticated;
