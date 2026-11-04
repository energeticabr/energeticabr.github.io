# Escolha individual ou coletiva de folha e tipo de pagamento

Quando há mais de um pagamento pendente de vínculo, a etapa IDFOLHA oferece `INDICAR INDIVIDUALMENTE` ou `ATRIBUIR O MESMO VALOR PARA TODOS`. O primeiro caminho conserva as perguntas por pagamento. O segundo pergunta uma única vez o mês vigente, anterior ou posterior e procura o IDFOLHA correspondente ao fornecedor de cada linha. A referência exibida fica fixa mesmo quando o usuário responde depois da virada do mês.

A escolha de modo é independente para tipo de pagamento. No modo coletivo, uma única seleção de tipo atende a todas as linhas restantes. No individual, cada linha recebe sua pergunta, com botões identificados pela linha para rejeitar cliques atrasados. Uma única linha segue diretamente às perguntas existentes.

Respostas de folha já dadas e pagamentos verificados são preservados em rascunhos retomados. Se não houver uma única folha para algum fornecedor no mês escolhido, somente essas linhas voltam à pergunta individual; o fluxo não utiliza a folha de outro fornecedor. Fornecedores sem folhas elegíveis mantêm o aviso e a exclusão já existentes.

O tipo coletivo é salvo antes da primeira gravação externa. Cada pagamento usa seu token existente, `merge_existing=False`, verificação de campos/anexos e checkpoint salvo antes de iniciar a próxima linha. Uma falha mantém o tipo e oferece `TENTAR NOVAMENTE`, preservando linhas já confirmadas. A retomada da pergunta retorna seu resultado diretamente, evitando um segundo save com etag antigo.

## Verificação

Os testes de comportamento usam os handlers reais de `WorkflowEngine`, `ChannelBridge` e `LocalStateStore`, com catálogos, armazenamento e registros financeiros fictícios. Reutilizam os fixtures de `launch-payroll-per-payment` e `provision-contractor-payroll`, que requerem um snapshot privado compatível do backend. O runner seleciona somente os testes declarados em `BatchAssignmentTests`; testes herdados são regressões arquivadas que precisam escolher o novo modo individual antes das perguntas antigas.

O instalador possui testes independentes do snapshot privado:

```sh
python -B -m unittest discover -s backend-patches/payroll-batch-assignment/tests -p test_deploy.py -v
```

## Publicação

Somente `worker/workflow.py` é transformado em produção e no mirror, preservando suas diferenças com hashes anteriores e posteriores independentes. `patch_backend.py` exige cada âncora exatamente uma vez; o manifesto fixa o instalador, patcher, diff e gate. Código completo, configurações e evidências privadas não fazem parte do repositório público.

O pacote é copiado por root para `/var/lib/energetica-deploy/payroll-batch-assignment-20261104`, sem escrita por grupo/outros. O rollout usa lock compartilhado, gate de entrada com watchdog, espera de requisições, backup, substituição atômica, reinicialização e verificação dos dois serviços e `/health`. Uma falha restaura as fontes alteradas. O instalador não altera conversas, anexos ou registros financeiros.

Android, iOS e Windows/web utilizam esse servidor compartilhado. A funcionalidade não exige novos binários ou alterações no cliente. Consulte `verification.md` para os resultados e a evidência da publicação.
