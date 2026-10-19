# Seleção dos descritivos com anexos no reconciliador

Aplicar depois de `../provision-parent-fanout`. Na verificação real do timer, a consulta `Attachments eq true` retornou apenas registros cujo indicador era `false`; a projeção paginada sem esse filtro retornou os indicadores corretos.

O reconciliador agora lê somente `Id,Attachments`, valida o tipo booleano e seleciona localmente os itens com anexos. Não depende do filtro booleano invertido do tenant. Não altera as regras de propriedade, cópia, deduplicação, locks, baixas nem a criação financeira.

O teste `test_reconciler_handles_tenant_boolean_quirk_without_processing_empty_rows`, no pacote anterior, reproduz a resposta real invertida: falhou antes da correção e passou depois, comprovando também que linhas sem anexos não são processadas.

Verificação do candidato final no Python 3.9 do runtime: 27 testes do fluxo/timer, 23 da baixa e 22 da sincronização anterior aprovados. Windows: 37 aprovados, incluindo os 11 testes de montagem/rollback deste pacote; o teste POSIX de lock foi executado no runtime. Prévia/diagnóstico real usa somente GETs.

O manifesto contém apenas `worker/provision_parent_fanout.py`, com baseline e candidato fixados. Bundle completo continua privado. `deploy.py` reutiliza o instalador verificado do pacote anterior com escopo de um arquivo existente, stage `/home/opc/provision-parent-timer-selection-20261019`, backup e verificação de saúde. Suspender o timer durante a instalação e reativá-lo depois. Conferir uma execução real antes de considerar concluída a reconciliação.

Como a correção está no servidor compartilhado, atende Windows/web, Android e iOS sem alterar seus binários.
