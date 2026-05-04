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

grant usage on schema public to anon, authenticated;
grant insert on table public.leads to anon;
grant select, update, delete on table public.leads to authenticated;

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
