-- Espelho seguro dos atendimentos do SharePoint usados pelo portal.
-- Regra principal: sharepoint_item_id recebe sempre triggerOutputs()?['body/ID'].
-- Assim, uma edicao no SharePoint atualiza o registro existente no site em vez de criar duplicidade.

create extension if not exists "pgcrypto";

create table if not exists public.sharepoint_ticket_cache (
  id uuid primary key default gen_random_uuid(),
  sharepoint_item_id text unique not null,
  ticket_codigo text,
  cliente_id uuid,
  cliente_nome text,
  cliente_email text,
  titulo text,
  status text,
  ultima_acao_por text,
  ultima_mensagem text,
  sharepoint_created_at timestamptz,
  sharepoint_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb
);

create unique index if not exists sharepoint_ticket_cache_codigo_key
on public.sharepoint_ticket_cache (ticket_codigo)
where ticket_codigo is not null;

create index if not exists sharepoint_ticket_cache_cliente_email_idx
on public.sharepoint_ticket_cache (cliente_email);

create table if not exists public.sharepoint_ticket_movimentacoes_cache (
  id uuid primary key default gen_random_uuid(),
  sharepoint_item_id text unique not null,
  sharepoint_ticket_item_id text,
  ticket_codigo text,
  cliente_email text,
  autor_tipo text,
  autor_nome text,
  tipo_evento text,
  mensagem text,
  status_novo text,
  arquivo_nome text,
  arquivo_path text,
  arquivo_url text,
  arquivos jsonb,
  sharepoint_created_at timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb
);

create index if not exists sharepoint_ticket_mov_ticket_idx
on public.sharepoint_ticket_movimentacoes_cache (ticket_codigo, sharepoint_ticket_item_id);

create index if not exists sharepoint_ticket_mov_cliente_email_idx
on public.sharepoint_ticket_movimentacoes_cache (cliente_email);

create table if not exists public.sharepoint_comunicacao_cache (
  id uuid primary key default gen_random_uuid(),
  sharepoint_item_id text unique not null,
  comunicacao_codigo text,
  supabase_comunicacao_id uuid,
  cliente_id uuid,
  cliente_nome text,
  cliente_email text,
  assunto text,
  descricao text,
  status text,
  data_solicitacao date,
  horario text,
  ultima_acao_por text,
  ultima_mensagem text,
  sharepoint_created_at timestamptz,
  sharepoint_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb
);

create unique index if not exists sharepoint_comunicacao_cache_codigo_key
on public.sharepoint_comunicacao_cache (comunicacao_codigo)
where comunicacao_codigo is not null;

create index if not exists sharepoint_comunicacao_cache_cliente_email_idx
on public.sharepoint_comunicacao_cache (cliente_email);

create table if not exists public.sharepoint_comunicacao_movimentacoes_cache (
  id uuid primary key default gen_random_uuid(),
  sharepoint_item_id text unique not null,
  sharepoint_comunicacao_item_id text,
  comunicacao_codigo text,
  cliente_email text,
  autor_tipo text,
  autor_nome text,
  tipo_evento text,
  mensagem text,
  status_novo text,
  arquivo_nome text,
  arquivo_path text,
  arquivo_url text,
  arquivos jsonb,
  sharepoint_created_at timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb
);

create index if not exists sharepoint_comunicacao_mov_comunicacao_idx
on public.sharepoint_comunicacao_movimentacoes_cache (comunicacao_codigo, sharepoint_comunicacao_item_id);

create index if not exists sharepoint_comunicacao_mov_cliente_email_idx
on public.sharepoint_comunicacao_movimentacoes_cache (cliente_email);

alter table public.sharepoint_ticket_cache enable row level security;
alter table public.sharepoint_ticket_movimentacoes_cache enable row level security;
alter table public.sharepoint_comunicacao_cache enable row level security;
alter table public.sharepoint_comunicacao_movimentacoes_cache enable row level security;

drop policy if exists "sharepoint_ticket_cache_select_authenticated" on public.sharepoint_ticket_cache;
create policy "sharepoint_ticket_cache_select_authenticated"
on public.sharepoint_ticket_cache for select to authenticated using (true);

drop policy if exists "sharepoint_ticket_mov_select_authenticated" on public.sharepoint_ticket_movimentacoes_cache;
create policy "sharepoint_ticket_mov_select_authenticated"
on public.sharepoint_ticket_movimentacoes_cache for select to authenticated using (true);

