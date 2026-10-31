# Detalhes fiscais na observação da provisão de retenção

## Objetivo

Ao criar automaticamente uma linha em `PROVISÃO PGTOS` para uma retenção fiscal, preencher `OBS` com a razão social do fornecedor, a data e hora de emissão e a descrição do produto ou serviço constante do XML fiscal.

Formato definido:

`RAZÃO SOCIAL: <fornecedor> | EMISSÃO: <dd/MM/aaaa HH:mm> | PRODUTO/SERVIÇO: <descrição>`

Campos ausentes serão representados por `-`, sem impedir a provisão. Para NF-e, a descrição será formada pelos `xProd` de todos os itens, preservando a ordem e separando-os por `; `. Para NFS-e, será usada `DESCRICAO_SERVICO`.

## Integração

- O parser de NF-e extrai as descrições dos itens para um campo transitório `DESCRICAO_ITENS` no lote enviado ao Power Automate.
- O fluxo usa esse campo transitório para NF-e e `DESCRICAO_SERVICO` para NFS-e.
- O campo transitório não altera o schema da galeria fiscal nem exige uma nova coluna SharePoint.
- A regra de elegibilidade, o agrupamento mensal, a data do dia 20, a filial, o status, a idempotência e os valores permanecem inalterados.

## Segurança e limites

O texto vem exclusivamente do XML fiscal validado. O fluxo apenas grava a observação na mesma criação já autorizada; não cria novas chamadas externas nem muda o número de provisões.
