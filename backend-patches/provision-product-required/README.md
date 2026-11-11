# Produto obrigatório em Provisão Pgto

A pergunta de produto passa a oferecer o catálogo e o cadastro de um novo produto. Sessões com a antiga opção zero atualizam a lista ao retomar o rascunho e rejeitam uma resposta já exibida como “Em branco”. Na primeira tentativa de gravação, um rascunho antigo de produto único sem produto retorna ao campo pendente e volta ao resumo após a escolha.

Android, iOS e Windows usam a resposta do mesmo backend. A correção é publicada na VM, sem mudança no código dos clientes.

## Validação e implantação

Execute `test_product_required.py` com o Python da VM e `PROVISION_SOURCE` apontando para o backend. O teste usa conectores em memória. Para verificar candidatos, defina também `PROVISION_CANDIDATE` como o diretório que contém os módulos candidatos e `WORKFLOW_CONFIG_PATH` como a configuração candidata.

O espelho de build tem uma divergência anterior à correção. O módulo de baixa importa `provision_money`, ausente na cópia correspondente de `payment_provision_group.py`. A validação funcional usa o backend que atende os clientes. Os arquivos alterados do espelho passam pela verificação de contexto, compilação e hashes.

Na pasta de implantação protegida em `/var/lib/energetica-deploy`, coloque `deploy.py`, `patch_backend.py`, `deploy-manifest.json` e os arquivos `deploy.py` (renomeado para `shared-deploy.py`) e `deployment_gate.sh` de `backend-patches/provision-variation-changes/`. Execute `deploy.py --check <SHA256 do manifesto>`. Com a entrada do bridge drenada pelo gate compartilhado, execute `deploy.py --deploy <mesmo SHA256>` com `PROVISION_PRODUCT_GATE` definido e libere a entrada ao sair. O instalador verifica as duas cópias, preserva o backup, reinicia os serviços e verifica a saúde.
