# Auditoria dos pedidos do usuário — 08/10/2026

Critério: resposta de aceitação, merge ou workflow iniciado não significam conclusão. Conferência de código, publicação da revisão e evidência específica de migração. Não repetir gravações financeiras já verificadas.

## Pedidos anteriores verificados na revisão publicada 61926f5

| Pedido | Evidência |
|---|---|
| Mascote e relatório de controle de empreiteiros | PR338 |
| Mascote de resumo geral à esquerda de Sair | PR339 |
| Provisões únicas/múltiplas, pai DESCRITIVOPROVISAO e vínculo dos filhos | PR340 e backend implantado |
| Layout de folhas por fornecedor, profissão, totais, faixas azul/branco e setas | PR341 |
| Finalizar documento com anexos vindos da bandeja/compartilhamento | PR342; código/testes, compartilhamento físico no WhatsApp não exercitado |
| Aproveitar largura no relatório de pagamentos pendentes | PR343 |
| Aproveitar largura de fornecedores/frequência e retirar legenda | PR344 |
| Aproveitar largura de diários pendentes | PR345 |
| IDFOLHA STATUS suspenso ATIVO/INATIVO | PR346 |
| Corrigir metadados de fornecedor ao editar FOLHA PGTO | PR347 |
| Otimizar abertura do lançamento pelo + | PR348 |
| Excluir botão e hub de relatórios legado, preservando mascotes HOME | PR349 |
| Galeria Descritivo Provisão abaixo de PGTOS PREVISTOS e botão esquerdo mais alto | PR350 |
| Anexos de provisões no pai e lápis na galeria descritiva | PR351 e backend implantado |
| Mascotes comerciais laranja em linha acima do cluster | PR354 |
| Total pago por rubrica, à direita do total, com divisor vertical | PR352 |
| Descrição da linha abaixo do frete e antes da expansão | PR353 |
| Seletor de lançamento: ID, fornecedor, profissão, total unitário × qtd + frete e data paga | PR355 |
| Migrar provisões PAGAMENTO PREVISTO para descritivos vinculados | work/provision-backfill-20261008/verification.md:28: 17 previstos, 0 sem vínculo, 16 novos pais, 1 preservado |

Publicação que inclui esses PRs: Pages run 37835706835; Android interno 1.0.981 run 37835707047 (Play edit committed); TestFlight 1291 run 37835706813 (READY_FOR_BETA_TESTING, ATTACHED).

Observações da auditoria: a posição atual de empreiteiros precede relatórios adicionados posteriormente; isso não é ausência do pedido original. Descritivo como segundo botão à direita está imediatamente abaixo de PGTOS PREVISTOS, conforme solicitado; terceiro é DESPESAS RECORRENTES. Não inverter essa ordem por uma interpretação incorreta do checklist.

## Pendências ativas, sem omissões

| # | Pedido | Estado no início desta auditoria |
|---|---|---|
| 1 | Bandeja de anexos no editor IDFOLHA e recibo obrigatório para INATIVO | Implementado, 4805 testes; PR356 integrado em 165288a; publicação em andamento |
| 2 | Erro General exception ao acrescentar pagamento | Reproduzido com metadados reais, corrigido; 13 testes focados passam |
| 3 | CANCELAR à esquerda e SUBMETER à direita em todas as telas aplicáveis | Corrigido; verificação de bordas em celular/tablet/PWA passa |
| 4 | Cluster VALOR TOTAL à esquerda do lápis e status no lugar anterior | Implementação e regressões em andamento |
| 5 | DINHEIRO gera comprovante DOCUMENTOS PENDENTE sem assinatura | Implementação backend em andamento |
| 6 | Atualizar base de dados em todas as galerias | Implementação em andamento |
| 7 | Retirar pergunta de vinculação IDPGTO por VLORDIARIO | Implementação backend em andamento, sem vínculo automático substituto |
| 8 | Resumos de confirmação legíveis e amplos no tablet | Implementação do visualizador em andamento |

Repetições e pedidos de prioridade foram preservados como instruções de execução, não contados como funções adicionais. Todos os oito itens só poderão ser encerrados após validação e publicação aplicáveis.
