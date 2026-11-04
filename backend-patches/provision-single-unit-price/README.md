# Perguntar primeiro o valor unitário pendente

Ao selecionar um descritivo com exatamente uma provisão vinculada, o fluxo pergunta o valor unitário antes do detalhamento quando o campo está vazio, pendente ou zero. Uma resposta positiva válida atualiza somente o rascunho e retorna à tabela com o total recalculado. Preços preenchidos e descritivos com várias linhas mantêm o comportamento existente, mesmo se somente uma linha ainda estiver pendente.

A pergunta reutiliza a edição de campo, a validação numérica e a confirmação financeira existentes. Anexos recebidos durante o preenchimento permanecem no rascunho e a pergunta continua ativa. A opção de anexos após os campos só fica ativa enquanto existe um índice de edição; ao concluir a pergunta o motor limpa esse índice e retorna diretamente à tabela.

## Validação

`tests/test_single_unit_price.py` reutiliza o motor real e as fronteiras sintéticas de SharePoint/mídia do fixture `provision-settlement-batch-review`. O runner privado pré-carrega os módulos do backend instalado antes de carregar o fixture arquivado. O armazenamento de controle de anexos é temporário. Os testes não alteram registros reais.

Os contratos do instalador são independentes do backend privado:

```sh
python -B -m unittest discover -s backend-patches/provision-single-unit-price/tests -p test_deploy.py -v
```

## Publicação

O patch altera somente `worker/provision_description_settlement.py`. Produção e mirror são transformados separadamente, preservando suas diferenças e conferindo os hashes anteriores e posteriores. A publicação usa lock compartilhado, gate de entrada com watchdog, espera de requisições em andamento, backup, troca atômica com proprietário/permissões preservados, verificação dos dois serviços e rollback em falha.

O pacote enviado por `opc` não é executado como root. Primeiro ele é copiado para `/var/lib/energetica-deploy/provision-single-unit-price-20261104`, com proprietário root e diretórios/arquivos sem escrita por grupo/outros; o manifesto e cada entrada são conferidos antes da execução. `deploy.sh` recusa execução no diretório de upload. O manifesto exato é argumento obrigatório para `--check` e para o deploy com gate.

É uma alteração do servidor compartilhado, disponível para Android, iOS e web/Windows sem mudança de binários ou bundle do cliente. Não há migração de rascunhos nem gravação financeira durante a instalação.
