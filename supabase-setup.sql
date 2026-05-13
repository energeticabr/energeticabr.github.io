-- Setup do painel administrativo da Energética Construções.
-- Cole este SQL no Supabase em SQL Editor > New query > Run.

create extension if not exists pgcrypto;

create table if not exists public.obras (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,
  categoria text not null default 'Durante',
  imagem_url text not null,
  imagem_path text not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.obras enable row level security;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text not null,
  email text,
  interesse text not null,
  renda text,
  cidade text,
  horario text,
  mensagem text,
  origem text not null default 'site',
  status text not null default 'novo',
  created_at timestamptz not null default now()
);

create table if not exists public.admin_users (
  email text primary key,
  created_at timestamptz not null default now()
);

insert into public.admin_users (email)
select lower(email)
from auth.users
where email is not null
order by created_at asc
limit 1
on conflict (email) do nothing;

create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text not null unique,
  telefone text,
  empreendimento text,
  unidade text,
  etapa text not null default 'Cadastro',
  status text not null default 'Pendente',
  status_obra text,
  documentos_pendentes text,
  proximo_passo text,
  mensagem text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clientes add column if not exists telefone text;
alter table public.clientes add column if not exists empreendimento text;
alter table public.clientes add column if not exists unidade text;
alter table public.clientes add column if not exists etapa text not null default 'Cadastro';
alter table public.clientes add column if not exists status text not null default 'Pendente';
alter table public.clientes alter column status set default 'Pendente';
alter table public.clientes add column if not exists status_obra text;
alter table public.clientes add column if not exists documentos_pendentes text;
alter table public.clientes add column if not exists proximo_passo text;
alter table public.clientes add column if not exists mensagem text;
alter table public.clientes add column if not exists updated_at timestamptz not null default now();
alter table public.clientes add column if not exists sharepoint_item_id text;
alter table public.clientes add column if not exists cpf text;
alter table public.clientes add column if not exists rg text;
alter table public.clientes add column if not exists filial text;
alter table public.clientes add column if not exists corretor text;
alter table public.clientes add column if not exists imovel_adquirido text;
alter table public.clientes add column if not exists descricao_sharepoint text;
alter table public.clientes add column if not exists data_venda date;
alter table public.clientes add column if not exists data_assinatura date;
alter table public.clientes add column if not exists sharepoint_status text;
alter table public.clientes add column if not exists synced_from_sharepoint_at timestamptz;

create unique index if not exists clientes_sharepoint_item_id_key
on public.clientes (sharepoint_item_id)
where sharepoint_item_id is not null;

create table if not exists public.cliente_comunicacoes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  data_solicitacao date not null default current_date,
  horario time,
  assunto text,
  descricao text not null,
  status text not null default 'Registrado',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cliente_comunicacoes add column if not exists horario time;
alter table public.cliente_comunicacoes add column if not exists assunto text;
alter table public.cliente_comunicacoes add column if not exists status text not null default 'Registrado';
alter table public.cliente_comunicacoes add column if not exists updated_at timestamptz not null default now();

