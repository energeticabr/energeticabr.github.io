# Retirada da trava de postagem de 10 MB

O aplicativo recebe arquivos de até 60 MB, e a entrada do fluxo também limita o conjunto a 60 MB e 20 anexos. O limite agregado de postagem de 10 MB herdado do PowerApps não é aplicado. A função compartilhada retorna um sentinela acima de qualquer conjunto aceito na entrada; o `max_total_attachment_bytes` antigo é removido da configuração. Os limites técnicos de entrada permanecem como estavam.

A compactação por arquivo continua opcional, com os quatro níveis solicitados. Conversas que ainda aguardam o consentimento obrigatório antigo retornam à revisão, preservando bytes e nomes originais. Essa recuperação não submete documentos nem abandona o formulário. Arquivos temporários ausentes ainda exigem reenvio.

O instalador opera em uma cópia plana contendo `workflow.py` e `workflow_config.json`, valida todas as âncoras antes de gravar e mantém backup. Não inclui dados da configuração de produção no Git. A implantação cria novo backup, confere hashes antes e depois e reinicia a ponte usada por web, iOS e Android.

```sh
python install.py /tmp/posting-limit/source --check
python install.py /tmp/posting-limit/source
POSTING_LIMIT_SOURCE=/tmp/posting-limit/source python test_posting_limit.py
```
