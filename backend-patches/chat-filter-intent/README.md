# Filtro digitado não seleciona IDs

`patch_workflow.py` acrescenta ao `_handle_selection_reply` um comando explícito
`filter_query`. O texto vai diretamente a `filter_options` e jamais a
`resolve_option`. Respostas digitadas por versões antigas do app, sem
`reply_id`, também deixam de escolher opções por coincidência com ID; os
botões continuam a enviar o `reply_id` real e a selecionar normalmente.

O patch lê o `workflow.py` vigente e grava um candidato separado, sem alterar
o original. Antes da instalação, executar `py_compile` e
`test_filter_intent.py CANDIDATE`. Fazer backup do arquivo vigente, verificar
seu hash novamente e instalar o candidato preservando dono/grupo/permissões.
Reiniciar os serviços do fluxo e conferir saúde e hash instalado. Para voltar,
restaurar somente o backup desta implantação e reiniciar os mesmos serviços.