create table if not exists public.cliente_tickets (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  codigo text not null unique default (
    'EN-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
  ),
  titulo text not null,
  status text not null default 'Aberto',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cliente_ticket_mensagens (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.cliente_tickets(id) on delete cascade,
  autor_tipo text not null default 'cliente',
  mensagem text not null,
  arquivo_url text,
  arquivo_path text,
  arquivo_nome text,
  created_at timestamptz not null default now()
);

create table if not exists public.cliente_comunicacao_respostas (
  id uuid primary key default gen_random_uuid(),
  comunicacao_id uuid not null references public.cliente_comunicacoes(id) on delete cascade,
  autor_tipo text not null default 'cliente',
  mensagem text not null,
  arquivo_path text,
  arquivo_nome text,
  created_at timestamptz not null default now()
);

create table if not exists public.cliente_documentos_solicitados (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  titulo text not null,
  descricao text,
  status text not null default 'pendente',
  arquivo_path text,
  arquivo_nome text,
  cliente_mensagem text,
  admin_observacao text,
  solicitado_em timestamptz not null default now(),
  enviado_em timestamptz,
  avaliado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  aprovado_por text
);

create table if not exists public.cliente_documento_arquivos (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.cliente_documentos_solicitados(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  arquivo_path text not null,
  arquivo_nome text not null,
  cliente_mensagem text,
  status text not null default 'enviado',
  admin_observacao text,
  enviado_em timestamptz not null default now(),
  avaliado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  aprovado_por text
);

alter table public.cliente_tickets add column if not exists codigo text;
alter table public.cliente_tickets add column if not exists status text not null default 'Aberto';
alter table public.cliente_tickets add column if not exists updated_at timestamptz not null default now();
alter table public.cliente_ticket_mensagens add column if not exists autor_tipo text not null default 'cliente';
alter table public.cliente_ticket_mensagens add column if not exists arquivo_url text;
alter table public.cliente_ticket_mensagens add column if not exists arquivo_path text;
alter table public.cliente_ticket_mensagens add column if not exists arquivo_nome text;
alter table public.cliente_comunicacao_respostas add column if not exists autor_tipo text not null default 'cliente';
alter table public.cliente_comunicacao_respostas add column if not exists arquivo_path text;
alter table public.cliente_comunicacao_respostas add column if not exists arquivo_nome text;
alter table public.cliente_documentos_solicitados add column if not exists status text not null default 'pendente';
alter table public.cliente_documentos_solicitados alter column status set default 'pendente';
alter table public.cliente_documentos_solicitados add column if not exists arquivo_path text;
alter table public.cliente_documentos_solicitados add column if not exists arquivo_nome text;
alter table public.cliente_documentos_solicitados add column if not exists cliente_mensagem text;
alter table public.cliente_documentos_solicitados add column if not exists admin_observacao text;
alter table public.cliente_documentos_solicitados add column if not exists solicitado_em timestamptz not null default now();
alter table public.cliente_documentos_solicitados add column if not exists enviado_em timestamptz;
alter table public.cliente_documentos_solicitados add column if not exists avaliado_em timestamptz;
alter table public.cliente_documentos_solicitados add column if not exists updated_at timestamptz not null default now();
alter table public.cliente_documentos_solicitados add column if not exists aprovado_por text;
alter table public.cliente_documento_arquivos add column if not exists status text not null default 'enviado';
alter table public.cliente_documento_arquivos alter column status set default 'enviado';
alter table public.cliente_documento_arquivos add column if not exists cliente_mensagem text;
alter table public.cliente_documento_arquivos add column if not exists admin_observacao text;
alter table public.cliente_documento_arquivos add column if not exists enviado_em timestamptz not null default now();
alter table public.cliente_documento_arquivos add column if not exists avaliado_em timestamptz;
alter table public.cliente_documento_arquivos add column if not exists updated_at timestamptz not null default now();
alter table public.cliente_documento_arquivos add column if not exists aprovado_por text;

update public.cliente_tickets
set codigo = 'EN-' || to_char(created_at, 'YYYYMMDD') || '-' || upper(substr(replace(id::text, '-', ''), 1, 6))
where codigo is null;

alter table public.cliente_tickets alter column codigo set default (
  'EN-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
);
alter table public.cliente_tickets alter column codigo set not null;
create unique index if not exists cliente_tickets_codigo_key on public.cliente_tickets (codigo);

create or replace function public.current_user_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where lower(email) = public.current_user_email()
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clientes_set_updated_at on public.clientes;
create trigger clientes_set_updated_at
before update on public.clientes
for each row
execute function public.set_updated_at();

drop trigger if exists cliente_comunicacoes_set_updated_at on public.cliente_comunicacoes;
create trigger cliente_comunicacoes_set_updated_at
before update on public.cliente_comunicacoes
for each row
execute function public.set_updated_at();

drop trigger if exists cliente_tickets_set_updated_at on public.cliente_tickets;
create trigger cliente_tickets_set_updated_at
before update on public.cliente_tickets
for each row
execute function public.set_updated_at();

drop trigger if exists cliente_documentos_set_updated_at on public.cliente_documentos_solicitados;
create trigger cliente_documentos_set_updated_at
before update on public.cliente_documentos_solicitados
for each row
execute function public.set_updated_at();

drop trigger if exists cliente_documento_arquivos_set_updated_at on public.cliente_documento_arquivos;
create trigger cliente_documento_arquivos_set_updated_at
before update on public.cliente_documento_arquivos
for each row
execute function public.set_updated_at();

alter table public.cliente_documentos_solicitados
  drop constraint if exists cliente_documentos_status_check;

alter table public.cliente_documento_arquivos
  drop constraint if exists cliente_documento_arquivos_status_check;

update public.cliente_documentos_solicitados
set status = case
  when lower(status) = 'solicitado' then 'pendente'
  else lower(status)
end
where status is not null;

update public.cliente_documento_arquivos
set status = lower(status)
where status is not null;

create or replace function public.normalize_cliente_documentos_solicitados_status()
returns trigger
language plpgsql
as $$
begin
  new.status := lower(coalesce(new.status, 'pendente'));
  if new.status = 'solicitado' then
    new.status := 'pendente';
  end if;

  return new;
end;
$$;

drop trigger if exists normalize_cliente_documentos_solicitados_status on public.cliente_documentos_solicitados;
create trigger normalize_cliente_documentos_solicitados_status
before insert or update of status on public.cliente_documentos_solicitados
for each row
execute function public.normalize_cliente_documentos_solicitados_status();

create or replace function public.normalize_cliente_documento_arquivos_status()
returns trigger
language plpgsql
as $$
begin
  new.status := lower(coalesce(new.status, 'enviado'));
  return new;
end;
$$;

drop trigger if exists normalize_cliente_documento_arquivos_status on public.cliente_documento_arquivos;
create trigger normalize_cliente_documento_arquivos_status
before insert or update of status on public.cliente_documento_arquivos
for each row
execute function public.normalize_cliente_documento_arquivos_status();

alter table public.cliente_documentos_solicitados
  add constraint cliente_documentos_status_check
  check (status in ('pendente', 'enviado', 'aprovado', 'recusado'));

alter table public.cliente_documento_arquivos
  add constraint cliente_documento_arquivos_status_check
  check (status in ('enviado', 'aprovado', 'recusado'));

create or replace function public.cliente_envia_documento_solicitado(
  p_id uuid,
  p_arquivo_path text,
  p_arquivo_nome text,
  p_cliente_mensagem text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id uuid;
begin
  select d.cliente_id into v_cliente_id
  from public.cliente_documentos_solicitados d
  join public.clientes c on c.id = d.cliente_id
  where d.id = p_id
    and lower(c.email) = public.current_user_email()
    and lower(coalesce(d.status, 'pendente')) in ('pendente', 'solicitado', 'enviado', 'recusado', 'aprovado');

  if v_cliente_id is null then
    return false;
  end if;

  insert into public.cliente_documento_arquivos (
    documento_id,
    cliente_id,
    arquivo_path,
    arquivo_nome,
    cliente_mensagem,
    status
  ) values (
    p_id,
    v_cliente_id,
    p_arquivo_path,
    p_arquivo_nome,
    nullif(p_cliente_mensagem, ''),
    'enviado'
  );

  update public.cliente_documentos_solicitados
  set
    arquivo_path = p_arquivo_path,
    arquivo_nome = p_arquivo_nome,
    cliente_mensagem = nullif(p_cliente_mensagem, ''),
    status = 'enviado',
    enviado_em = now(),
    avaliado_em = null,
    admin_observacao = null,
    aprovado_por = null,
    updated_at = now()
  where id = p_id;

  return true;
end;
$$;

create or replace function public.normalize_ticket_message_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.autor_tipo := lower(coalesce(new.autor_tipo, ''));

  if new.autor_tipo not in ('cliente', 'empresa') then
    if public.is_admin_user() then
      new.autor_tipo := 'empresa';
    else
      new.autor_tipo := 'cliente';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists ticket_message_author on public.cliente_ticket_mensagens;
create trigger ticket_message_author
before insert on public.cliente_ticket_mensagens
for each row
execute function public.normalize_ticket_message_author();

drop trigger if exists comunicacao_resposta_author on public.cliente_comunicacao_respostas;
create trigger comunicacao_resposta_author
before insert on public.cliente_comunicacao_respostas
for each row
execute function public.normalize_ticket_message_author();

create or replace function public.update_ticket_after_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.cliente_tickets
  set
    updated_at = now(),
    status = case
      when new.autor_tipo = 'empresa' then 'Respondido'
      else 'Aguardando empresa'
    end
  where id = new.ticket_id;

  return new;
end;
$$;

drop trigger if exists ticket_message_updates_ticket on public.cliente_ticket_mensagens;
create trigger ticket_message_updates_ticket
after insert on public.cliente_ticket_mensagens
for each row
execute function public.update_ticket_after_message();

create or replace function public.normalize_cliente_public_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'anon' then
    new.status := 'Pendente';
    new.etapa := 'Cadastro';
  end if;

  return new;
end;
$$;

drop trigger if exists clientes_public_request_defaults on public.clientes;
create trigger clientes_public_request_defaults
before insert on public.clientes
for each row
execute function public.normalize_cliente_public_request();

alter table public.clientes enable row level security;
alter table public.cliente_comunicacoes enable row level security;
alter table public.cliente_tickets enable row level security;
alter table public.cliente_ticket_mensagens enable row level security;
alter table public.cliente_comunicacao_respostas enable row level security;
alter table public.cliente_documentos_solicitados enable row level security;
alter table public.cliente_documento_arquivos enable row level security;

-- A tabela de interessados aceita insercao publica pelo formulario,
-- mas nao concede leitura publica. O painel logado usa as permissoes
-- abaixo para listar, atualizar e excluir.
alter table public.leads disable row level security;
alter table public.leads add column if not exists email text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'obras',
  'obras',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cliente-documentos',
  'cliente-documentos',
  false,
  20971520,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Qualquer pessoa pode ver obras" on public.obras;
create policy "Qualquer pessoa pode ver obras"
on public.obras
for select
using (true);

drop policy if exists "Usuario autenticado cadastra suas obras" on public.obras;
create policy "Usuario autenticado cadastra suas obras"
on public.obras
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Usuario autenticado atualiza suas obras" on public.obras;
create policy "Usuario autenticado atualiza suas obras"
on public.obras
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Usuario autenticado remove suas obras" on public.obras;
create policy "Usuario autenticado remove suas obras"
on public.obras
for delete
to authenticated
using (auth.uid() = user_id);

revoke all on table public.leads from anon;
revoke all on table public.leads from authenticated;
revoke all on table public.clientes from anon;
revoke all on table public.cliente_comunicacoes from anon;
revoke all on table public.cliente_comunicacoes from authenticated;
revoke all on table public.cliente_tickets from anon;
revoke all on table public.cliente_tickets from authenticated;
revoke all on table public.cliente_ticket_mensagens from anon;
revoke all on table public.cliente_ticket_mensagens from authenticated;
revoke all on table public.cliente_comunicacao_respostas from anon;
revoke all on table public.cliente_comunicacao_respostas from authenticated;
revoke all on table public.cliente_documentos_solicitados from anon;
revoke all on table public.cliente_documentos_solicitados from authenticated;
revoke all on table public.cliente_documento_arquivos from anon;
revoke all on table public.cliente_documento_arquivos from authenticated;

grant usage on schema public to anon, authenticated;
grant insert on table public.leads to anon;
grant select, update, delete on table public.leads to authenticated;
grant insert on table public.clientes to anon;
grant select, insert, update, delete on table public.clientes to authenticated;
grant select, insert, update, delete on table public.cliente_comunicacoes to authenticated;
grant select, insert, update, delete on table public.cliente_tickets to authenticated;
grant select, insert, update, delete on table public.cliente_ticket_mensagens to authenticated;
grant select, insert, update, delete on table public.cliente_comunicacao_respostas to authenticated;
grant select, insert, update, delete on table public.cliente_documentos_solicitados to authenticated;
grant select, insert, update, delete on table public.cliente_documento_arquivos to authenticated;
grant execute on function public.current_user_email() to authenticated;
grant execute on function public.is_admin_user() to authenticated;
grant execute on function public.cliente_envia_documento_solicitado(uuid, text, text, text) to authenticated;

drop policy if exists "Cliente ve seu proprio cadastro" on public.clientes;
create policy "Cliente ve seu proprio cadastro"
on public.clientes
for select
to authenticated
using (
  lower(email) = public.current_user_email()
  or public.is_admin_user()
);

drop policy if exists "Admin cadastra clientes" on public.clientes;
create policy "Admin cadastra clientes"
on public.clientes
for insert
to authenticated
with check (public.is_admin_user());

drop policy if exists "Cliente solicita cadastro" on public.clientes;
create policy "Cliente solicita cadastro"
on public.clientes
for insert
to authenticated
with check (
  lower(email) = public.current_user_email()
  and coalesce(status, 'Pendente') = 'Pendente'
);

drop policy if exists "Visitante solicita cadastro" on public.clientes;
create policy "Visitante solicita cadastro"
on public.clientes
for insert
to anon
with check (true);

drop policy if exists "Admin atualiza clientes" on public.clientes;
create policy "Admin atualiza clientes"
on public.clientes
for update
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

drop policy if exists "Admin remove clientes" on public.clientes;
create policy "Admin remove clientes"
on public.clientes
for delete
to authenticated
using (public.is_admin_user());

drop policy if exists "Cliente ve suas comunicacoes" on public.cliente_comunicacoes;
create policy "Cliente ve suas comunicacoes"
on public.cliente_comunicacoes
for select
to authenticated
using (
  public.is_admin_user()
  or exists (
    select 1
    from public.clientes c
    where c.id = cliente_comunicacoes.cliente_id
      and lower(c.email) = public.current_user_email()
  )
);

drop policy if exists "Admin cadastra comunicacoes" on public.cliente_comunicacoes;
create policy "Admin cadastra comunicacoes"
on public.cliente_comunicacoes
for insert
to authenticated
with check (public.is_admin_user());

drop policy if exists "Admin atualiza comunicacoes" on public.cliente_comunicacoes;
create policy "Admin atualiza comunicacoes"
on public.cliente_comunicacoes
for update
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

drop policy if exists "Admin remove comunicacoes" on public.cliente_comunicacoes;
create policy "Admin remove comunicacoes"
on public.cliente_comunicacoes
for delete
to authenticated
using (public.is_admin_user());

drop policy if exists "Cliente ve respostas das comunicacoes" on public.cliente_comunicacao_respostas;
create policy "Cliente ve respostas das comunicacoes"
on public.cliente_comunicacao_respostas
for select
to authenticated
using (
  public.is_admin_user()
  or exists (
    select 1
    from public.cliente_comunicacoes cc
    join public.clientes c on c.id = cc.cliente_id
    where cc.id = cliente_comunicacao_respostas.comunicacao_id
      and lower(c.email) = public.current_user_email()
  )
);

drop policy if exists "Cliente responde comunicacoes" on public.cliente_comunicacao_respostas;
create policy "Cliente responde comunicacoes"
on public.cliente_comunicacao_respostas
for insert
to authenticated
with check (
  public.is_admin_user()
  or exists (
    select 1
    from public.cliente_comunicacoes cc
    join public.clientes c on c.id = cc.cliente_id
    where cc.id = cliente_comunicacao_respostas.comunicacao_id
      and lower(c.email) = public.current_user_email()
  )
);

drop policy if exists "Admin remove respostas das comunicacoes" on public.cliente_comunicacao_respostas;
create policy "Admin remove respostas das comunicacoes"
on public.cliente_comunicacao_respostas
for delete
to authenticated
using (public.is_admin_user());

drop policy if exists "Cliente ve seus tickets" on public.cliente_tickets;
create policy "Cliente ve seus tickets"
on public.cliente_tickets
for select
to authenticated
using (
  public.is_admin_user()
  or exists (
    select 1
    from public.clientes c
    where c.id = cliente_tickets.cliente_id
      and lower(c.email) = public.current_user_email()
  )
);

drop policy if exists "Cliente abre ticket" on public.cliente_tickets;
create policy "Cliente abre ticket"
on public.cliente_tickets
for insert
to authenticated
with check (
  public.is_admin_user()
  or exists (
    select 1
    from public.clientes c
    where c.id = cliente_tickets.cliente_id
      and lower(c.email) = public.current_user_email()
  )
);

drop policy if exists "Admin atualiza tickets" on public.cliente_tickets;
create policy "Admin atualiza tickets"
on public.cliente_tickets
for update
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

drop policy if exists "Admin remove tickets" on public.cliente_tickets;
create policy "Admin remove tickets"
on public.cliente_tickets
for delete
to authenticated
using (public.is_admin_user());

drop policy if exists "Cliente ve mensagens dos tickets" on public.cliente_ticket_mensagens;
create policy "Cliente ve mensagens dos tickets"
on public.cliente_ticket_mensagens
for select
to authenticated
using (
  public.is_admin_user()
  or exists (
    select 1
    from public.cliente_tickets t
    join public.clientes c on c.id = t.cliente_id
    where t.id = cliente_ticket_mensagens.ticket_id
      and lower(c.email) = public.current_user_email()
  )
);

drop policy if exists "Cliente responde ticket" on public.cliente_ticket_mensagens;
create policy "Cliente responde ticket"
on public.cliente_ticket_mensagens
for insert
to authenticated
with check (
  public.is_admin_user()
  or exists (
    select 1
    from public.cliente_tickets t
    join public.clientes c on c.id = t.cliente_id
    where t.id = cliente_ticket_mensagens.ticket_id
      and lower(c.email) = public.current_user_email()
  )
);

drop policy if exists "Admin remove mensagens de ticket" on public.cliente_ticket_mensagens;
create policy "Admin remove mensagens de ticket"
on public.cliente_ticket_mensagens
for delete
to authenticated
using (public.is_admin_user());

drop policy if exists "Cliente ve documentos solicitados" on public.cliente_documentos_solicitados;
create policy "Cliente ve documentos solicitados"
on public.cliente_documentos_solicitados
for select
to authenticated
using (
  public.is_admin_user()
  or exists (
    select 1
    from public.clientes c
    where c.id = cliente_documentos_solicitados.cliente_id
      and lower(c.email) = public.current_user_email()
  )
);

drop policy if exists "Admin solicita documentos" on public.cliente_documentos_solicitados;
create policy "Admin solicita documentos"
on public.cliente_documentos_solicitados
for insert
to authenticated
with check (public.is_admin_user());

drop policy if exists "Admin avalia documentos solicitados" on public.cliente_documentos_solicitados;
create policy "Admin avalia documentos solicitados"
on public.cliente_documentos_solicitados
for update
to authenticated
using (
  public.is_admin_user()
  or exists (
    select 1
    from public.clientes c
    where c.id = cliente_documentos_solicitados.cliente_id
      and lower(c.email) = public.current_user_email()
  )
)
with check (
  public.is_admin_user()
  or exists (
    select 1
    from public.clientes c
    where c.id = cliente_documentos_solicitados.cliente_id
      and lower(c.email) = public.current_user_email()
  )
);

drop policy if exists "Admin remove documentos solicitados" on public.cliente_documentos_solicitados;
create policy "Admin remove documentos solicitados"
on public.cliente_documentos_solicitados
for delete
to authenticated
using (public.is_admin_user());

drop policy if exists "Cliente ve arquivos de documentos" on public.cliente_documento_arquivos;
create policy "Cliente ve arquivos de documentos"
on public.cliente_documento_arquivos
for select
to authenticated
using (
  public.is_admin_user()
  or exists (
    select 1
    from public.clientes c
    where c.id = cliente_documento_arquivos.cliente_id
      and lower(c.email) = public.current_user_email()
  )
);

drop policy if exists "Cliente envia arquivos de documentos" on public.cliente_documento_arquivos;
create policy "Cliente envia arquivos de documentos"
on public.cliente_documento_arquivos
for insert
to authenticated
with check (
  public.is_admin_user()
  or exists (
    select 1
    from public.clientes c
    where c.id = cliente_documento_arquivos.cliente_id
      and lower(c.email) = public.current_user_email()
  )
);

drop policy if exists "Admin avalia arquivos de documentos" on public.cliente_documento_arquivos;
create policy "Admin avalia arquivos de documentos"
on public.cliente_documento_arquivos
for update
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

drop policy if exists "Admin remove arquivos de documentos" on public.cliente_documento_arquivos;
create policy "Admin remove arquivos de documentos"
on public.cliente_documento_arquivos
for delete
to authenticated
using (public.is_admin_user());

notify pgrst, 'reload schema';

drop policy if exists "Qualquer pessoa pode ver imagens de obras" on storage.objects;
create policy "Qualquer pessoa pode ver imagens de obras"
on storage.objects
for select
using (bucket_id = 'obras');

drop policy if exists "Usuario autenticado envia imagens de obras" on storage.objects;
create policy "Usuario autenticado envia imagens de obras"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'obras'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Usuario autenticado atualiza imagens de obras" on storage.objects;
create policy "Usuario autenticado atualiza imagens de obras"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'obras'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'obras'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Usuario autenticado remove imagens de obras" on storage.objects;
create policy "Usuario autenticado remove imagens de obras"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'obras'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Cliente ve documentos de tickets" on storage.objects;
create policy "Cliente ve documentos de tickets"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'cliente-documentos'
  and (
    public.is_admin_user()
    or exists (
      select 1
      from public.clientes c
      where c.id::text = (storage.foldername(name))[1]
        and lower(c.email) = public.current_user_email()
    )
  )
);

drop policy if exists "Cliente envia documentos de tickets" on storage.objects;
create policy "Cliente envia documentos de tickets"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'cliente-documentos'
  and (
    public.is_admin_user()
    or exists (
      select 1
      from public.clientes c
      where c.id::text = (storage.foldername(name))[1]
        and lower(c.email) = public.current_user_email()
    )
  )
);

drop policy if exists "Admin remove documentos de tickets" on storage.objects;
create policy "Admin remove documentos de tickets"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'cliente-documentos'
  and public.is_admin_user()
);

