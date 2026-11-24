# Frequência de etapas na baixa de pagamento

A seleção `payment_settlement/etapa_baixa` apresenta primeiro as etapas mais usadas nos 100 maiores IDs de `LANCAMENTOS`. O ranking conta o campo `ETAPA`, normaliza os nomes, mantém a ação `NOVA_ETAPA_BAIXA_PROVISAO` no topo e preserva a ordem do catálogo nos empates. Opções sem uso continuam disponíveis. Linhas sem etapa ocupam posição na janela de 100, mas não pontuam.

A regra estende o helper existente e não altera `launch/etapa_lancamento`. O histórico é consultado a cada abertura da seleção. Se a consulta falhar, a lista original permanece disponível. O cálculo não grava lançamentos, provisões, anexos nem rascunhos.

O aplicativo encaminha `/api/portal-chat` ao serviço compartilhado `energetica-channel-bridge.service`; a alteração atende web/Windows, Android e iOS sem novos bundles. O pacote altera somente `/opt/energetica-whatsapp/worker/workflow.py`. O mirror `/home/opc/energetica-build/worker/workflow.py` é fixado como baseline somente leitura e nunca sincronizado.

## Preparação

Manter cópias privadas do arquivo ativo em `baseline/worker/workflow.py` e `candidate/worker/workflow.py`; aplicar `patch_backend.py` somente ao candidato. Esses arquivos completos permanecem fora do repositório. Colocar o `deploy.py` de `backend-patches/launch-payroll-per-payment` ao lado da pasta da mudança, em `launch-payroll-per-payment/deploy.py`, para fornecer o runner compartilhado. Gerar o pacote:

```powershell
python -B package.py --baseline <baseline> --candidate <candidate> --stage /home/opc/provision-settlement-stage-frequency-20261124-r1/release
```

Enviar apenas o conteúdo de `<release-local>` para `/home/opc/provision-settlement-stage-frequency-20261124-r1/release`.

## Publicação

Com o pacote no diretório fixado, executar como root:

```sh
sudo -n bash /home/opc/provision-settlement-stage-frequency-20261124-r1/release/deploy.sh <SHA256_DO_MANIFESTO>
```

O pacote verifica os hashes de produção e do mirror, compila o candidato, adquire o lock compartilhado, bloqueia novas requisições do bridge e aguarda o esvaziamento antes de instalar atomicamente. Mantém backup recuperável, reinicia o bridge e o worker WhatsApp, aguarda até 60 segundos pela saúde local após cold start e faz rollback se houver falha. O mirror é apenas verificado.

Após o deploy, confirmar também `https://163-176-171-217.sslip.io/health` e os hashes ativos de produção e do mirror; registrar o recibo antes de concluir.
