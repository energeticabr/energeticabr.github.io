# Filiais permitidas na provisão de pagamento

A pergunta FILIAL nos fluxos `payment`, `payment_provision_edit` e `payment_settlement` mostra somente as filiais de código **000** e **004**. Não oferece EM BRANCO. Os IDs originais do cadastro são preservados; a verificação usa o código do valor cadastrado, não o ID do item nem o rótulo visual.

O servidor consulta novamente o catálogo antes de aceitar respostas, pesquisas e atualizações. Assim, opções antigas ou adulteradas não permitem selecionar uma filial fora dessa lista. Cadastros de documentos, fornecedores, lançamentos e outras perguntas permanecem inalterados. Não há alteração de registros financeiros já existentes.

## Verificação

`tests/test_allowed_branches.py` executa o WorkflowEngine real com catálogo, armazenamento e fronteira SharePoint sintéticos. Cobre seleção única/múltipla, edição/baixa por descritivo, pesquisa, limpar filtro, atualização, opções antigas e isolamento de outros fluxos. Reutiliza também a regressão de frete no primeiro item.

`test_bundle.py` e `test_deploy.py` verificam o pacote privado, hashes, escopo, aliases, rollback, lock e gate de entrada sem acessar dados do tenant. Rodar ambos com `python -B -m unittest discover -s backend-patches/provision-allowed-branches -v`; para os testes do motor, definir `ENERGETICA_BACKEND_TEST_ROOT` para um snapshot privado compatível e executar a descoberta em `tests/`.

## Publicação

A regra fica no servidor comum ao Android, iOS e Windows/web; não exige reinstalar os aplicativos nem publicar novos binários nativos.

Usar `package.py PRIVATE_WORKSPACE` com `baseline/` e `candidate/` da revisão verificada. O código privado e `source-files.tar` não entram no Git. Preparar o diretório `/home/opc/provision-allowed-branches-20261022/release`, executar `deploy.py --check SHA_DO_MANIFESTO` e depois `deploy.sh SHA_DO_MANIFESTO` como root. O instalador faz backup, bloqueia novas conexões brevemente, drena as existentes, substitui somente `worker/workflow.py` por CAS e verifica serviço, saúde e hashes; em caso de falha restaura o original. O espelho de build é somente leitura.
