# Exclusão de pedido sem lançamentos

Ao excluir um lançamento pela Galeria de Lançamentos, o servidor usa o ID
armazenado em `LANCAMENTOS.AGRUPAR`. Depois da exclusão, consulta os vínculos
ativos com esse ID. Se ainda existir um, preserva o pedido. Se a consulta
terminar vazia, exclui apenas o item correspondente em `NOTASPENDENTES` com
a versão lida antes da exclusão do lançamento. Se não conseguir concluir a
verificação ou houver conflito de versão, informa que a exclusão do pedido não
foi confirmada. Rótulos de agrupamento não são IDs de pedido.

A regra atende Android, iOS e Windows/web pelo mesmo servidor. Ela é executada
quando o app exclui o lançamento; a notificação de exclusão direta do SharePoint
não fornece o campo personalizado `AGRUPAR`. As listas são distintas e o
SharePoint não oferece transação entre a consulta dos vínculos e a exclusão.

`test_delete_launch.py` usa o serviço real com a fronteira SharePoint simulada.
Defina `GALLERY_SOURCE` para o diretório pai do `worker/` que será testado e
`GALLERY_FIXTURES` para o diretório das fixtures privadas `test_launch_gallery.py`.
Aplique `source.patch` às duas origens pinadas via `patch_backend.py`.

`python -B package.py <new-stage>` verifica cada arquivo e gera um pacote para
o instalador existente. `deploy.sh` exige a cópia root-owned em
`/var/lib/energetica-deploy/launch-order-cleanup-20261111` e o hash do
manifesto. Ele valida os dois baselines separadamente, faz backup, drena
as requisições durante o restart e verifica os serviços antes de concluir.
