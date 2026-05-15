-- Preparacao segura para sincronizar a lista FILIAIS do SharePoint com o site.
-- Este script cria estrutura nova e adiciona campos em clientes; nao altera linhas existentes.

create extension if not exists "pgcrypto";

create table if not exists public.filiais (
  id uuid primary key default gen_random_uuid(),
  sharepoint_item_id text unique,
  powerapps_id text,
  un text,
  codigo text,
  nome text not null,
  cidade text,
  estado text,
  valor_visita numeric,
  endereco text,
  telefone text,
  email text,
  status text default 'Ativo',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clientes
  add column if not exists filial text,
  add column if not exists filial_id uuid references public.filiais(id),
  add column if not exists sharepoint_filial_item_id text;

create index if not exists filiais_nome_idx on public.filiais (nome);
create index if not exists clientes_filial_idx on public.clientes (filial);
create index if not exists clientes_sharepoint_filial_item_id_idx on public.clientes (sharepoint_filial_item_id);

alter table public.filiais enable row level security;

drop policy if exists "filiais_select_authenticated" on public.filiais;
create policy "filiais_select_authenticated"
on public.filiais
for select
to authenticated
using (true);

drop policy if exists "filiais_admin_all" on public.filiais;
drop policy if exists "filiais_insert_authenticated" on public.filiais;
drop policy if exists "filiais_update_authenticated" on public.filiais;
drop policy if exists "filiais_delete_authenticated" on public.filiais;

revoke insert, update, delete on public.filiais from anon, authenticated;
grant select on public.filiais to authenticated;

create or replace function public.set_filiais_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_filiais_updated_at on public.filiais;
create trigger set_filiais_updated_at
before update on public.filiais
for each row
execute function public.set_filiais_updated_at();

-- RPC para o Power Automate gravar o espelho da lista FILIAIS no Supabase.
-- Configure o segredo no Supabase como app setting/secret e envie em p_token.
create or replace function public.sharepoint_upsert_filial_cache(
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
  item_id text := nullif(p_record ->> 'sharepoint_item_id', '');
  filial_nome text := nullif(coalesce(p_record ->> 'nome', p_record ->> 'Title', p_record ->> 'title'), '');
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

  if filial_nome is null then
    filial_nome := concat('Filial ', item_id);
  end if;

  insert into public.filiais (
    sharepoint_item_id,
    codigo,
    powerapps_id,
    un,
    nome,
    cidade,
    estado,
    valor_visita,
    endereco,
    telefone,
    email,
    status,
    raw
  )
  values (
    item_id,
    nullif(p_record ->> 'codigo', ''),
    nullif(coalesce(p_record ->> 'powerapps_id', p_record ->> '__PowerAppsId__'), ''),
    nullif(p_record ->> 'un', ''),
    filial_nome,
    nullif(p_record ->> 'cidade', ''),
    nullif(p_record ->> 'estado', ''),
    case
      when nullif(regexp_replace(coalesce(p_record ->> 'valor_visita', ''), '[^0-9,.-]', '', 'g'), '') is null then null
      else replace(regexp_replace(coalesce(p_record ->> 'valor_visita', ''), '[^0-9,.-]', '', 'g'), ',', '.')::numeric
    end,
    nullif(p_record ->> 'endereco', ''),
    nullif(p_record ->> 'telefone', ''),
    nullif(p_record ->> 'email', ''),
    coalesce(nullif(p_record ->> 'status', ''), 'Ativo'),
    p_record
  )
  on conflict (sharepoint_item_id) do update set
    codigo = excluded.codigo,
    powerapps_id = excluded.powerapps_id,
    un = excluded.un,
    nome = excluded.nome,
    cidade = excluded.cidade,
    estado = excluded.estado,
    valor_visita = excluded.valor_visita,
    endereco = excluded.endereco,
    telefone = excluded.telefone,
    email = excluded.email,
    status = excluded.status,
    raw = excluded.raw,
    updated_at = now()
  returning id into saved_id;

  return jsonb_build_object('ok', true, 'id', saved_id);
end;
$$;

grant execute on function public.sharepoint_upsert_filial_cache(text, jsonb) to anon, authenticated;