-- Espelhamento temporario de tickets do SharePoint.
-- O SharePoint fica como fonte oficial; o Supabase guarda apenas cache e fila de sincronizacao.

create table if not exists public.sharepoint_ticket_cache (
  id uuid primary key default gen_random_uuid(),
  sharepoint_item_id text not null unique,
  ticket_codigo text,
  supabase_ticket_id uuid,
  cliente_id uuid references public.clientes(id) on delete set null,
  cliente_nome text,
  cliente_email text not null,
  titulo text not null,
  status text not null default 'Ativo',
  ultima_acao_por text,
  ultima_mensagem text,
  sharepoint_created_at timestamptz,
  sharepoint_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sharepoint_ticket_movimentacoes_cache (
  id uuid primary key default gen_random_uuid(),
  sharepoint_item_id text not null unique,
  sharepoint_ticket_item_id text,
  supabase_ticket_id uuid,
  supabase_mensagem_id uuid,
  ticket_codigo text,
  cliente_email text not null,
  autor_tipo text not null default 'cliente',
  autor_nome text,
  tipo_evento text not null default 'mensagem',
  mensagem text,
  status_novo text,
  arquivo_nome text,
  arquivo_path text,
  arquivo_url text,
  sharepoint_created_at timestamptz,
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sharepoint_ticket_outbox (
  id uuid primary key default gen_random_uuid(),
  acao text not null,
  status text not null default 'pendente',
  cliente_id uuid references public.clientes(id) on delete set null,
  cliente_nome text,
  cliente_email text not null,
  ticket_codigo text,
  sharepoint_ticket_item_id text,
  titulo text,
  mensagem text,
  autor_tipo text not null default 'cliente',
  autor_nome text,
  arquivo_temp_path text,
  arquivo_nome text,
  arquivo_signed_url text,
  payload jsonb not null default '{}'::jsonb,
  erro text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sharepoint_ticket_outbox
  drop constraint if exists sharepoint_ticket_outbox_acao_check;
alter table public.sharepoint_ticket_outbox
  add constraint sharepoint_ticket_outbox_acao_check
  check (acao in ('criar_ticket', 'responder_ticket', 'alterar_status'));

alter table public.sharepoint_ticket_outbox
  drop constraint if exists sharepoint_ticket_outbox_status_check;
alter table public.sharepoint_ticket_outbox
  add constraint sharepoint_ticket_outbox_status_check
  check (status in ('pendente', 'processando', 'sincronizado', 'erro'));

alter table public.sharepoint_ticket_outbox
  drop constraint if exists sharepoint_ticket_outbox_autor_tipo_check;
alter table public.sharepoint_ticket_outbox
  add constraint sharepoint_ticket_outbox_autor_tipo_check
  check (autor_tipo in ('cliente', 'empresa', 'sistema'));

create index if not exists sharepoint_ticket_cache_email_idx
on public.sharepoint_ticket_cache (lower(cliente_email));

create index if not exists sharepoint_ticket_cache_codigo_idx
on public.sharepoint_ticket_cache (ticket_codigo);

create index if not exists sharepoint_ticket_mov_cache_email_idx
on public.sharepoint_ticket_movimentacoes_cache (lower(cliente_email));

create index if not exists sharepoint_ticket_mov_cache_codigo_idx
on public.sharepoint_ticket_movimentacoes_cache (ticket_codigo);

create index if not exists sharepoint_ticket_outbox_status_idx
on public.sharepoint_ticket_outbox (status, created_at);

drop trigger if exists sharepoint_ticket_cache_set_updated_at on public.sharepoint_ticket_cache;
create trigger sharepoint_ticket_cache_set_updated_at
before update on public.sharepoint_ticket_cache
for each row
execute function public.set_updated_at();

drop trigger if exists sharepoint_ticket_mov_cache_set_updated_at on public.sharepoint_ticket_movimentacoes_cache;
create trigger sharepoint_ticket_mov_cache_set_updated_at
before update on public.sharepoint_ticket_movimentacoes_cache
for each row
execute function public.set_updated_at();

drop trigger if exists sharepoint_ticket_outbox_set_updated_at on public.sharepoint_ticket_outbox;
create trigger sharepoint_ticket_outbox_set_updated_at
before update on public.sharepoint_ticket_outbox
for each row
execute function public.set_updated_at();

alter table public.sharepoint_ticket_cache enable row level security;
alter table public.sharepoint_ticket_movimentacoes_cache enable row level security;
alter table public.sharepoint_ticket_outbox enable row level security;

grant select on table public.sharepoint_ticket_cache to authenticated;
grant select on table public.sharepoint_ticket_movimentacoes_cache to authenticated;
grant select, insert on table public.sharepoint_ticket_outbox to authenticated;
grant update, delete on table public.sharepoint_ticket_outbox to authenticated;

drop policy if exists "Cliente ve cache de tickets do SharePoint" on public.sharepoint_ticket_cache;
create policy "Cliente ve cache de tickets do SharePoint"
on public.sharepoint_ticket_cache
for select
to authenticated
using (
  public.is_admin_user()
  or lower(cliente_email) = public.current_user_email()
);

drop policy if exists "Admin gerencia cache de tickets do SharePoint" on public.sharepoint_ticket_cache;
create policy "Admin gerencia cache de tickets do SharePoint"
on public.sharepoint_ticket_cache
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

drop policy if exists "Cliente ve movimentacoes do SharePoint" on public.sharepoint_ticket_movimentacoes_cache;
create policy "Cliente ve movimentacoes do SharePoint"
on public.sharepoint_ticket_movimentacoes_cache
for select
to authenticated
using (
  public.is_admin_user()
  or lower(cliente_email) = public.current_user_email()
);

drop policy if exists "Admin gerencia movimentacoes do SharePoint" on public.sharepoint_ticket_movimentacoes_cache;
create policy "Admin gerencia movimentacoes do SharePoint"
on public.sharepoint_ticket_movimentacoes_cache
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

drop policy if exists "Cliente acompanha sua fila SharePoint" on public.sharepoint_ticket_outbox;
create policy "Cliente acompanha sua fila SharePoint"
on public.sharepoint_ticket_outbox
for select
to authenticated
using (
  public.is_admin_user()
  or lower(cliente_email) = public.current_user_email()
);

drop policy if exists "Cliente cria acao para SharePoint" on public.sharepoint_ticket_outbox;
create policy "Cliente cria acao para SharePoint"
on public.sharepoint_ticket_outbox
for insert
to authenticated
with check (
  public.is_admin_user()
  or lower(cliente_email) = public.current_user_email()
);

drop policy if exists "Admin gerencia fila SharePoint" on public.sharepoint_ticket_outbox;
create policy "Admin gerencia fila SharePoint"
on public.sharepoint_ticket_outbox
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());
