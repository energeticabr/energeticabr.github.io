# Baixa agrupada com fornecedores diferentes

A tentativa observada foi recusada antes da primeira gravação: cinco provisões
da mesma filial têm cinco fornecedores. O coordenador exige um fornecedor único
para converter todas as linhas em um pedido. A mensagem genérica esconde a causa.

Manter uma única confirmação de baixa e a etapa comum. Quando houver conversão
em lançamentos, criar um pedido para cada combinação de fornecedor e filial,
somando somente as respectivas linhas pendentes. Cada lançamento e provisão
apontam para seu próprio pedido. Grupos homogêneos preservam a chave e o journal
existentes. O resumo informa quantos pedidos serão criados.

Congelar intenções, associação das linhas e valores no journal antes de criar
pedidos. Retomadas verificam pedidos existentes e não repetem linhas concluídas.
Não permitir troca de fornecedor/filial no rascunho, pedidos preexistentes
conflitantes, alteração concorrente, confirmação incompleta ou anexos alterados.

Runtime Python compartilhado por Android, iOS e Windows/web; nenhuma alteração
de assinatura, credenciais, esquema ou recurso bancário. Dados reais, arquivos
completos e evidências privadas ficam fora do repositório público. Implantação
com hashes por raiz, backup, exclusão mútua, saúde e rollback.
