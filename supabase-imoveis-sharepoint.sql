-- Espelho seguro da lista "IMOVEL CADASTRADO" do SharePoint.
-- O site apenas consulta estes dados. Alteracoes devem vir do SharePoint pelo Power Automate.

create extension if not exists "pgcrypto";

create table if not exists public.imoveis (
  id uuid primary key default gen_random_uuid(),
  sharepoint_item_id text unique not null,
  filial text not null,
  imovel text not null,
  status text default 'NAO VENDIDO',
  idprov text,
  status_visual text default 'ATIVO',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists imoveis_filial_idx on public.imoveis (filial);
create index if not exists imoveis_imovel_idx on public.imoveis (imovel);
create index if not exists imoveis_status_visual_idx on public.imoveis (status_visual);

alter table public.imoveis enable row level security;

drop policy if exists "imoveis_select_authenticated" on public.imoveis;
create policy "imoveis_select_authenticated"
on public.imoveis
for select
to authenticated
using (true);

drop policy if exists "imoveis_no_direct_insert" on public.imoveis;
drop policy if exists "imoveis_no_direct_update" on public.imoveis;
drop policy if exists "imoveis_no_direct_delete" on public.imoveis;

create or replace function public.set_imoveis_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_imoveis_updated_at on public.imoveis;
create trigger set_imoveis_updated_at
before update on public.imoveis
for each row
execute function public.set_imoveis_updated_at();

create or replace function public.sharepoint_upsert_imovel_cache(
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
  imovel_filial text := coalesce(nullif(p_record ->> 'filial', ''), nullif(p_record ->> 'FILIAL', ''), 'Sem filial');
  imovel_nome text := coalesce(nullif(p_record ->> 'imovel', ''), nullif(p_record ->> 'IMOVEL', ''), 'Sem imovel');
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

  select id into existing_id
  from public.imoveis
  where sharepoint_item_id = item_id
  limit 1;

  if existing_id is null then
    select id into existing_id
    from public.imoveis
    where lower(coalesce(filial, '')) = lower(imovel_filial)
      and lower(coalesce(imovel, '')) = lower(imovel_nome)
    limit 1;
  end if;

  if existing_id is null then
    insert into public.imoveis (
    sharepoint_item_id,
    filial,
    imovel,
    status,
    idprov,
    status_visual,
    raw
  )
  values (
    item_id,
    imovel_filial,
    imovel_nome,
    coalesce(nullif(p_record ->> 'status', ''), nullif(p_record ->> 'STATUS', ''), 'NAO VENDIDO'),
    nullif(coalesce(p_record ->> 'idprov', p_record ->> 'IDPROV'), ''),
    coalesce(nullif(p_record ->> 'status_visual', ''), nullif(p_record ->> 'STATUSVISUAL', ''), 'ATIVO'),
    p_record
  )
  returning id into saved_id;
  else
    update public.imoveis
    set
      sharepoint_item_id = item_id,
      filial = imovel_filial,
      imovel = imovel_nome,
      status = coalesce(nullif(p_record ->> 'status', ''), nullif(p_record ->> 'STATUS', ''), 'NAO VENDIDO'),
      idprov = nullif(coalesce(p_record ->> 'idprov', p_record ->> 'IDPROV'), ''),
      status_visual = coalesce(nullif(p_record ->> 'status_visual', ''), nullif(p_record ->> 'STATUSVISUAL', ''), 'ATIVO'),
      raw = p_record,
      updated_at = now()
    where id = existing_id
    returning id into saved_id;
  end if;

  return jsonb_build_object('ok', true, 'id', saved_id);
end;
$$;

revoke all on public.imoveis from anon;
grant select on public.imoveis to authenticated;
grant execute on function public.sharepoint_upsert_imovel_cache(text, jsonb) to anon, authenticated;
