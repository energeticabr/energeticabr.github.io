# Copiar padrão entre fornecedores

A oferta é vinculada ao rascunho da validação e às presenças já selecionadas. O usuário escolhe outros fornecedores e a cópia altera somente as linhas do rascunho. As opções de descritivo e atividade são verificadas para cada destino antes de qualquer alteração; erro ou seleção inválida não aplica cópia parcial. O envio das presenças e a decisão sobre alterar o cadastro FORNECEDORES permanecem na confirmação final.

O pacote gera os dois candidatos de `workflow.py` a partir de capturas independentes da instalação. O deploy usa hashes, backup, verificação de saúde e rollback. `test_copy.py` usa fixtures em memória e `verify_deployed.py` executa a regressão contra o módulo instalado, sem gravar dados reais.
