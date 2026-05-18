-- Espelho seguro da lista "APONTAMENTOSCOMERCIAIS" do SharePoint.
-- O site apenas consulta estes dados. Criacao e alteracao devem vir do SharePoint pelo Power Automate.

create extension if not exists "pgcrypto";

create table if not exists public.apontamentos_comerciais (
  id uuid primary key default gen_random_uuid(),
  sharepoint_item_id text unique not null,
  titulo text,
  filial text not null,
  imovel text not null,
  idcontrato text,
  comprador text,
  relacao_marco text,
  tipo_marco text,
  descricao text,
  data_inicio timestamptz,
  data_fim timestamptz,
  data_fatal timestamptz,
  status text,
  nome text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists apontamentos_comerciais_filial_idx on public.apontamentos_comerciais (filial);
create index if not exists apontamentos_comerciais_imovel_idx on public.apontamentos_comerciais (imovel);
create index if not exists apontamentos_comerciais_status_idx on public.apontamentos_comerciais (status);
create index if not exists apontamentos_comerciais_data_inicio_idx on public.apontamentos_comerciais (data_inicio desc);

alter table public.apontamentos_comerciais enable row level security;

drop policy if exists "apontamentos_comerciais_select_authenticated" on public.apontamentos_comerciais;
create policy "apontamentos_comerciais_select_authenticated"
on public.apontamentos_comerciais
for select
to authenticated
using (true);

drop policy if exists "apontamentos_comerciais_no_direct_insert" on public.apontamentos_comerciais;
drop policy if exists "apontamentos_comerciais_no_direct_update" on public.apontamentos_comerciais;
drop policy if exists "apontamentos_comerciais_no_direct_delete" on public.apontamentos_comerciais;

create or replace function public.set_apontamentos_comerciais_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_apontamentos_comerciais_updated_at on public.apontamentos_comerciais;
create trigger set_apontamentos_comerciais_updated_at
before update on public.apontamentos_comerciais
for each row
execute function public.set_apontamentos_comerciais_updated_at();

create or replace function public.sharepoint_upsert_apontamento_comercial_cache(
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
  apontamento_filial text := coalesce(nullif(p_record ->> 'filial', ''), nullif(p_record ->> 'FILIAL', ''), 'Sem filial');
  apontamento_imovel text := coalesce(nullif(p_record ->> 'imovel', ''), nullif(p_record ->> 'IMOVEL', ''), 'Sem imovel');
  apontamento_tipo text := nullif(coalesce(p_record ->> 'tipo_marco', p_record ->> 'TIPOMARCO'), '');
  apontamento_inicio timestamptz := nullif(coalesce(p_record ->> 'data_inicio', p_record ->> 'DATAINICIO'), '')::timestamptz;
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
  from public.apontamentos_comerciais
  where sharepoint_item_id = item_id
  limit 1;

  if existing_id is null then
    select id into existing_id
    from public.apontamentos_comerciais
    where lower(coalesce(filial, '')) = lower(apontamento_filial)
      and lower(coalesce(imovel, '')) = lower(apontamento_imovel)
      and coalesce(tipo_marco, '') = coalesce(apontamento_tipo, '')
      and coalesce(data_inicio, '1900-01-01'::timestamptz) = coalesce(apontamento_inicio, '1900-01-01'::timestamptz)
    limit 1;
  end if;

  if existing_id is null then
    insert into public.apontamentos_comerciais (
    sharepoint_item_id,
    titulo,
    filial,
    imovel,
    idcontrato,
    comprador,
    relacao_marco,
    tipo_marco,
    descricao,
    data_inicio,
    data_fim,
    data_fatal,
    status,
    nome,
    raw
  )
  values (
    item_id,
    nullif(coalesce(p_record ->> 'titulo', p_record ->> 'Title'), ''),
    apontamento_filial,
    apontamento_imovel,
    nullif(coalesce(p_record ->> 'idcontrato', p_record ->> 'IDCONTRATO', p_record ->> 'id_contrato'), ''),
    nullif(coalesce(p_record ->> 'comprador', p_record ->> 'COMPRADOR'), ''),
    nullif(coalesce(p_record ->> 'relacao_marco', p_record ->> 'RELACAOMARCO'), ''),
    apontamento_tipo,
    nullif(coalesce(p_record ->> 'descricao', p_record ->> 'DESCRICAO'), ''),
    apontamento_inicio,
    nullif(coalesce(p_record ->> 'data_fim', p_record ->> 'DATAFIM'), '')::timestamptz,
    nullif(coalesce(p_record ->> 'data_fatal', p_record ->> 'DATAFATAL'), '')::timestamptz,
    nullif(coalesce(p_record ->> 'status', p_record ->> 'STATUS'), ''),
    nullif(coalesce(p_record ->> 'nome', p_record ->> 'NOME'), ''),
    p_record
  )
  returning id into saved_id;
  else
    update public.apontamentos_comerciais
    set
      sharepoint_item_id = item_id,
      titulo = nullif(coalesce(p_record ->> 'titulo', p_record ->> 'Title'), ''),
      filial = apontamento_filial,
      imovel = apontamento_imovel,
      idcontrato = nullif(coalesce(p_record ->> 'idcontrato', p_record ->> 'IDCONTRATO', p_record ->> 'id_contrato'), ''),
      comprador = nullif(coalesce(p_record ->> 'comprador', p_record ->> 'COMPRADOR'), ''),
      relacao_marco = nullif(coalesce(p_record ->> 'relacao_marco', p_record ->> 'RELACAOMARCO'), ''),
      tipo_marco = apontamento_tipo,
      descricao = nullif(coalesce(p_record ->> 'descricao', p_record ->> 'DESCRICAO'), ''),
      data_inicio = apontamento_inicio,
      data_fim = nullif(coalesce(p_record ->> 'data_fim', p_record ->> 'DATAFIM'), '')::timestamptz,
      data_fatal = nullif(coalesce(p_record ->> 'data_fatal', p_record ->> 'DATAFATAL'), '')::timestamptz,
      status = nullif(coalesce(p_record ->> 'status', p_record ->> 'STATUS'), ''),
      nome = nullif(coalesce(p_record ->> 'nome', p_record ->> 'NOME'), ''),
      raw = p_record,
      updated_at = now()
    where id = existing_id
    returning id into saved_id;
  end if;

  return jsonb_build_object('ok', true, 'id', saved_id);
end;
$$;

revoke all on public.apontamentos_comerciais from anon;
revoke all on public.apontamentos_comerciais from authenticated;
grant select on public.apontamentos_comerciais to authenticated;
grant execute on function public.sharepoint_upsert_apontamento_comercial_cache(text, jsonb) to anon, authenticated;
