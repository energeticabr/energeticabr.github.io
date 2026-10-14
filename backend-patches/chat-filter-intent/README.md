# Filtro digitado não seleciona IDs

`patch_workflow.py` acrescenta ao `_handle_selection_reply` um comando explícito
`filter_query`. O texto vai diretamente a `filter_options` e jamais a
`resolve_option`. Respostas digitadas por versões antigas do app, sem
`reply_id`, também deixam de escolher opções por coincidência com ID; os
botões continuam a enviar o `reply_id` real e a selecionar normalmente.

O patch lê o `workflow.py` vigente e grava um candidato separado, sem alterar
o original. Antes da instalação, executar `py_compile` e
`test_filter_intent.py CANDIDATE`. `deploy.py` verifica os hashes, salva as
cópias do aplicativo e da árvore de build, instala o candidato preservando
dono/grupo/permissões, reinicia os dois serviços e confere os endpoints de
saúde. Em caso de falha, restaura ambas as cópias e verifica o retorno dos
serviços. O backup é mantido para eventual recuperação posterior.
