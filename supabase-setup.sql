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

alter table public.cliente_tickets add column if not exists codigo text;
alter table public.cliente_tickets add column if not exists status text not null default 'Aberto';
alter table public.cliente_tickets add column if not exists updated_at timestamptz not null default now();
alter table public.cliente_ticket_mensagens add column if not exists autor_tipo text not null default 'cliente';
alter table public.cliente_ticket_mensagens add column if not exists arquivo_url text;
alter table public.cliente_ticket_mensagens add column if not exists arquivo_path text;
alter table public.cliente_ticket_mensagens add column if not exists arquivo_nome text;

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

create or replace function public.normalize_ticket_message_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin_user() then
    new.autor_tipo := 'empresa';
  else
    new.autor_tipo := 'cliente';
  end if;

  return new;
end;
$$;

drop trigger if exists ticket_message_author on public.cliente_ticket_mensagens;
create trigger ticket_message_author
before insert on public.cliente_ticket_mensagens
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

grant usage on schema public to anon, authenticated;
grant insert on table public.leads to anon;
grant select, update, delete on table public.leads to authenticated;
grant insert on table public.clientes to anon;
grant select, insert, update, delete on table public.clientes to authenticated;
grant select, insert, update, delete on table public.cliente_comunicacoes to authenticated;
grant select, insert, update, delete on table public.cliente_tickets to authenticated;
grant select, insert, update, delete on table public.cliente_ticket_mensagens to authenticated;
grant execute on function public.current_user_email() to authenticated;
grant execute on function public.is_admin_user() to authenticated;

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
