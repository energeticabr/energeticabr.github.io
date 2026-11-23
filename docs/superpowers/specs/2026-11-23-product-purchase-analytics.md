# Análise de compras no detalhe do produto

## Goal

Ao selecionar um produto no relatório gerencial, ampliar o popup até a altura total da tela e acrescentar, abaixo dos pagamentos executados e previstos, três gráficos de compras: valor mensal em linha suavizada, valor por fornecedor em barras e quantidade mensal em barras.

## Behavior

- A análise usa o snapshot já carregado pelo relatório e identifica o produto e a filial da linha selecionada.
- A janela inclui o mês atual e os 11 meses anteriores, baseada no relógio injetável da tela para ser determinística nos testes.
- Compras são os registros da lista `LANCAMENTOS`, agrupados pela data do lançamento e pelo total registrado (inclui frete). Provisões futuras não são compras realizadas e não entram nos gráficos.
- Os gráficos de 12 meses ignoram os filtros de período e fornecedor da tabela de pagamentos para mostrar todo o histórico do produto e todos os fornecedores; preservam o produto e a filial selecionados.
- Meses sem lançamentos aparecem com valor e quantidade zero. Se uma soma contém dados numéricos incompletos, o ponto ou barra é identificado como incompleto em vez de apresentar um total parcial.
- O popup mantém cabeçalho e botão Fechar acessíveis; somente o conteúdo interno rola.
- O popup preenche verticalmente a área do relatório, mantendo as margens horizontais de segurança e os comportamentos atuais de fechar, foco e retorno ao mesmo relatório.

## Visual structure

1. Tabela existente de pagamentos executados/previstos.
2. Gráfico de linha suavizada, com os totais mensais de compras em reais.
3. Gráfico de barras horizontais, com o total por fornecedor no período.
4. Gráfico de barras, com quantidade comprada em cada um dos 12 meses.

## Acceptance

- Produto/filial vizinhos, registros fora da janela e provisões não contaminam as séries.
- O filtro de fornecedor ativo não reduz o gráfico por fornecedor.
- As 12 posições mensais permanecem presentes inclusive quando não houve compra.
- Totais incompletos não são tratados como zero ou soma parcial.
- Em 320×568, 390×844, 844×390 e 1365×768 o diálogo fica dentro da tela, encosta verticalmente no topo e no fim da área do relatório, e mantém o fechamento visível.
- Tabela e gráficos rolam dentro do popup; fechar preserva DOM, filtros, expansão, rolagem e foco do relatório.
- Guard de assinatura, testes web focados, builds PWA/Android/iOS e destinos Pages, Google Play interno e TestFlight passam na revisão correta.
