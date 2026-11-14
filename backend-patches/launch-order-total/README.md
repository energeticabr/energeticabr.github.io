# Sincronização de totais dos pedidos

Depois de alterar quantidade, valor unitário, frete ou vínculo pela Galeria de
Lançamentos, o servidor recalcula o pedido identificado em `AGRUPAR`. O mesmo
ocorre ao excluir uma linha quando ainda há outras vinculadas. A exclusão
condicional do pedido quando a última linha é removida mantém a regra existente.

A consulta pagina apenas os lançamentos ativos do pedido. O servidor soma
quantidade × unitário + frete com Decimal, arredonda a soma em centavos e grava
`NOTASPENDENTES.VALORTOTAL` como texto com separador decimal brasileiro.
Descontos e acréscimos rateados já entram nos valores unitários. Quando a
observação contém um único bloco automático coerente, só o bruto e o líquido
do bloco são atualizados; a quantia do ajuste e o texto manual são preservados.

A gravação usa ETag, repete conflitos com uma nova leitura dos lançamentos e
confirma o resultado no SharePoint. Uma falha parcial informa que o lançamento
foi salvo ou excluído e identifica o pedido cujo total não foi confirmado.
As duas listas não têm transação compartilhada. A sincronização ocorre nas
operações da Galeria do Energético; não intercepta edições diretas no SharePoint.

Execute `test_order_total.py` com `GALLERY_SOURCE` e `GALLERY_FIXTURES` como
no pacote anterior. O servidor atende Android, iOS e Windows/web. Para publicar,
execute `python -B package.py <new-stage>` e instale com o gate de
`deploy.sh`, que valida os dois baselines, faz backup e confirma a saúde dos
serviços. Código integral do servidor e dados de produção ficam fora do Git.
