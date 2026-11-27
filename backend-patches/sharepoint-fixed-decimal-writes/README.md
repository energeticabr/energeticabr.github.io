# Envio de decimais ao SharePoint

O adaptador SharePoint envia números no JSON em formato decimal, com o
mesmo valor e tipo. Nomes de propriedades, comentários, datas, anexos
binários e pré-condições de escrita seguem o contrato dos clientes.
O portal usa a mesma regra na serialização para REST e Microsoft Graph.

No diretório privado de implantação da VM, coloque este pacote, o arquivo
`../sharepoint-decimal-readback/deploy.py` como `shared_rollout.py`, e os
testes `test_decimal_readback.py` e `test_dates.py` dos pacotes anteriores.
Execute `deploy.py --check` e `deploy.py --apply` com o Python do serviço.
A implantação verifica os hashes nas duas origens e executa as
regressões de escrita, leitura e data antes da instalação.
