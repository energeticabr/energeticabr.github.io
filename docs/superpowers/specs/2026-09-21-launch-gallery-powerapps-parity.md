# Galeria de lançamentos — paridade com o PowerApps

## Objetivo

Transformar a galeria de lançamentos do chatbot em uma réplica funcional e visual da tela `G1- HISTÓRICO LANÇAMENTOS` do PowerApps, mantendo a adaptação responsiva necessária para celular e tablet.

## Fonte de verdade

A tela aberta no Power Apps Studio em 21/09/2026 foi inspecionada diretamente. Ela apresenta:

- filtros de ID, produto, filial, fornecedor, concluído, etapa da obra, medição e período de empenho;
- indicadores de quantidade e valor para empenhado, liquidação, PA/pago, pendente e total;
- linhas densas com produto, etapa, fornecedor, filial, situação do pedido, autor/data de criação, data de RMS, estado de modificação, data de compra, valor unitário, ID, tipo de operação, aprovação, liquidação, quantidade/unidade, pagamento, frete, total, forma de pagamento, ID do pedido, anexos e avaliação;
- alternância visual entre linhas claras e azuladas, cabeçalhos em vermelho/azul e estados destacados;
- seleção da linha para abrir as operações completas.

## Comportamento exigido

1. O chatbot deve mostrar os mesmos dados disponíveis na linha do PowerApps sem exigir a abertura de detalhes.
2. Campos ausentes na resposta não devem gerar rótulos vazios nem quebrar o cartão.
3. As nomenclaturas devem aceitar os aliases usados nas respostas atuais da VM (`DATA`, `DATA DE COMPRA`, `UN`, `UNIDADE`, `FORMAPGTO`, `FORMA DE PAGAMENTO`, etc.).
4. O filtro de contrato existente passa a ser apresentado como `Medição`, acompanhando a tela original, sem mudar a chave enviada ao serviço.
5. Os totais devem incluir quantidade e valor quando o serviço os fornecer; respostas antigas apenas com valores continuam compatíveis.
6. Em desktop/tablet, os registros devem se comportar como linhas densas da tabela do PowerApps. Em celular, a mesma informação deve reorganizar-se em blocos legíveis, sem rolagem horizontal obrigatória.
7. Todas as operações atuais — detalhes, edição, exclusão, pagamento, medição, anexos e assinatura — permanecem intactas.
8. Conteúdo vindo da VM continua sendo inserido somente como texto escapado.

## Critérios de aceitação

- os filtros aparecem no mesmo agrupamento e ordem lógica da tela do PowerApps;
- os indicadores exibem rótulos e quantidades/valores equivalentes;
- uma linha completa apresenta todos os campos da referência que existirem no payload;
- anexos, aprovação, modificação e avaliação recebem estados visuais distintos;
- os testes existentes continuam passando e novos testes cobrem a paridade visual/semântica e a compatibilidade com payloads antigos.
