# Pagamentos pendentes de IDFOLHA

O relatório cruza lançamentos pagos com vínculos diretos, linhas antigas de FOLHAPGTO e vínculos por provisão. Cada nova aplicação grava uma linha identificada no Title de FOLHAPGTO, com o IDLANCAMENTO de origem e o IDFOLHA de destino. O saldo usa centavos e inclui o frete conforme o total do lançamento. O cálculo e a conferência de gravação ficam no servidor.

A galeria e o fluxo do WhatsApp usam a mesma identidade do serviço, o mesmo diretório de estado local e o mesmo bloqueio por lançamento para gravar vínculos. O diário de gravação permite retomar a confirmação após uma falha de rede e impede outra gravação enquanto o resultado anterior estiver incerto. O fluxo antigo apresenta uma orientação para usar o relatório se a origem já tiver aplicações.

## Instalação

O pacote altera somente `channel_bridge.py` e os arquivos `launch_gallery.py`, `workflow.py` e `payroll_pending.py` no diretório `worker` em produção e no espelho. A instalação verifica os hashes das fontes de cada raiz e do pacote. As cópias para recuperação ficam em `/var/backups/energetica-whatsapp`. Os serviços da ponte e do receptor de webhook são reiniciados. Uma falha de instalação ou saúde restaura os arquivos existentes. O módulo novo pode ficar presente, sem uso, após uma restauração e o mesmo pacote pode ser reaplicado.

1. Capture as versões atuais da produção e do espelho em diretórios separados `live/` e `mirror/`, com caminhos relativos `channel_bridge.py`, `worker/launch_gallery.py` e `worker/workflow.py`. Preserve os bytes originais. Os diretórios servem como entrada local e ficam fora do Git.
2. Gere o pacote com `python -B deploy.py --make-package BASELINES OUTPUT` a partir desta pasta. Use um destino novo. Guarde o SHA-256 impresso do manifesto.
3. Envie somente os arquivos gerados e instale-os no diretório `/var/lib/energetica-deploy/payroll-pending` com o proprietário root e permissões 0755 para o diretório e 0644 para os arquivos.
4. Execute `sudo -n /opt/energetica-whatsapp/.venv/bin/python -B /var/lib/energetica-deploy/payroll-pending/deploy.py --check SHA256`. A verificação valida os oito destinos e ambos os serviços, sem instalar código.
5. Execute `sudo -n bash /var/lib/energetica-deploy/payroll-pending/deploy.sh SHA256`. Confira `status: deployed`, os hashes instalados e `health: ok` no recibo.

As regras de negócio são testadas em `tests/test_payroll_pending.py` com os limites externos simulados. Os testes da ponte, da galeria e do worker exercitam os métodos da fonte capturada com `PAYROLL_ROUTER_BASELINE` apontando para uma das duas raízes locais. Execute `python -B -m unittest discover -s backend-patches/payroll-pending -p 'test_*.py' -v` da raiz do repositório, uma vez para cada raiz capturada.
