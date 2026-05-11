alter table public.cliente_ticket_mensagens
add column if not exists autor_nome text;

alter table public.cliente_comunicacao_respostas
add column if not exists autor_nome text;

update public.cliente_ticket_mensagens mensagem
set autor_nome = cliente.nome
from public.cliente_tickets ticket
join public.clientes cliente on cliente.id = ticket.cliente_id
where mensagem.ticket_id = ticket.id
  and lower(coalesce(mensagem.autor_tipo, 'cliente')) = 'cliente'
  and coalesce(mensagem.autor_nome, '') = '';

update public.cliente_comunicacao_respostas resposta
set autor_nome = cliente.nome
from public.cliente_comunicacoes comunicacao
join public.clientes cliente on cliente.id = comunicacao.cliente_id
where resposta.comunicacao_id = comunicacao.id
  and lower(coalesce(resposta.autor_tipo, 'cliente')) = 'cliente'
  and coalesce(resposta.autor_nome, '') = '';

update public.cliente_ticket_mensagens
set autor_nome = 'Energética'
where lower(coalesce(autor_tipo, '')) = 'empresa'
  and coalesce(autor_nome, '') = '';

update public.cliente_comunicacao_respostas
set autor_nome = 'Energética'
where lower(coalesce(autor_tipo, '')) = 'empresa'
  and coalesce(autor_nome, '') = '';
