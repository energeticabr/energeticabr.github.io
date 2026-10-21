# Diário: progresso da preparação dos anexos

Complemento opcional para o protocolo de chat. A consulta
`{"action":"diary_evidence_progress","requestId":"<messageId>"}` exige a mesma
autenticação Microsoft e retorna apenas requestId/percent/stage/status.
Não toma o lock da conversa e não executa eventos nem cria registros.

O app habilita `trackDiaryEvidence:true` exclusivamente ao finalizar anexos
de um diário. `diary_progress.py` usa ContextVar e um registro de até 256
operações, com expiração em 30 minutos desde o último avanço. O usuário é o
oid verificado pelo autenticador Graph; tid também separa a chave quando
fornecido. Não há nomes, caminhos ou arquivos na telemetria.

Percentual por etapas concluídas: fotos até 75, PDF 80, consolidação/união 90,
páginas unidas/comprimidas até 98,
próxima pergunta pronta 99. Tentativas adicionais não fazem regredir.
100 é emitido apenas depois da finalização e preparação da resposta pública.
Não é uma estimativa de tempo restante ou de bytes transmitidos.

## Verificar e preparar

```powershell
$env:DIARY_PROGRESS_BASE = '<cópia atual das fontes da VM>'
python -m unittest discover -s backend-patches/diary-attachment-progress -p 'test*.py'
python backend-patches/diary-attachment-progress/patch_backend.py '<fontes>' '<candidato>'
```

Os testes incluem o builder real e o método HTTP real das fontes copiadas,
com mídia/identidade sintéticas e sem chamadas ao SharePoint. Sem a variável,
somente testes independentes de registro são executados. A aplicação do patch
recusa âncoras ausentes/duplicadas e compila os três arquivos antes de gravá-los.

Na VM: preservar checksums das fontes, comparar imediatamente antes da troca,
guardar backup dos três arquivos, instalar o módulo novo na raiz do serviço,
validar testes/compilação e reiniciar somente a ponte. Rollback restaura os
três arquivos do backup e reinicia a ponte; o módulo opcional pode permanecer.
Nenhuma alteração em dados de diário ou anexos existentes é necessária.

`deploy.sh` bloqueia temporariamente novas conexões locais não-root à porta
8765 e aguarda até 30 segundos pelas requisições existentes, mantendo a exclusão
até a troca/reinício/verificação. A autenticação e as demais portas não mudam.
Sondas root continuam liberadas. Trap remove a regra; um watchdog independente
a remove em até 120 segundos se a sessão for terminada abruptamente. Os testes
do gate executam o shell real com comandos de sistema simulados, sem tocar no
firewall.
