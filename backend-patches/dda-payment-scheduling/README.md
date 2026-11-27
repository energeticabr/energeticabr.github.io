# Agendamento de boletos na galeria DDA

A rota do portal usa a identidade Microsoft e a lista privada de operadores DDA.
O banco recebe a ordem pelo servidor. A galeria usa a credencial de consulta
existente para conferir o boleto enquanto o escopo de inclusão estiver indisponível.

Para habilitar o envio, configure uma aplicação PJ dedicada no Portal Developers
Sicoob com os escopos `pagamentos_consulta` e `pagamentos_inclusao` da API
Cobrança Bancária Pagamentos. O titular da conta deve concluir a autorização que
o Sicoob solicitar. Use o certificado da mesma empresa já instalado no coletor.

Salve os campos `clientId`, `cnpj`, `accountNumber`, `cooperative` e
`apiVersion` em `sicoob-payments-credentials.dpapi` no diretório privado do
coletor com a função `Write-PrivateJson` de `DdaPlatform.ps1`, executada como
`energetica-whatsapp`. Confirme a versão liberada para a nova credencial antes
de habilitá-la. A integração atual de consulta usa `v3`. Preserve o client ID
e a versão das ordens pendentes até confirmar os respectivos resultados.

O diário em `/var/lib/energetica-whatsapp/dda-payment-scheduling/orders.sqlite3`
registra a ordem antes da chamada ao banco. Uma confirmação incerta só dispara
consulta pelo mesmo identificador idempotente. O monitor DDA continua
responsável por reconciliar o estado bancário na lista SharePoint.

Na VPS, execute `deploy.py --check --live-base HASH --mirror-base HASH
--package-sha HASH` e depois repita sem `--check`. Os hashes são SHA-256 dos
dois arquivos `channel_bridge.py` instalados e dos bytes concatenados de
`dda_payment_scheduling.py` e `Invoke-DdaPaymentScheduling.ps1`, nessa ordem.
O instalador testa o pacote, usa a trava de implantação existente, guarda as
versões anteriores, valida a saúde do serviço e restaura os arquivos se falhar.