drop policy if exists "sharepoint_comunicacao_cache_select_authenticated" on public.sharepoint_comunicacao_cache;
create policy "sharepoint_comunicacao_cache_select_authenticated"
on public.sharepoint_comunicacao_cache for select to authenticated using (true);

drop policy if exists "sharepoint_comunicacao_mov_select_authenticated" on public.sharepoint_comunicacao_movimentacoes_cache;
create policy "sharepoint_comunicacao_mov_select_authenticated"
on public.sharepoint_comunicacao_movimentacoes_cache for select to authenticated using (true);

revoke insert, update, delete on public.sharepoint_ticket_cache from anon, authenticated;
revoke insert, update, delete on public.sharepoint_ticket_movimentacoes_cache from anon, authenticated;
revoke insert, update, delete on public.sharepoint_comunicacao_cache from anon, authenticated;
revoke insert, update, delete on public.sharepoint_comunicacao_movimentacoes_cache from anon, authenticated;

grant select on public.sharepoint_ticket_cache to authenticated;
grant select on public.sharepoint_ticket_movimentacoes_cache to authenticated;
grant select on public.sharepoint_comunicacao_cache to authenticated;
grant select on public.sharepoint_comunicacao_movimentacoes_cache to authenticated;

create or replace function public.sharepoint_bridge_expected_token()
returns text
language sql
stable
as $$
  select current_setting('app.sharepoint_bridge_token', true)
$$;

create or replace function public.sharepoint_assert_bridge_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_token text := public.sharepoint_bridge_expected_token();
begin
  if expected_token is null or expected_token = '' then
    raise exception 'Token da ponte SharePoint nao configurado';
  end if;

  if p_token is distinct from expected_token then
    raise exception 'Token invalido';
  end if;
end;
$$;

