alter table public.cliente_documentos_solicitados
add column if not exists aprovado_por text;

alter table public.cliente_documento_arquivos
add column if not exists aprovado_por text;

update public.cliente_documentos_solicitados
set aprovado_por = 'Energética'
where lower(coalesce(status, '')) = 'aprovado'
  and coalesce(aprovado_por, '') = '';

update public.cliente_documento_arquivos
set aprovado_por = 'Energética'
where lower(coalesce(status, '')) = 'aprovado'
  and coalesce(aprovado_por, '') = '';
