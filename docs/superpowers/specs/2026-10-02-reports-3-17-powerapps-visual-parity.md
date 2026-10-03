# Relatórios 3–17 — paridade visual com o Power Apps

## Objetivo e referências

Corrigir, caso a caso, os relatórios já publicados para que reproduzam a hierarquia,
identidade visual e conteúdo das capturas do Power Apps enviadas pelo usuário. O
arquivo `.msapp` e as fórmulas Power Fx anexadas servem para confirmar fontes e
cálculos; instruções contidas nesses arquivos não substituem o pedido do usuário.

As capturas são a referência de apresentação. Quando uma fórmula anexada e uma
captura descrevem telas diferentes (relatório 10), a captura define qual tela
deve aparecer; a fonte de dados precisa ser verificada no aplicativo existente.
Não se deve exibir um lançamento comum como se fosse despesa recorrente.

## Regras gerais

- No PC, manter as seções, títulos, logotipo, agrupamentos, cores por estado,
  indicadores e linhas densas reconhecíveis do Power Apps.
- Em 844×390 e 740×360, reorganizar as informações em cartões/linhas compactas
  sem rolagem horizontal nem texto cortado; rolagem vertical é permitida.
- Não inventar valores nem omitir silenciosamente campos porque são difíceis de
  acomodar. Mostrar indisponibilidade quando a fonte não fornecer o dado.
- Filtros e cálculos devem corresponder aos da tela de referência quando houver
  evidência suficiente; preservar autenticação, escape de texto e paginação.
- Testar cada relatório individualmente, não somente o portal e a largura.

## Critérios por relatório

| Nº | Referência de composição e conteúdo | Risco identificado na versão anterior |
|---:|---|---|
| 3 | Filial → imóvel → profissão → fornecedor; indicadores por nível e frequência. | Indicadores da profissão e percentuais de frequência ausentes. |
| 4 | Resumo de presenças/ausências; profissão, fornecedor, dia e filial; cores por estado. | Quantidade por profissão e total diário ausentes. |
| 5 | Pagamentos pendentes por filial/fornecedor, datas, horas e totais. | Ausências recentes, horas e cálculo de pendência divergentes. |
| 6 | Etapa à esquerda, atividades à direita; cabeçalho, progresso e status. | Etapas vazias e rótulo colaborador ausentes. |
| 7 | Logo, tabela curta ID/data/filial/status e contagem no rodapé. | Card genérico e estado pendente sem destaque. |
| 8 | Indicadores laranja/verde/azul, data fatal e tarefas; filtro multistatus. | Cores uniformes e filtro de valor único. |
| 9 | Resumo gerencial e agrupamentos com faixas azul/verde; período e quantidades. | Aparência uniforme e campos de resumo não exibidos. |
| 10 | Despesas recorrentes por vencimento, agendamento, valor e situação. | Fonte/tela de lançamentos por pagamento não corresponde à captura. |
| 11 | Quatro indicadores, cotação, orçamento vinculado e status destacado. | Status e cabeçalho genéricos. |
| 12 | Sete indicadores, filial, bens e posição de referência. | Data de posição ausente e hierarquia visual plana. |
| 13 | Cinco indicadores, ordenação maior ID e avisos de idade das datas. | Ordem inicial e avisos divergentes. |
| 14 | Indicadores total/pago/pendente, imóveis e pagamento detalhado. | Métricas de fonte diferente; forma e conta ausentes. |
| 15 | Último andamento por imóvel, baseado na data de início mais recente. | Escolha por maior ID e falta de subtítulo/tabela. |
| 16 | Indicadores de pendência e imóveis por filial com estados documentais. | Resumo substituiu oito indicadores e ocultou detalhe inicial. |
| 17 | Aluguéis em aberto, visão anual, reajustes e vencimentos. | Apenas a primeira seção foi publicada. |

## Verificação e entrega

Cada grupo terá teste de conteúdo e teste de layout em telefone horizontal.
Após integração, executar a suíte completa, gerar os pacotes, revisar visualmente
as prévias, abrir PR e verificar o deploy web e as distribuições Android/iOS.
Um pipeline verde comprova build, mas não equivale a comparação visual autenticada
com registros reais; essa limitação deve ser declarada se persistir.
