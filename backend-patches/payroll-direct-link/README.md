# Vincular folha diretamente após o lançamento

Após gravar um lançamento elegível, o fluxo abre a seleção de folha sem a
pergunta SIM/NÃO. A seleção inclui o botão `❌ NÃO ADICIONAR A FOLHA DE PAGAMENTO`
depois das opções de mês. O botão executa a continuação usada pela antiga
resposta NÃO. Escolher a folha e o tipo utiliza os handlers existentes.

Vários lançamentos mantêm a seleção das linhas elegíveis e o modo de atribuição.
O mês coletivo também oferece a recusa. Rascunhos na antiga pergunta abrem a
vinculação quando retomados; respostas antigas SIM/NÃO continuam compatíveis.
Os guards de baixa, vínculos existentes, idempotência e anexos são preservados.

É uma mudança no servidor compartilhado por Android, iOS e Windows/web;
não exige nova instalação dos aplicativos.

## Verificação

O snapshot privado deve incluir os módulos do backend e o fixture compatível
`tests/test_workflow.py`. Os testes usam motor, bridge e armazenamento reais,
com registros e anexos sintéticos. Execute no Linux, pois o guard de origem
usa `fcntl`:

```sh
PER_PAYMENT_SOURCE=/path/to/candidate /path/to/venv/bin/python -B \
  backend-patches/payroll-direct-link/test_direct_link.py --regressions
python -B backend-patches/payroll-direct-link/test_deploy.py
```

A suíte inclui testes de atribuição e anexos anteriores com catálogo/schema
SharePoint sintéticos atualizados. Um caso arquivado de interrupção anterior
ao guard de reserva não é executado: ele espera repetir uma gravação incerta
automaticamente, comportamento bloqueado pela versão atual do backend.

## Publicação

Somente `worker/workflow.py` é alterado, com hashes independentes para produção
e mirror. O transformador rejeita âncoras divergentes. O instalador valida o
manifesto, usa lock compartilhado, gate de entrada e drenagem, guarda backup,
instala atomicamente e verifica serviços/health; falhas restauram os originais.
O pacote é instalado por root em
`/var/lib/energetica-deploy/payroll-direct-link-20261119`, sem escrita por grupo
ou outros. Validar com `deploy.py --check HASH`, publicar com `deploy.sh HASH`,
e confirmar recibo, hashes e testes contra o código instalado.
