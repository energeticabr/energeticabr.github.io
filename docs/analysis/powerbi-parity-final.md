# Auditoria final de paridade Power BI no portal

Data da auditoria: 27/08/2026

## 1. Escopo e fonte de evidência

Esta entrega compara o inventário `docs/analysis/powerbi-energetica-inventory.md` com os contratos e as páginas existentes em `portal/analytics` e `portal/reports`. O inventário registra 7 páginas, 141 visuais, 44 medidas DAX, 83 relações e 393 interações explícitas.

A implementação foi limitada à leitura e à exploração interativa de relatórios. Não foram alterados acesso, catálogo, formulários, galerias operacionais, workflows ou site público. O portal continua usando as fontes SharePoint autorizadas, sem criar uma base operacional duplicada.

O resultado deve ser entendido como **paridade funcional comprovada**, não como equivalência integral do PBIX. Só são considerados equivalentes os comportamentos sustentados por contrato, teste e metadado identificável.

## 2. Cobertura visual

| Página do inventário | Visuais no PBIX | Cobertura funcional nesta entrega | Observação |
|---|---:|---:|---|
| APPS | 1 | 0 | É uma superfície de navegação Power Apps, fora de `analytics/reports`. |
| FINANCEIRO | 27 | 25 | Exclui 1 Flow Visual e 1 Action Button. Cobre 11 slicers, 2 cartões, 11 gráficos, incluindo 2 pivôs, e 1 tabela. |
| RECURSOS HUMANOS | 29 | 27 | Exclui 1 Flow Visual e 1 Action Button. O filtro global de presença é um contrato adicional não visível. |
| ETAPA OBRA | 21 | 19 | Exclui 1 Flow Visual e 1 Action Button. Os filtros globais/de página permanecem como contratos ocultos. |
| COMERCIAL | 18 | 16 | Exclui 1 Flow Visual e 1 Action Button. |
| AUDITORIA | 17 | 17 | Cobertura dos visuais analíticos inventariados. |
| IMOBILIZADO | 28 | 26 | Exclui 1 Flow Visual e 1 Action Button. |
| **Total** | **141** | **130** | Os 11 itens restantes são APPS e os 10 visuais de automação/ação fora desta frente. |

O normalizador possui 136 contratos internos porque inclui 4 filtros persistidos não visíveis e representa os 2 pivôs financeiros também como tabelas acessíveis. Esses contratos auxiliares não são contados como novos visuais do PBIX.

## 3. Paridade implementada

### Indicadores, dimensões e filtros

- Fontes físicas são preservadas por `sourceEntityId` ou `sourceEntityIds`; uma medida não agrega indiscriminadamente registros de outras listas.
- Slicers usam as dimensões identificadas no inventário e propagam o valor a fontes que exponham aliases compatíveis.
- Mês e ano são derivados de datas sem converter datas de calendário para o dia anterior.
- As opções de um slicer permanecem facetadas mesmo quando o próprio slicer já possui seleção.
- `DESCRITIVOPRESENCA.PRESENCA = PRESENTE` é aplicado como preset global antes das agregações sobre essa fonte.
- Os filtros de página `LANCAMENTOOBRA.FILIAL` invertido e `LANCAMENTOOBRA.INDICE` avançado são preservados no contrato e não são apresentados como slicers comuns sem valor configurado.
- Operações suportadas: soma, contagem, contagem distinta, média, mínimo, máximo, soma pendente, contagem por status, diferença de somas e cálculos patrimoniais ponderados.
- Os seis cartões de IMOBILIZADO usam contratos específicos para valor inicial, residual, depreciado, taxa ponderada, valor a depreciar e data de depreciação.

### Interação cruzada

- Cliques e teclado em barras, colunas, linhas e segmentos alternam a seleção do visual.
- A matriz F/H/N distingue filtrar, realçar e não interagir.
- Gráficos filtram gráficos e tabelas; células de tabelas com interação declarada filtram os gráficos compatíveis.
- O comando Limpar filtros remove slicers e seleções visuais.
- Tabelas detalhadas têm paginação independente e exportação CSV do recorte filtrado.
- `portal/reports` acrescenta ordenação acessível e facetas clicáveis de filial/status.

As matrizes com nomes únicos fecham exatamente em COMERCIAL (25 F), RECURSOS HUMANOS (104 F e 2 H) e AUDITORIA (37 F). Nos demais painéis, o PBIX usa nomes repetidos como `barChart`, `columnChart`, `pivotTable` e `slicer`, sem identificador estável para todas as arestas. O contrato semântico atual resulta em:

| Página | Inventário | Contrato semântico atual | Situação |
|---|---:|---:|---|
| FINANCEIRO | 68 F, 16 N | 69 F, 16 N | Um alvo genérico não pode ser associado de forma unívoca. |
| RECURSOS HUMANOS | 104 F, 2 H | 104 F, 2 H | Correspondência exata. |
| ETAPA OBRA | 94 F, 14 N | 107 F, 3 N | Nomes repetidos impedem distribuir 11 bloqueios sem inventar identidade visual. |
| COMERCIAL | 25 F | 25 F | Correspondência exata. |
| AUDITORIA | 37 F | 37 F | Correspondência exata. |
| IMOBILIZADO | 31 F, 2 H | 35 F, 2 H | Quatro arestas genéricas permanecem semanticamente mais amplas. |

O total contratual atual é 400 arestas semânticas, contra 393 arestas brutas no inventário. Não foram removidas arestas arbitrariamente apenas para igualar o total.

### Visuais e tecnologia

