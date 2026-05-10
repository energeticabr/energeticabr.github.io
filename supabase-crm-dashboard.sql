create table if not exists public.site_visitas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  visitor_id text,
  session_id text,
  pagina text,
  titulo text,
  referrer text,
  origem text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  idioma text,
  user_agent text,
  largura_tela integer,
  altura_tela integer
);

alter table public.site_visitas enable row level security;

drop policy if exists "Registrar visitas anonimas" on public.site_visitas;
create policy "Registrar visitas anonimas"
on public.site_visitas
for insert
to anon, authenticated
with check (true);

drop policy if exists "Ler visitas autenticado" on public.site_visitas;
create policy "Ler visitas autenticado"
on public.site_visitas
for select
to authenticated
using (true);

create index if not exists site_visitas_created_at_idx on public.site_visitas (created_at desc);
create index if not exists site_visitas_visitor_idx on public.site_visitas (visitor_id);
create index if not exists site_visitas_pagina_idx on public.site_visitas (pagina);