create or replace function public.sharepoint_upsert_ticket_cache(
  p_token text,
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item_id text := nullif(coalesce(p_record ->> 'sharepoint_item_id', p_record ->> 'ID', p_record ->> 'Id'), '');
  codigo text := nullif(coalesce(p_record ->> 'ticket_codigo', p_record ->> 'TicketCodigo', p_record ->> 'TICKETCODIGO', p_record ->> 'codigo'), '');
  existing_id uuid;
  saved_id uuid;
begin
  perform public.sharepoint_assert_bridge_token(p_token);

  if item_id is null then
    raise exception 'sharepoint_item_id e obrigatorio';
  end if;

  if codigo is null then
    codigo := item_id;
  end if;

  select id into existing_id
  from public.sharepoint_ticket_cache
  where sharepoint_item_id = item_id
     or ticket_codigo = codigo
  limit 1;

  if existing_id is null then
    insert into public.sharepoint_ticket_cache (
      sharepoint_item_id, ticket_codigo, cliente_id, cliente_nome, cliente_email, titulo, status,
      ultima_acao_por, ultima_mensagem, sharepoint_created_at, sharepoint_updated_at, raw, synced_at
    )
    values (
      item_id,
      codigo,
      nullif(p_record ->> 'cliente_id', '')::uuid,
      nullif(coalesce(p_record ->> 'cliente_nome', p_record ->> 'ClienteNome'), ''),
      lower(nullif(coalesce(p_record ->> 'cliente_email', p_record ->> 'ClienteEmail', p_record ->> 'EMAIL'), '')),
      nullif(coalesce(p_record ->> 'titulo', p_record ->> 'Title', p_record ->> 'Titulo'), ''),
      coalesce(nullif(p_record ->> 'status', ''), nullif(p_record ->> 'Status', ''), 'Ativo'),
      nullif(coalesce(p_record ->> 'ultima_acao_por', p_record ->> 'UltimaAcaoPor'), ''),
      nullif(coalesce(p_record ->> 'ultima_mensagem', p_record ->> 'UltimaMensagem'), ''),
      nullif(coalesce(p_record ->> 'sharepoint_created_at', p_record ->> 'Created'), '')::timestamptz,
      nullif(coalesce(p_record ->> 'sharepoint_updated_at', p_record ->> 'Modified'), '')::timestamptz,
      p_record,
      now()
    )
    returning id into saved_id;
  else
    update public.sharepoint_ticket_cache
    set
      sharepoint_item_id = item_id,
      ticket_codigo = codigo,
      cliente_id = nullif(p_record ->> 'cliente_id', '')::uuid,
      cliente_nome = nullif(coalesce(p_record ->> 'cliente_nome', p_record ->> 'ClienteNome'), ''),
      cliente_email = lower(nullif(coalesce(p_record ->> 'cliente_email', p_record ->> 'ClienteEmail', p_record ->> 'EMAIL'), '')),
      titulo = nullif(coalesce(p_record ->> 'titulo', p_record ->> 'Title', p_record ->> 'Titulo'), ''),
      status = coalesce(nullif(p_record ->> 'status', ''), nullif(p_record ->> 'Status', ''), 'Ativo'),
      ultima_acao_por = nullif(coalesce(p_record ->> 'ultima_acao_por', p_record ->> 'UltimaAcaoPor'), ''),
      ultima_mensagem = nullif(coalesce(p_record ->> 'ultima_mensagem', p_record ->> 'UltimaMensagem'), ''),
      sharepoint_created_at = nullif(coalesce(p_record ->> 'sharepoint_created_at', p_record ->> 'Created'), '')::timestamptz,
      sharepoint_updated_at = nullif(coalesce(p_record ->> 'sharepoint_updated_at', p_record ->> 'Modified'), '')::timestamptz,
      raw = p_record,
      synced_at = now()
    where id = existing_id
    returning id into saved_id;
  end if;

  return jsonb_build_object('ok', true, 'id', saved_id, 'sharepoint_item_id', item_id);
end;
$$;

create or replace function public.sharepoint_upsert_ticket_movimentacao_cache(
  p_token text,
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item_id text := nullif(coalesce(p_record ->> 'sharepoint_item_id', p_record ->> 'ID', p_record ->> 'Id'), '');
  saved_id uuid;
begin
  perform public.sharepoint_assert_bridge_token(p_token);

  if item_id is null then
    raise exception 'sharepoint_item_id e obrigatorio';
  end if;

  insert into public.sharepoint_ticket_movimentacoes_cache (
    sharepoint_item_id, sharepoint_ticket_item_id, ticket_codigo, cliente_email, autor_tipo,
    autor_nome, tipo_evento, mensagem, status_novo, arquivo_nome, arquivo_path, arquivo_url,
    arquivos, sharepoint_created_at, raw, synced_at
  )
  values (
    item_id,
    nullif(coalesce(p_record ->> 'sharepoint_ticket_item_id', p_record ->> 'TicketItemId'), ''),
    nullif(coalesce(p_record ->> 'ticket_codigo', p_record ->> 'TicketCodigo'), ''),
    lower(nullif(coalesce(p_record ->> 'cliente_email', p_record ->> 'ClienteEmail', p_record ->> 'EMAIL'), '')),
    nullif(coalesce(p_record ->> 'autor_tipo', p_record ->> 'AutorTipo'), ''),
    nullif(coalesce(p_record ->> 'autor_nome', p_record ->> 'AutorNome'), ''),
    nullif(coalesce(p_record ->> 'tipo_evento', p_record ->> 'TipoEvento'), ''),
    nullif(coalesce(p_record ->> 'mensagem', p_record ->> 'Mensagem'), ''),
    nullif(coalesce(p_record ->> 'status_novo', p_record ->> 'StatusNovo'), ''),
    nullif(coalesce(p_record ->> 'arquivo_nome', p_record ->> 'ArquivoNome'), ''),
    nullif(coalesce(p_record ->> 'arquivo_path', p_record ->> 'ArquivoPath'), ''),
    nullif(coalesce(p_record ->> 'arquivo_url', p_record ->> 'ArquivoUrl'), ''),
    coalesce(p_record -> 'arquivos', p_record -> 'Arquivos'),
    nullif(coalesce(p_record ->> 'sharepoint_created_at', p_record ->> 'Created'), '')::timestamptz,
    p_record,
    now()
  )
  on conflict (sharepoint_item_id) do update
  set
    sharepoint_ticket_item_id = excluded.sharepoint_ticket_item_id,
    ticket_codigo = excluded.ticket_codigo,
    cliente_email = excluded.cliente_email,
    autor_tipo = excluded.autor_tipo,
    autor_nome = excluded.autor_nome,
    tipo_evento = excluded.tipo_evento,
    mensagem = excluded.mensagem,
    status_novo = excluded.status_novo,
    arquivo_nome = excluded.arquivo_nome,
    arquivo_path = excluded.arquivo_path,
    arquivo_url = excluded.arquivo_url,
    arquivos = excluded.arquivos,
    sharepoint_created_at = excluded.sharepoint_created_at,
    raw = excluded.raw,
    synced_at = now()
  returning id into saved_id;

  return jsonb_build_object('ok', true, 'id', saved_id, 'sharepoint_item_id', item_id);
end;
$$;

create or replace function public.sharepoint_upsert_comunicacao_cache(
  p_token text,
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item_id text := nullif(coalesce(p_record ->> 'sharepoint_item_id', p_record ->> 'ID', p_record ->> 'Id'), '');
  codigo text := nullif(coalesce(p_record ->> 'comunicacao_codigo', p_record ->> 'ComunicacaoCodigo', p_record ->> 'codigo'), '');
  existing_id uuid;
  saved_id uuid;
begin
  perform public.sharepoint_assert_bridge_token(p_token);

  if item_id is null then
    raise exception 'sharepoint_item_id e obrigatorio';
  end if;

  if codigo is null then
    codigo := item_id;
  end if;

  select id into existing_id
  from public.sharepoint_comunicacao_cache
  where sharepoint_item_id = item_id
     or comunicacao_codigo = codigo
  limit 1;

  if existing_id is null then
    insert into public.sharepoint_comunicacao_cache (
      sharepoint_item_id, comunicacao_codigo, supabase_comunicacao_id, cliente_id, cliente_nome,
      cliente_email, assunto, descricao, status, data_solicitacao, horario, ultima_acao_por,
      ultima_mensagem, sharepoint_created_at, sharepoint_updated_at, raw, synced_at
    )
    values (
      item_id,
      codigo,
      nullif(p_record ->> 'supabase_comunicacao_id', '')::uuid,
      nullif(p_record ->> 'cliente_id', '')::uuid,
      nullif(coalesce(p_record ->> 'cliente_nome', p_record ->> 'ClienteNome'), ''),
      lower(nullif(coalesce(p_record ->> 'cliente_email', p_record ->> 'ClienteEmail', p_record ->> 'EMAIL'), '')),
      nullif(coalesce(p_record ->> 'assunto', p_record ->> 'Assunto', p_record ->> 'Title'), ''),
      nullif(coalesce(p_record ->> 'descricao', p_record ->> 'Descricao', p_record ->> 'Mensagem'), ''),
      coalesce(nullif(p_record ->> 'status', ''), nullif(p_record ->> 'Status', ''), 'Ativo'),
      nullif(coalesce(p_record ->> 'data_solicitacao', p_record ->> 'DataSolicitacao'), '')::date,
      nullif(coalesce(p_record ->> 'horario', p_record ->> 'Horario'), ''),
      nullif(coalesce(p_record ->> 'ultima_acao_por', p_record ->> 'UltimaAcaoPor'), ''),
      nullif(coalesce(p_record ->> 'ultima_mensagem', p_record ->> 'UltimaMensagem'), ''),
      nullif(coalesce(p_record ->> 'sharepoint_created_at', p_record ->> 'Created'), '')::timestamptz,
      nullif(coalesce(p_record ->> 'sharepoint_updated_at', p_record ->> 'Modified'), '')::timestamptz,
      p_record,
      now()
    )
    returning id into saved_id;
  else
    update public.sharepoint_comunicacao_cache
    set
      sharepoint_item_id = item_id,
      comunicacao_codigo = codigo,
      supabase_comunicacao_id = nullif(p_record ->> 'supabase_comunicacao_id', '')::uuid,
      cliente_id = nullif(p_record ->> 'cliente_id', '')::uuid,
      cliente_nome = nullif(coalesce(p_record ->> 'cliente_nome', p_record ->> 'ClienteNome'), ''),
      cliente_email = lower(nullif(coalesce(p_record ->> 'cliente_email', p_record ->> 'ClienteEmail', p_record ->> 'EMAIL'), '')),
      assunto = nullif(coalesce(p_record ->> 'assunto', p_record ->> 'Assunto', p_record ->> 'Title'), ''),
      descricao = nullif(coalesce(p_record ->> 'descricao', p_record ->> 'Descricao', p_record ->> 'Mensagem'), ''),
      status = coalesce(nullif(p_record ->> 'status', ''), nullif(p_record ->> 'Status', ''), 'Ativo'),
      data_solicitacao = nullif(coalesce(p_record ->> 'data_solicitacao', p_record ->> 'DataSolicitacao'), '')::date,
      horario = nullif(coalesce(p_record ->> 'horario', p_record ->> 'Horario'), ''),
      ultima_acao_por = nullif(coalesce(p_record ->> 'ultima_acao_por', p_record ->> 'UltimaAcaoPor'), ''),
      ultima_mensagem = nullif(coalesce(p_record ->> 'ultima_mensagem', p_record ->> 'UltimaMensagem'), ''),
      sharepoint_created_at = nullif(coalesce(p_record ->> 'sharepoint_created_at', p_record ->> 'Created'), '')::timestamptz,
      sharepoint_updated_at = nullif(coalesce(p_record ->> 'sharepoint_updated_at', p_record ->> 'Modified'), '')::timestamptz,
      raw = p_record,
      synced_at = now()
    where id = existing_id
    returning id into saved_id;
  end if;

  return jsonb_build_object('ok', true, 'id', saved_id, 'sharepoint_item_id', item_id);
end;
$$;

create or replace function public.sharepoint_upsert_comunicacao_movimentacao_cache(
  p_token text,
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item_id text := nullif(coalesce(p_record ->> 'sharepoint_item_id', p_record ->> 'ID', p_record ->> 'Id'), '');
  saved_id uuid;
begin
  perform public.sharepoint_assert_bridge_token(p_token);

  if item_id is null then
    raise exception 'sharepoint_item_id e obrigatorio';
  end if;

  insert into public.sharepoint_comunicacao_movimentacoes_cache (
    sharepoint_item_id, sharepoint_comunicacao_item_id, comunicacao_codigo, cliente_email,
    autor_tipo, autor_nome, tipo_evento, mensagem, status_novo, arquivo_nome, arquivo_path,
    arquivo_url, arquivos, sharepoint_created_at, raw, synced_at
  )
  values (
    item_id,
    nullif(coalesce(p_record ->> 'sharepoint_comunicacao_item_id', p_record ->> 'ComunicacaoItemId'), ''),
    nullif(coalesce(p_record ->> 'comunicacao_codigo', p_record ->> 'ComunicacaoCodigo'), ''),
    lower(nullif(coalesce(p_record ->> 'cliente_email', p_record ->> 'ClienteEmail', p_record ->> 'EMAIL'), '')),
    nullif(coalesce(p_record ->> 'autor_tipo', p_record ->> 'AutorTipo'), ''),
    nullif(coalesce(p_record ->> 'autor_nome', p_record ->> 'AutorNome'), ''),
    nullif(coalesce(p_record ->> 'tipo_evento', p_record ->> 'TipoEvento'), ''),
    nullif(coalesce(p_record ->> 'mensagem', p_record ->> 'Mensagem'), ''),
    nullif(coalesce(p_record ->> 'status_novo', p_record ->> 'StatusNovo'), ''),
    nullif(coalesce(p_record ->> 'arquivo_nome', p_record ->> 'ArquivoNome'), ''),
    nullif(coalesce(p_record ->> 'arquivo_path', p_record ->> 'ArquivoPath'), ''),
    nullif(coalesce(p_record ->> 'arquivo_url', p_record ->> 'ArquivoUrl'), ''),
    coalesce(p_record -> 'arquivos', p_record -> 'Arquivos'),
    nullif(coalesce(p_record ->> 'sharepoint_created_at', p_record ->> 'Created'), '')::timestamptz,
    p_record,
    now()
  )
  on conflict (sharepoint_item_id) do update
  set
    sharepoint_comunicacao_item_id = excluded.sharepoint_comunicacao_item_id,
    comunicacao_codigo = excluded.comunicacao_codigo,
    cliente_email = excluded.cliente_email,
    autor_tipo = excluded.autor_tipo,
    autor_nome = excluded.autor_nome,
    tipo_evento = excluded.tipo_evento,
    mensagem = excluded.mensagem,
    status_novo = excluded.status_novo,
    arquivo_nome = excluded.arquivo_nome,
    arquivo_path = excluded.arquivo_path,
    arquivo_url = excluded.arquivo_url,
    arquivos = excluded.arquivos,
    sharepoint_created_at = excluded.sharepoint_created_at,
    raw = excluded.raw,
    synced_at = now()
  returning id into saved_id;

  return jsonb_build_object('ok', true, 'id', saved_id, 'sharepoint_item_id', item_id);
end;
$$;

grant execute on function public.sharepoint_assert_bridge_token(text) to anon, authenticated;
grant execute on function public.sharepoint_upsert_ticket_cache(text, jsonb) to anon, authenticated;
grant execute on function public.sharepoint_upsert_ticket_movimentacao_cache(text, jsonb) to anon, authenticated;
grant execute on function public.sharepoint_upsert_comunicacao_cache(text, jsonb) to anon, authenticated;
grant execute on function public.sharepoint_upsert_comunicacao_movimentacao_cache(text, jsonb) to anon, authenticated;
