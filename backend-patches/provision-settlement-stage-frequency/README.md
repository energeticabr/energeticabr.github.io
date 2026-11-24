# Frequência de etapas na baixa de pagamento

A seleção `payment_settlement/etapa_baixa` apresenta primeiro as etapas mais usadas nos 100 maiores IDs de `LANCAMENTOS`. O ranking conta o campo `ETAPA`, normaliza os nomes, mantém a ação `NOVA_ETAPA_BAIXA_PROVISAO` no topo e preserva a ordem do catálogo nos empates. Opções sem uso continuam disponíveis. Linhas sem etapa ocupam posição na janela de 100, mas não pontuam.

A regra estende o helper existente e não altera `launch/etapa_lancamento`. O histórico é consultado a cada abertura da seleção. Se a consulta falhar, a lista original permanece disponível. O cálculo não grava lançamentos, provisões, anexos nem rascunhos.

O aplicativo encaminha `/api/portal-chat` ao serviço compartilhado `energetica-channel-bridge.service`; a alteração atende web/Windows, Android e iOS sem novos bundles. O pacote altera somente `/opt/energetica-whatsapp/worker/workflow.py`. O mirror `/home/opc/energetica-build/worker/workflow.py` é fixado como baseline somente leitura e nunca sincronizado.

## Preparação

Manter cópias privadas do arquivo ativo em `baseline/worker/workflow.py` e `candidate/worker/workflow.py`; aplicar `patch_backend.py` somente ao candidato. Esses arquivos completos permanecem fora do repositório. Colocar o `deploy.py` de `backend-patches/launch-payroll-per-payment` ao lado da pasta da mudança, em `launch-payroll-per-payment/deploy.py`, para fornecer o runner compartilhado. Gerar o pacote:

```powershell
python -B package.py --baseline <baseline> --candidate <candidate> --stage /home/opc/provision-settlement-stage-frequency-20261124-r2/release
```

Enviar apenas o conteúdo de `<release-local>` para `/home/opc/provision-settlement-stage-frequency-20261124-r2/release`.

## Publicação

O `deploy-bootstrap.sh` fica fora do pacote de upload. Instalar uma cópia do checkout revisado em um caminho root-owned que `opc` não possa alterar. Não executar como root um script vindo da pasta de upload. Exemplo no servidor de publicação:

```sh
sudo install -o root -g root -m 0755 \
  <checkout-revisado>/backend-patches/provision-settlement-stage-frequency/deploy-bootstrap.sh \
  /usr/local/sbin/provision-settlement-stage-frequency-deploy
```

Conferir o hash do launcher instalado contra o checkout revisado e confirmar que o dono é root e o modo não permite escrita por grupo/outros. Depois, executar:

```sh
sudo -n /usr/local/sbin/provision-settlement-stage-frequency-deploy \
  /home/opc/provision-settlement-stage-frequency-20261124-r2/release \
  <SHA256_DO_MANIFESTO>
```

O launcher autentica o manifesto e copia os arquivos do pacote para um snapshot root-owned em `/run`; confere cada hash antes de executar código do pacote. O carregador verifica e executa os mesmos bytes lidos. Um lock de transação herdado pelo launcher, pelo Python e pelo comando de reinício mantém o watchdog ativo até instalação ou rollback terminar. O watchdog é armado antes do bloqueio do ingress e repete a remoção da regra até confirmar que ela saiu. A implantação compila o candidato, adquire também o lock compartilhado, bloqueia novas requisições do bridge e espera o esvaziamento antes de instalar atomicamente. Mantém backup recuperável, reinicia o bridge, confirma que o worker WhatsApp continua ativo e espera até 60 segundos pela saúde local após cold start. Se houver falha, restaura o arquivo, reinicia o bridge e espera a saúde da versão restaurada antes de liberar o tráfego. O mirror é apenas verificado.

Após o deploy, confirmar também `https://163-176-171-217.sslip.io/health` e os hashes ativos de produção e do mirror; registrar o recibo antes de concluir.
