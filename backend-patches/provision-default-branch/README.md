# Filial padrão na nova provisão de pagamento

A pergunta `filial_pagamento` passa a consultar `FORNECEDORES.FILIAL` pelo fornecedor selecionado. Reutiliza a regra do catálogo que mostra `⭐ NOME (PADRÃO DO FORNECEDOR)` e prioriza essa opção. IDs e valores continuam sendo os do cadastro oficial. Fornecedor sem padrão, padrão inexistente ou fora das filiais permitidas não acrescenta opções.

A mudança é somente na configuração do servidor comum a Android, iOS e Windows/web. Não exige novos binários. Nenhum lançamento financeiro é alterado.

## Validação e publicação

- Regressão do motor e do decorador reais, com catálogos sintéticos: modos único/múltiplos, seleção, troca de padrão, pesquisa, limpar filtro, atualização e ausência de padrão.
- Cinco testes do instalador: preservação das configurações independentes, deriva de fonte/pacote, backup e rollback.
- `python -B -m unittest discover -s backend-patches/provision-default-branch/tests -p test_deploy.py -v` executa o instalador sem dados do tenant.
- Os testes de conversação usam o snapshot privado do servidor e `test_first_freight.py` como fixture; `CANDIDATE=1` testa a configuração candidata, sem a variável testa a configuração instalada.

Publicado com manifesto SHA-256, lock compartilhado, gate/drain, backup e substituição atômica em produção e no espelho de build, preservando suas diferenças. Manifesto: `444100accfbc4e2f39b763e971eeab3aff6d263ac5744ccf4107b163153e6da0`. A instalação usa diretório de pacote pertencente a root em `/var/lib/energetica-deploy/provision-default-branch-20261106`.

Após publicação, os seis testes de conversação passaram usando a configuração instalada; os dois serviços ficaram ativos e `/health` retornou `ok`. Hashes instalados estão em `deploy-manifest.json`. Não houve teste visual autenticado no aparelho do usuário.
