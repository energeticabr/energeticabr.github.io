# Informar valor pendente dentro da baixa de provisão

Correção do fluxo compartilhado pelos clientes Android, iOS e Windows. Não requer nova versão nativa: apenas quatro módulos Python da VM são alterados.

- Descritivos com valor pendente continuam pesquisáveis; a opção orienta **INFORMAR NA BAIXA**.
- Uma única provisão pendente abre diretamente sua revisão de quantidade/valor unitário.
- Várias provisões pendentes apresentam uma escolha filtrável da linha inicial. Todas as linhas pendentes continuam sendo revisadas, sem perder as já baixadas no cálculo do total.
- Ao confirmar, grava o valor da linha e recalcula `DESCRITIVOPROVISAO.VALORTOTAL` como a soma completa de `QTD × VALOR TOTAL + FRETE`. No filho, `VALOR TOTAL` é o valor **unitário** conforme o contrato existente.
- Nenhuma gravação financeira ocorre ao digitar ou escolher a linha: permanece a confirmação final da baixa.
- Mantém ETags, vínculos, anexos e diário durável de retomada. Atualiza o grupo ao selecionar o descritivo, ao escolher a linha e antes de gravar.
- Linha já baixada com valor inválido permanece bloqueada, com identificação e orientação de correção; não assume zero nem altera pagamentos anteriores.

## Validação

110 testes focados passaram: consulta completa/estrita, conversa até confirmação, uma/múltiplas linhas, números brasileiros, total único/agregado, concorrência e retomada após resposta perdida. Um teste histórico que exige o bloqueio dos valores pendentes foi substituído pelos novos contratos.

A suíte ampla foi iniciada e interrompida no processamento de imagens após 216,89 s: **228 passaram e 15 falharam**. Todas as 15 falhas foram reproduzidas no baseline inalterado; portanto, não se declara a suíte completa verde. Nomes e limites em [verification.md](verification.md).

Revisão independente encontrou dois casos importantes, ambos corrigidos com testes RED→GREEN: erro tratável para filho já baixado inválido e atualização da linha após escolha.

## Empacotamento e publicação

`build_bundle.py PRIVATE_WORKSPACE` gera `source.patch`, `deploy-manifest.json` e um `source-files.tar` **privado**, a partir de snapshots `baseline/worker` e `candidate/worker`. Não versionar o bundle nem código/configuração integral, estado, documentos ou credenciais da VM.

`deploy.py --check MANIFEST_SHA256` verifica hashes independentes de produção/espelho, escopo, bundle, compilação e saúde. `--deploy` faz backup recuperável, copia somente os quatro arquivos fixados, reinicia a ponte e verifica saúde/hashes; reverte em falha sem sobrescrever alterações concorrentes. O runner compartilhado reutilizado é fixado por SHA256.

Stage: `/home/opc/provision-settlement-amount-20261017`. Baseline git: `9532fc07`.
