# Revisão visual dos relatórios 3–17

Fonte de comparação: capturas e fórmulas fornecidas pelo usuário, mais `ENERGETICA (1).msapp` para os botões da tela inicial. O HTML/CSS do aplicativo reproduz a organização visual; dados do SharePoint continuam inseridos como texto, sem executar HTML recebido da lista. Em telefone horizontal, tabelas largas se reorganizam em cartões ou campos rotulados, sem rolagem lateral. Rolagem vertical continua disponível.

| Relatório | Elementos da referência conferidos na revisão | Comportamento no telefone horizontal |
|---|---|
| 3 — Fornecedores e atividades | Filial, imóvel, indicadores por profissão, fornecedor, forma de pagamento, frequência e atividade | Campos do fornecedor em cartões rotulados |
| 4 — Presenças e ausências | Faixa de resumo, indicadores coloridos e agrupamento por profissão e pessoa | Indicadores e grupos empilhados sem corte |
| 5 — Pagamentos pendentes | Filial, fornecedor, diárias, datas e totais pendentes | Identidade, datas e valores em blocos legíveis |
| 6 — Etapas e atividades | Faixa de etapa, percentual, dias e atividades com status | Atividades em cartões por etapa |
| 7 — Diários pendentes | Logo, colunas ID/data/filial/status e contagem final | Colunas reagrupadas conforme largura, sem arrastar lateralmente |
| 8 — Tarefas pessoais | Indicadores pendentes/concluídas/total, data fatal e tarefas | Tarefas organizadas por data em cartões |
| 9 — Resumo de gastos | Marca, período, total, filiais, classificações e faixas por categoria | Tabelas de categoria tornam-se blocos rotulados |
| 10 — Despesas recorrentes | Filtros, logo, título rosa-claro e grade filial/fornecedor/produto/vencimento/agendamento/valor/status | Cada linha da grade vira cartão com os sete campos |
| 11 — Cotações e orçamentos | Título, indicadores, dados da cotação, status e orçamentos vinculados | Dados em células suaves e cartões |
| 12 — Depreciação | Período, sete indicadores, filial, itens e totais | Itens em cartões, totais preservados |
| 13 — Documentos | Filtros, marca, faixa vermelha, indicadores e registros | Registros em cartões com rótulos |
| 14 — Indicadores comerciais | Indicadores financeiros, status dos imóveis e resumo por imóvel | Campos financeiros e estado em blocos |
| 15 — Último andamento | Aviso de filtro, filial, imóvel, último marco, datas e estado | Um cartão por imóvel com os mesmos campos |
| 16 — Pendências comerciais | Indicadores de IDs e pendências por imóvel/filial | Campos de pendência rotulados e empilhados |
| 17 — Aluguéis em aberto | Imóvel, inquilino, vencimento, forma de pagamento, valor e atraso | Lançamentos primeiro; resumo adicional acessível em seção recolhível |

Os 15 botões de acesso usam os controles, cores `Fill` e imagens originais mapeados em `docs/superpowers/specs/2026-10-03-report-launch-buttons-powerapps.md`. Os 14 PNGs locais coincidem por SHA-256 com os arquivos dentro do `.msapp`; os relatórios 6 e 10 compartilham o mesmo mascote, mas não a mesma cor.

Verificação local: 1.730/1.730 testes; builds web e PWA; validações de segredos e gestos; testes de navegador em 740×360 e 844×390 para os grupos de relatórios, sem estouro horizontal; 14/14 imagens presentes nos dois builds. A comparação é com as referências fornecidas, não com uma sessão autenticada do Power Apps em produção.
