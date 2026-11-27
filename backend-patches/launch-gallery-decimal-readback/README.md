# Valores numéricos na Galeria de Lançamentos

A galeria calcula os totais e indexa a busca a partir dos números lidos
do SharePoint. Números desserializados de JSON podem ser representados em
notação científica. A conversão direta para Decimal preserva o valor e
mantém o arredondamento monetário, a validação de valores finitos e os
formatos aceitos para texto digitado.

Os testes usam o serviço real com a fixture do SharePoint. Cobrem a galeria,
o detalhe, a busca pelo frete e a rejeição de números inválidos na edição.

Para publicar, coloque os arquivos deste pacote, a fixture instalada
`tests/test_launch_gallery.py` e `../sharepoint-decimal-readback/deploy.py`
(com o nome `shared_rollout.py`) em um diretório privado na VM. Execute
`deploy.py --check` e depois `deploy.py --apply` com o Python da aplicação.
O instalador verifica os dois hashes de origem, executa os testes em cada
candidato e restaura os arquivos se o serviço falhar ao reiniciar.

A correção é do servidor usado por Android, iOS e Windows/web.