- Linha, barra e coluna usam SVG nativo.
- Empilhado 100% calcula e apresenta percentuais por categoria.
- Waterfall calcula o acumulado de cada etapa.
- Gantt/timeline usa início, fim, duração e progresso identificados no inventário.
- Pivôs usam tabela HTML acessível.
- Não há biblioteca paga nem dependência de Inforiver ou dos Gantts empacotados no PBIX.

### Estados, responsividade e segurança

- Carregamento progressivo informa a quantidade de registros recebidos.
- Falhas são isoladas por fonte; dados restantes continuam visíveis com diagnóstico e aviso de parcialidade.
- Falha total oferece tentativa novamente e requisições antigas são canceladas ao trocar de rota/filtro.
- SVGs usam `viewBox`; grades se reorganizam pelo CSS responsivo existente; tabelas preservam rolagem horizontal e rótulos no layout reduzido.
- O módulo do painel é validado antes da primeira consulta. Relatórios revalidam a permissão antes de cada nova leitura.
- Fontes sem permissão são marcadas como indisponíveis e não são consultadas.
- Dados operacionais permanecem em memória durante a sessão; esta entrega não persiste cópias locais.

## 4. Testes adicionados e ampliados

Os testes foram escritos antes das correções correspondentes. As novas provas cobrem:

- preservação de origem, filtros persistidos, séries, Gantt e matriz F/H/N pelo normalizador;
- agregação isolada por fonte e opções facetadas de mês/ano;
- filtro, realce e bloqueio entre visuais;
- seleção de célula de tabela filtrando gráficos;
- séries segmentadas, percentuais, waterfall e timeline;
- cálculos patrimoniais compostos;
- contagens de slicers, cartões, gráficos e tabelas por painel;
- negação de painel antes da carga quando o módulo não é permitido;
- renderização nativa de empilhado, pivô, Gantt, waterfall e múltiplas tabelas;
- paginação independente por tabela;
- neutralização de fórmulas na exportação CSV analítica;
- ordenação, facetas e revalidação de segurança em relatórios.

Arquivos de teste desta frente:

- `tests/analytics-definition-normalizer.test.mjs`
- `tests/analytics-powerbi-parity.test.mjs`
- `tests/analytics-rh-etapa.test.mjs`
- `tests/reports-powerbi-interactivity.test.mjs`

Verificação final executada para o commit:

- suíte focada em analytics/reports: 93 aprovados, 0 falhas;
- suíte completa `tests/*.test.mjs`: 519 testes, 510 aprovados e 9 falhas externas a esta frente no instante da verificação;
- as falhas globais estão em `dynamic-form-searchable-select.test.mjs` (3), `powerapps-closed-field-contract.test.mjs` (2), `powerapps-gallery-contracts.test.mjs` (1) e `relational-selectors.test.mjs` (3), sobre arquivos paralelos de formulários/galerias que não integram este commit;
- verificação de sintaxe dos módulos alterados: aprovada;
- `git diff --check` sobre todos os caminhos autorizados: aprovado.

## 5. Lacunas inevitáveis ou não comprovadas

1. **44 medidas DAX:** o portal implementa as operações e os cartões efetivamente contratados, mas não há correspondência individual validada para todas as 44 medidas. Fórmulas legadas ambíguas não foram reinterpretadas.
2. **83 relações:** o motor em memória propaga filtros por aliases compatíveis, mas não reproduz integralmente direção, cardinalidade, relações inativas e todos os caminhos bidirecionais do modelo Power BI.
3. **Matrizes com nomes repetidos:** FINANCEIRO, ETAPA OBRA e IMOBILIZADO precisam de IDs internos do PBIX ou validação visual controlada para fechar cada aresta sem suposição.
4. **Tabelas DAX locais:** `ACUMULADO`, `ACUMULADO (2)` e `Tabela_Documentos` são reconstruídas em memória a partir das fontes físicas; não foi criada base duplicada.
5. **Validação numérica de produção:** os testes usam amostras determinísticas. A coincidência dos totais com o PBIX ainda exige executar ambos com os mesmos dados e filtros de uma amostra SharePoint controlada.
6. **APPS e automações embutidas:** a página APPS, Flow Visuals e Action Buttons não foram recriados, pois não pertencem aos diretórios autorizados de relatórios.
7. **DAX legado potencialmente incorreto:** nomes como `VENCIDADS`, comparações de data com `0` e formatação monetária em dólar foram preservados como pendência de validação de negócio, conforme o inventário.

## 6. Arquivos alterados nesta entrega

- `portal/analytics/analytics-model.js`
- `portal/analytics/analytics-page.js`
- `portal/analytics/definition-normalizer.js`
- `portal/analytics/definitions/auditoria.js`
- `portal/analytics/definitions/etapa-obra.js`
- `portal/analytics/definitions/imobilizado.js`
- `portal/analytics/definitions/recursos-humanos.js`
- `portal/reports/report-model.js`
- `portal/reports/reports-page.js`
- `tests/analytics-definition-normalizer.test.mjs`
- `tests/analytics-powerbi-parity.test.mjs`
- `tests/analytics-rh-etapa.test.mjs`
- `tests/reports-powerbi-interactivity.test.mjs`
- `docs/analysis/powerbi-parity-final.md`

## 7. Conclusão

O portal agora oferece o máximo de paridade interativa comprovável com os metadados disponíveis usando apenas recursos gratuitos e sem duplicar a base SharePoint. A equivalência integral de 141 visuais, 44 medidas, 83 relações e 393 interações **não está declarada**. O fechamento restante depende de IDs visuais não ambíguos, validação das relações/DAX e comparação com dados reais controlados.
