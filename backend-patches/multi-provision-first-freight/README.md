# Frete somente no primeiro item da provisão múltipla

O fluxo `payment` em modo `MULTIPLOS` pergunta se há frete e seu valor apenas no primeiro item. Os próximos itens não herdam o frete, não oferecem sua edição e gravam `FRETE=0`. O total continua sendo a soma exata de `QTD × VALOR TOTAL + FRETE`, sem rateio ou repetição do frete.

- Produto único, rascunhos single legados e edição do primeiro item mantêm o comportamento atual.
- Rascunhos múltiplos ainda não enviados são normalizados. Uma resposta a uma pergunta antiga de frete é descartada e a próxima pergunta real é reapresentada.
- Se um rascunho antigo já tinha frete em outros itens salvos, o total corrigido é mostrado em uma nova revisão antes de confirmar. Apenas consultar a prévia não autoriza o valor alterado.
- Registros já gravados, submissões com `provision_commit` iniciado, anexos e tokens de idempotência não são reescritos. Retomadas preservam exatamente o journal congelado.

## Validação

`tests/test_first_freight.py` usa o WorkflowEngine real, substituindo apenas armazenamento, imagens de resumo e a fronteira SharePoint por dados sintéticos. Cobre primeiro item com/sem frete, segundo/terceiro, total, retomada, respostas antigas, edição, confirmação e retry sem duplicação.

`test_bundle.py` e `test_deploy.py` verificam os bytes revisados, membros do arquivo privado, hashes, aliases, drift, rollback, lock e liberação do gate de entrada. Nenhum teste envia registros financeiros ao tenant.

## Publicação

Esta regra é do servidor comum ao Windows/web, Android e iOS. Não modifica o cliente nem requer nova instalação nativa.

1. Executar `package.py PRIVATE_WORKSPACE` com `baseline/` e `candidate/` copiados da versão atual. Somente o diff, scripts e manifesto entram no Git. O bundle `source-files.tar` e `shared-deploy.py` ficam na área privada.
2. Preparar `/home/opc/multi-provision-first-freight-20261022/release` com os sete inputs fixados no manifesto.
3. Executar `deploy.py --check SHA256_DO_MANIFESTO`, depois `deploy.sh SHA256_DO_MANIFESTO` como root. O script bloqueia novas conexões por poucos instantes, aguarda as atuais, mantém backup, instala somente os dois módulos autorizados, reinicia o bridge e verifica a saúde. Falhas restauram os originais; o gate tem watchdog.
4. Conferir os hashes instalados, os serviços e a saúde pública; abrir o aplicativo sem submeter dados financeiros fictícios.

O espelho `/home/opc/energetica-build` está em outra revisão: seus hashes são conferidos, mas seus arquivos permanecem somente leitura. Não sincronizar nem sobrescrever esse espelho.
