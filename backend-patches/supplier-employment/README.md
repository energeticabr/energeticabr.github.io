# Vínculo e cargo no cadastro de fornecedor

O fluxo compartilhado de cadastro de fornecedor (menu, lançamentos, cotações e pagamentos) solicita VINCULO quando EMPREITEIRO = SIM. As opções fechadas são CLT, TERCEIRIZADO e INFORMAL. Apenas CLT solicita CARGO, com os sete níveis definidos pelo usuário. A base FORNECEDORES já contém VINCULO e CARGO como texto.

O patch adiciona duas etapas e dois campos ao resumo. Campos sem aplicação são descartados antes da gravação. A edição de EMPREITEIRO e VINCULO usa as dependências transitivas existentes. Cadastros anteriores mantêm o significado do índice da etapa; os dados novos são conferidos antes de qualquer gravação de fornecedor.

O script apply_patch.py exige os hashes exatos da versão vigente e verifica que nenhuma outra configuração mudou. O deploy.sh valida cópias de produção e build separadamente, usa trava, confere os hashes antes de instalar, preserva backups e recupera os arquivos e serviços se a publicação falhar.

Os testes usam o motor real com todos os serviços externos em memória. Nenhum teste cadastra um fornecedor no SharePoint. A alteração do servidor é recebida pelo Android, iOS e Windows existentes.

Execução: preparar estágio /home/opc/supplier-employment-* com scripts e source/tests/test_workflow.py, executar bash deploy.sh com o estágio e validate; depois apply. Não contornar falhas de baseline.
