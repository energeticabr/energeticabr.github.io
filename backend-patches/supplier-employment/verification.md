# Verificação do cadastro de fornecedor

Em 05/10/2026, VINCULO e CARGO foram verificados na lista FORNECEDORES como colunas existentes de texto. Nenhuma coluna foi criada.

O motor real passou 10 testes específicos nas cópias de produção e de build. Os testes cobrem opções fechadas, os sete cargos, os quatro contextos de cadastro, limpeza de campos sem aplicação, confirmação legada, edição legada e cadastro completo com gravação em serviços exclusivamente em memória.

A comparação de 570 testes legados apresentou 105 falhas, 33 erros e 1 skip na baseline; 108 falhas, 34 erros e 1 skip no candidato. Os únicos quatro casos adicionais são testes antigos de fornecedor que esperam a lista antiga de campos e o salto direto para homologação, sem as duas perguntas novas. Todos os casos de falha anteriores foram preservados. A suíte legada não está verde; os testes novos verificam a sequência atual e a gravação.

Revisão independente encontrou migração tardia de índices no menu de edição de cadastro antigo. A correção migra antes de gerar e consumir opções e preserva os IDs enviados. Os dois casos reproduziram o erro antes da correção e passaram depois; a revisão da correção não encontrou novos problemas.

Publicação verificada em produção e build, com backup e rollback preparado, ambos os serviços ativos e /health respondendo ok.

Hashes publicados:

- worker/workflow.py: f4c323ee795dfee1a4b0e3e126acc0dfb04378fa7c927bdd4075248e9a66f675
- worker/workflow_config.json: a879e92f54d5cf43e31bc07190dd557a91659ebdd6bd9478b07c44f872066ccb

A verificação da trava de gestos confirmou os 14 blocos intactos.

No aplicativo real conectado à VM, a 390 × 844, EMPREITEIRO = SIM apresentou os três vínculos e CLT apresentou os sete cargos. TERCEIRIZADO e INFORMAL avançaram para homologação sem cargo; NÃO avançou sem vínculo e sem cargo. O teste foi encerrado antes da confirmação, sem cadastrar fornecedor no SharePoint. Capturas locais de vínculo e cargo foram preservadas para o usuário.
