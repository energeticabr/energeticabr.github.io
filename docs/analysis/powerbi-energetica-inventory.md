# Inventário Power BI ENERGÉTICA e contrato de implementação no portal

**Data da inspeção:** 26/08/2026
**Modo:** leitura somente; nenhuma gravação no Power BI, no modelo Analysis Services ou nos arquivos `.pbix`.
**Referência funcional principal:** sessão do Power BI Desktop atualmente aberta.

## 1. Escopo, evidências e precedência

Foram encontradas duas versões diferentes do relatório. O contrato abaixo usa a sessão aberta como fonte principal porque ela é mais recente e contém módulos inexistentes no caminho solicitado. A versão indicada pelo solicitante foi inspecionada como linha de base histórica.

| Fonte | Caminho/instância | Tamanho | Modificação | SHA-256 / evidência | Precedência |
|---|---|---:|---|---|---|
| PBIX aberto | `C:\Users\Bernardonotini\OneDrive - energetica\Área de Trabalho\ENERGÉTICA.pbix` | 11.600.160 bytes | 30/05/2026 10:48:14 | `6B90DA9E8CA75BF71B04E1A06F79B7786F6F336E3E3837209AD2E5907C6D59E3` | Principal |
| PBIX solicitado | `C:\Users\Bernardonotini\OneDrive - energetica\ENERGÉTICA.pbix` | 10.726.898 bytes | 24/11/2025 22:53:10 | `3C31750316B7B3AAA62C99920F57F57ED753682E6EDD6F214EE79F7FD2EC2C09` | Comparação |
| Power BI Desktop | `PBIDesktop.exe` PID `31360`, versão `2.157.879.0` | — | sessão ativa | workspace `AnalysisServicesWorkspace_2ba5a33a-cbfa-46c9-bee7-c8f695a5afd1` | Principal |
| Analysis Services local | `msmdsrv.exe` PID `27116` | — | sessão ativa | `localhost:55689` | Modelo vivo |
| Ferramenta | `pbi-tools Desktop 1.2.0` | — | execução local | extração do relatório e TOM bruto do modelo vivo | Leitura |

A inspeção não exportou linhas de negócio nem valores pessoais. Foram extraídos somente metadados: layout, consultas, esquema, fórmulas, relações, filtros, posições e configurações de interação.

## 2. Resumo quantitativo

| Indicador | Sessão aberta | PBIX solicitado | Diferença |
|---|---:|---:|---:|
| Tabelas totais | 100 | 81 | +19 |
| Tabelas de negócio | 53 | 40 | +13 |
| Tabelas automáticas de data | 47 | 41 | +6 |
| Colunas | 1300 | 885 | +415 |
| Colunas calculadas | 322 | 276 | +46 |
| Medidas DAX | 44 | 40 | +4 |
| Relacionamentos | 129 | 86 | +43 |
| Páginas | 7 | 7 | +0 |
| Visuais | 141 | 170 | -29 |
| Visuais personalizados | 4 | 4 | +0 |

- **Listas SharePoint físicas distintas:** 41.
- **Consultas/tabelas alimentadas por SharePoint:** 50; várias são projeções ou agregações da mesma lista.
- **Estruturas locais/calculadas:** dCalendário, MEDIDAS, Tabela_Documentos.
- **Relacionamentos de negócio:** 83; os outros 46 são calendários automáticos.
- **Interações explícitas entre visuais:** 393: 359 filtros, 4 realces e 30 bloqueios.

## 3. Diferenças entre a versão aberta e o arquivo solicitado

- Páginas adicionadas: `COMERCIAL`, `AUDITORIA`.
- Páginas removidas/substituídas: `CONTRATOS`, `MATERIAIS`.
- Tabelas adicionadas: `LINHACONTRATO`, `LINHASMEDICAO`, `CADASTRO CLIENTE`, `LANCAMENTOCOMPRAS`, `IMOVEL CADASTRADO`, `HOMOLOGACAOCOMERCIAL`, `LANÇAMENTORECEITA`, `APONTAMENTOSCOMERCIAIS`, `HOMOLOGARFORNECEDOR`, `Tabela_Documentos`, `DOCUMENTOS RELEVANTES`, `CADASTRO TIPO DOCUMENTO`, `NOTASPENDENTES`.
- Tabelas removidas: nenhuma.
- Medidas adicionadas: `LANÇAMENTOS[% VALOR POR FILIAL]`, `LANCAMENTOOBRA[HOJE]`, `DIÁRIO DE OBRAS[DIARIOSPENDENTES]`, `DESCRITIVOPRESENCA[% VALOR FORMA PGTO MÊS]`, `APONTAMENTOSCOMERCIAIS[Medida]`.
- Medidas removidas: `ACUMULADO[% MED]`.
- Medidas alteradas: `MEDIDAS[MÃO DE OBRA / MATERIAL]`.
- Conclusão: implementar a partir do PBIX antigo eliminaria Comercial, Auditoria e dados de clientes, imóveis, receitas, documentos e notas pendentes. Portanto, ele não deve ser usado como contrato atual.

## 4. Contrato de arquitetura do portal

### 4.1 Fonte de verdade e segurança

1. O SharePoint permanece como única base persistente; o portal não deve copiar registros para Supabase ou outra base.
2. O login é Microsoft Entra ID com `@azure/msal-browser` (MIT), usando fluxo delegado e PKCE. Nenhum segredo de aplicativo pode existir no JavaScript do navegador.
3. A leitura e a escrita usam Microsoft Graph para listas e SharePoint REST apenas onde o Graph não expuser paridade. Toda ação é executada com a identidade e permissões do usuário conectado.
4. O portal consulta o esquema real das colunas antes de montar formulários. Os nomes deste inventário são nomes do modelo; para escrita devem ser usados os `internalName` retornados pela API do SharePoint.
5. Edição usa ETag/`If-Match`; conflito `412` abre comparação antes de sobrescrever. Exclusão exige confirmação e permissão efetiva da lista.
6. Cache de registros apenas em memória durante a sessão. IndexedDB/localStorage podem guardar preferências e filtros, nunca uma cópia persistente dos dados operacionais.

### 4.2 Bibliotecas gratuitas recomendadas

| Necessidade | Biblioteca/tecnologia | Licença | Contrato |
|---|---|---|---|
| Login Microsoft | `@azure/msal-browser` | MIT | SSO, renovação de token e logout |
| Acesso a dados | Microsoft Graph/SharePoint REST | Incluído no Microsoft 365 | Paginação, `$select`, `$expand=fields`, anexos, ETags |
| Gráficos e Gantt | Apache ECharts | Apache-2.0 | Linha, barra, coluna, 100% empilhado, waterfall e Gantt por `custom series` |
| Tabelas/galerias | Tabulator Community | MIT | Ordenação, filtros, paginação, seleção, edição e exportação CSV |
| Junções e agregações em memória | DuckDB-WASM | MIT | Relações, `GROUP BY`, acumulados e pivôs sem servidor duplicado |
| Datas | `date-fns` | MIT | Calendário, início de mês, diferenças e formatação pt-BR |
| Estado e UI | Web Components/JavaScript nativo | Padrão Web | Evita dependência de framework e preserva o portal estático |

O visual Inforiver não deve ser dependência do portal porque pode exigir licença comercial. Os três Gantt empacotados no PBIX também devem ser substituídos por ECharts, preservando dados e interações.

### 4.3 Tradução Power BI para portal

- **Slicer:** filtro facetado compartilhado no estado da página.
- **Card:** KPI calculado sobre o conjunto já filtrado.
- **Bar/column/line/100% stacked/waterfall:** ECharts com clique que aplica filtro cruzado.
- **TableEx/pivotTable:** Tabulator; pivôs são calculados em DuckDB-WASM antes da renderização.
- **Gantt:** ECharts custom series, com início, fim, duração e percentual.
- **Power Apps visual:** substituir por atalho para os módulos CRUD do portal ou deep-link para o aplicativo existente.
- **Flow visual:** substituir por comando explícito do portal; preferir Graph delegado. Um fluxo HTTP só é aceitável com autenticação Entra e sem chave no cliente.
- **Action button:** navegação/comando equivalente, com permissão verificada antes de aparecer e novamente antes da execução.

## 5. Contrato por página e inventário de visuais

Os nomes abaixo vêm do layout. Campos entre parênteses são as dependências do visual. “Filtros” é a quantidade de campos configurados no painel do visual, não necessariamente valores ativos.

### 5.1 APPS

- **Canvas:** 1280 × 720; **visuais:** 1; **interações explícitas:** 0.
- **Tabelas/áreas referenciadas:** `LANÇAMENTOS`.
- **Objetivo no portal:** tela inicial de aplicativos e módulos. O visual aponta para o Power Apps `/providers/Microsoft.PowerApps/apps/3501f99a-e612-44b6-8ce7-8c8caa74fad7`.
- **Filtros de página configurados:** nenhum.

| # | Visual | Tipo | Campos/medidas | Filtros configurados |
|---:|---|---|---|---:|
| 1 | PowerApps_PBI_CV_C29F1DCC_81F5_4973_94AD_0517D44CC06A | `PowerApps_PBI_CV_C29F1DCC_81F5_4973_94AD_0517D44CC06A` | LANÇAMENTOS.EFETUADO; Sum(LANÇAMENTOS.EFETUADO) | 0 |

**Interações:** F = filtrar, H = realçar, N = nenhuma. Metadados explícitos: F 0, H 0, N 0. Quando não houver aresta explícita, aplicar o comportamento padrão do Power BI: filtro/realce conforme o tipo do visual.

### 5.2 FINANCEIRO

- **Canvas:** 3200 × 1515; **visuais:** 27; **interações explícitas:** 84.
- **Tabelas/áreas referenciadas:** `ACUMULADO`, `CADASTROPRODUTO`, `FILIAIS`, `LANCAMENTOOBRA`, `LANÇAMENTOS`, `MEDIDAS`, `dCalendário`.
- **Objetivo no portal:** desembolsos efetuados, pendências de pagamento, custos por período, filial, etapa, fornecedor e classificação de material.
- **Filtros de página configurados:** nenhum.

| # | Visual | Tipo | Campos/medidas | Filtros configurados |
|---:|---|---|---|---:|
| 1 | TOTAL DESEMBOLSOS EFETUADOS | `card` | MEDIDAS.LANÇAMENTOS; MEDIDAS.VALOR TOTAL | 0 |
| 2 | lineChart | `lineChart` | LANÇAMENTOS.EFETUADO; LANÇAMENTOS.DATA PGTO EFETUADO.Variation.Hierarquia de datas.Ano; LANÇAMENTOS.DATA PGTO EFETUADO.Variation.Hierarquia de datas.Mês; Sum(LANÇAMENTOS.EFETUADO) | 12 |
| 3 | PRINCIPAIS LANÇAMENTOS | `barChart` | LANÇAMENTOS.FAMÍLIA; LANÇAMENTOS.GRUPO; LANÇAMENTOS.PRODUTO; LANÇAMENTOS.SUBFAMÍLIA; MEDIDAS.LANÇAMENTOS; MEDIDAS.PENDENTE PGTO | 3 |
| 4 | tableEx | `tableEx` | LANÇAMENTOS.DATA; LANÇAMENTOS.DATA PGTO EFETUADO; LANÇAMENTOS.EFETUADO; LANÇAMENTOS.FILIAL; LANÇAMENTOS.FORNECEDOR; LANÇAMENTOS.FRETE; LANÇAMENTOS.ID; LANÇAMENTOS.PRODUTO; LANÇAMENTOS.QTD; LANÇAMENTOS.TOTAL; LANÇAMENTOS.VALOR UNITÁRIO; Sum(LANÇAMENTOS.QTD); Sum(LANÇAMENTOS.FRETE); Sum(LANÇAMENTOS.TOTAL); Sum(LANÇAMENTOS.EFETUADO) | 1 |
| 5 | PRODUTO | `slicer` | LANÇAMENTOS.PRODUTO | 1 |
| 6 | SUBFAMÍLIA | `slicer` | LANÇAMENTOS.SUBFAMÍLIA | 1 |
| 7 | FAMÍLIA | `slicer` | LANÇAMENTOS.FAMÍLIA | 2 |
| 8 | GRUPO | `slicer` | LANÇAMENTOS.GRUPO | 2 |
| 9 | FORMA PGTO | `slicer` | LANÇAMENTOS.CONTA | 2 |
| 10 | DATA | `slicer` | dCalendário.Date.Variation.Hierarquia de datas.Mês | 3 |
| 11 | slicer | `slicer` | dCalendário.Date.Variation.Hierarquia de datas.Ano | 2 |
| 12 | FORNECEDOR | `slicer` | LANÇAMENTOS.FORNECEDOR | 1 |
| 13 | ETAPA | `slicer` | LANCAMENTOOBRA.ETAPA | 1 |
| 14 | TIPO DESPESA | `slicer` | CADASTROPRODUTO.TIPODESPESA | 1 |
| 15 | pivotTable | `pivotTable` | LANÇAMENTOS.EMPENHADO; LANÇAMENTOS.FORNECEDOR; LANÇAMENTOS.LIQUIDAÇÃO; LANÇAMENTOS.PRODUTO; MEDIDAS.PENDENTE PGTO; Sum(LANÇAMENTOS.EMPENHADO); Sum(LANÇAMENTOS.LIQUIDAÇÃO) | 2 |
| 16 | pivotTable | `pivotTable` | LANÇAMENTOS.EFETUADO; LANÇAMENTOS.ETAPA; LANÇAMENTOS.FORNECEDOR; MEDIDAS.PENDENTE PGTO; MEDIDAS.TOTAL P/ CASA; MEDIDAS.VALOR TOTAL; dCalendário.Date.Variation.Hierarquia de datas.Ano; dCalendário.Date.Variation.Hierarquia de datas.Mês; Sum(LANÇAMENTOS.EFETUADO); Divide(MEDIDAS.VALOR TOTAL, ScopedEval(MEDIDAS.VALOR TOTAL, [])) | 2 |
| 17 | barChart | `barChart` | LANÇAMENTOS.FORNECEDOR; MEDIDAS.LANÇAMENTOS; MEDIDAS.PENDENTE PGTO | 2 |
| 18 | waterfallChart | `waterfallChart` | LANÇAMENTOS.ETAPA; MEDIDAS.LANÇAMENTOS; Divide(MEDIDAS.LANÇAMENTOS, ScopedEval(MEDIDAS.LANÇAMENTOS, [])) | 2 |
| 19 | lineChart | `lineChart` | ACUMULADO.Início do Mês; ACUMULADO.TIPO; MEDIDAS.ACUMULADO CUSTO; select | 4 |
| 20 | FILIAL | `slicer` | FILIAIS.FILIAL | 2 |
| 21 | FlowVisual_C29F1DCC_81F5_4973_94AD_0517D44CC06A | `FlowVisual_C29F1DCC_81F5_4973_94AD_0517D44CC06A` | — | 0 |
| 22 | actionButton | `actionButton` | — | 0 |
| 23 | CUSTO / FILIAL | `columnChart` | FILIAIS.FILIAL; LANÇAMENTOS.EFETUADO; LANÇAMENTOS.EMPENHADO; LANÇAMENTOS.LIQUIDAÇÃO; Sum(LANÇAMENTOS.EFETUADO); Sum(LANÇAMENTOS.LIQUIDAÇÃO); Sum(LANÇAMENTOS.EMPENHADO) | 0 |
| 24 | TOTAL VIAGENS EM CAMPO | `card` | LANÇAMENTOS.PRODUTO; Min(LANÇAMENTOS.PRODUTO) | 3 |
| 25 | CUSTO/ETAPA | `barChart` | LANÇAMENTOS.ETAPA; MEDIDAS.LANÇAMENTOS | 5 |
| 26 | % TIPO DESPESA | `columnChart` | CADASTROPRODUTO.TIPODESPESA; FILIAIS.FILIAL; MEDIDAS.LANÇAMENTOS | 5 |
| 27 | PRINCIPAIS MATERIAIS | `barChart` | LANÇAMENTOS.FAMÍLIA; LANÇAMENTOS.GRUPO; LANÇAMENTOS.PRODUTO; LANÇAMENTOS.SUBFAMÍLIA; MEDIDAS.LANÇAMENTOS; MEDIDAS.PENDENTE PGTO | 3 |

**Interações:** F = filtrar, H = realçar, N = nenhuma. Metadados explícitos: F 68, H 0, N 16. Quando não houver aresta explícita, aplicar o comportamento padrão do Power BI: filtro/realce conforme o tipo do visual.

<details><summary>Matriz explícita de interação</summary>

- **tableEx (tableEx)** → **F:** PRINCIPAIS LANÇAMENTOS (barChart), barChart (barChart), CUSTO / FILIAL (columnChart), CUSTO/ETAPA (barChart), % TIPO DESPESA (columnChart), PRINCIPAIS MATERIAIS (barChart); **N:** lineChart (lineChart), TOTAL DESEMBOLSOS EFETUADOS (card), pivotTable (pivotTable)
- **lineChart (lineChart)** → **F:** PRINCIPAIS LANÇAMENTOS (barChart), barChart (barChart), CUSTO / FILIAL (columnChart), CUSTO / FILIAL (columnChart), % TIPO DESPESA (columnChart), CUSTO/ETAPA (barChart), PRINCIPAIS MATERIAIS (barChart), barChart (barChart), PRINCIPAIS MATERIAIS (barChart); **N:** TOTAL DESEMBOLSOS EFETUADOS (card), TOTAL DESEMBOLSOS EFETUADOS (card), lineChart (lineChart), pivotTable (pivotTable)
- **PRINCIPAIS LANÇAMENTOS (barChart)** → **F:** barChart (barChart), lineChart (lineChart), CUSTO / FILIAL (columnChart), pivotTable (pivotTable), % TIPO DESPESA (columnChart), CUSTO/ETAPA (barChart), PRINCIPAIS MATERIAIS (barChart); **N:** pivotTable (pivotTable)
- **barChart (barChart)** → **F:** PRINCIPAIS LANÇAMENTOS (barChart), lineChart (lineChart), pivotTable (pivotTable), CUSTO / FILIAL (columnChart), pivotTable (pivotTable), % TIPO DESPESA (columnChart), CUSTO/ETAPA (barChart), PRINCIPAIS MATERIAIS (barChart); **N:** lineChart (lineChart), TOTAL DESEMBOLSOS EFETUADOS (card)
- **pivotTable (pivotTable)** → **F:** barChart (barChart), PRINCIPAIS LANÇAMENTOS (barChart), CUSTO / FILIAL (columnChart), % TIPO DESPESA (columnChart), CUSTO/ETAPA (barChart), PRINCIPAIS MATERIAIS (barChart); **N:** TOTAL DESEMBOLSOS EFETUADOS (card), lineChart (lineChart), pivotTable (pivotTable)
- **waterfallChart (waterfallChart)** → **F:** TOTAL DESEMBOLSOS EFETUADOS (card), lineChart (lineChart), barChart (barChart), PRINCIPAIS LANÇAMENTOS (barChart), CUSTO / FILIAL (columnChart), CUSTO/ETAPA (barChart), % TIPO DESPESA (columnChart), PRINCIPAIS MATERIAIS (barChart); **N:** pivotTable (pivotTable)
- **PRODUTO (slicer)** → **F:** lineChart (lineChart); **N:** pivotTable (pivotTable)
- **FORNECEDOR (slicer)** → **F:** lineChart (lineChart)
- **CUSTO / FILIAL (columnChart)** → **F:** PRINCIPAIS LANÇAMENTOS (barChart), barChart (barChart), CUSTO/ETAPA (barChart), % TIPO DESPESA (columnChart), PRINCIPAIS MATERIAIS (barChart)
- **TIPO DESPESA (slicer)** → **N:** TOTAL VIAGENS EM CAMPO (card)
- **CUSTO/ETAPA (barChart)** → **F:** CUSTO / FILIAL (columnChart), PRINCIPAIS LANÇAMENTOS (barChart), barChart (barChart), % TIPO DESPESA (columnChart), PRINCIPAIS MATERIAIS (barChart)
- **% TIPO DESPESA (columnChart)** → **F:** CUSTO / FILIAL (columnChart), TOTAL VIAGENS EM CAMPO (card), PRINCIPAIS LANÇAMENTOS (barChart), CUSTO/ETAPA (barChart), barChart (barChart), PRINCIPAIS MATERIAIS (barChart)
- **PRINCIPAIS MATERIAIS (barChart)** → **F:** CUSTO / FILIAL (columnChart), TOTAL VIAGENS EM CAMPO (card), CUSTO/ETAPA (barChart), % TIPO DESPESA (columnChart), PRINCIPAIS LANÇAMENTOS (barChart), barChart (barChart)

</details>

### 5.3 RECURSOS HUMANOS

- **Canvas:** 3200 × 1515; **visuais:** 29; **interações explícitas:** 106.
- **Tabelas/áreas referenciadas:** `CADASTROPRODUTO`, `DESCRITIVOPRESENCA`, `FILIAIS`, `FORNECEDORES`, `LANCAMENTOOBRA`, `LANÇAMENTOS`, `MEDIDAS`, `dCalendário`.
- **Objetivo no portal:** presença, profissões, mão de obra, fornecedores, forma de pagamento e custos por filial/etapa.
- **Filtros de página configurados:** nenhum.

| # | Visual | Tipo | Campos/medidas | Filtros configurados |
|---:|---|---|---|---:|
| 1 | STATUS | `slicer` | FORNECEDORES.STATUS | 2 |
| 2 | FORNECEDOR | `slicer` | DESCRITIVOPRESENCA.FORNECEDOR | 2 |
| 3 | PRODUTO | `slicer` | LANÇAMENTOS.PRODUTO | 4 |
| 4 | PROFISSÃO | `slicer` | FORNECEDORES.PROFISSAO | 2 |
| 5 | ETAPA | `slicer` | LANÇAMENTOS.ETAPA | 1 |
| 6 | lineChart | `lineChart` | LANÇAMENTOS.TOTAL; LANÇAMENTOS.DATA PGTO EFETUADO.Variation.Hierarquia de datas.Ano; LANÇAMENTOS.DATA PGTO EFETUADO.Variation.Hierarquia de datas.Mês; Sum(LANÇAMENTOS.TOTAL) | 7 |
| 7 | FlowVisual_C29F1DCC_81F5_4973_94AD_0517D44CC06A | `FlowVisual_C29F1DCC_81F5_4973_94AD_0517D44CC06A` | — | 0 |
| 8 | actionButton | `actionButton` | — | 0 |
| 9 | CUSTO/FORNECEDOR | `barChart` | FORNECEDORES.FORNECEDOR; MEDIDAS.LANÇAMENTOS; MEDIDAS.PENDENTE PGTO | 5 |
| 10 | FILIAL | `slicer` | FILIAIS.FILIAL | 2 |
| 11 | MÃO DE OBRA/ETAPA | `clusteredBarChart` | LANCAMENTOOBRA.ETAPA; LANÇAMENTOS.TOTAL; Sum(LANÇAMENTOS.TOTAL) | 10 |
| 12 | VALORES PENDENTES PGTO | `barChart` | DESCRITIVOPRESENCA.FORNECEDOR; DESCRITIVOPRESENCA.VLR DIÁRIO; Sum(DESCRITIVOPRESENCA.VLR DIÁRIO) | 1 |
| 13 | tableEx | `tableEx` | LANÇAMENTOS.DATA PGTO EFETUADO; LANÇAMENTOS.FILIAL; LANÇAMENTOS.FORNECEDOR; LANÇAMENTOS.ID; LANÇAMENTOS.TOTAL; Sum(LANÇAMENTOS.TOTAL) | 3 |
| 14 | CUSTO/PROFISSÃO | `clusteredBarChart` | FORNECEDORES.PROFISSAO; MEDIDAS.LANÇAMENTOS | 14 |
| 15 | DATA | `slicer` | dCalendário.Date.Variation.Hierarquia de datas.Mês | 2 |
| 16 | slicer | `slicer` | dCalendário.Date.Variation.Hierarquia de datas.Ano | 2 |
| 17 | FORMA PGTO | `slicer` | LANÇAMENTOS.CONTA | 1 |
| 18 | TOTAL MÃO DE OBRA | `card` | LANÇAMENTOS.TOTAL; Sum(LANÇAMENTOS.TOTAL) | 2 |
| 19 | PROFISSÕES/DIA | `columnChart` | DESCRITIVOPRESENCA.FORNECEDOR; DESCRITIVOPRESENCA.PROFISSAO; CountNonNull(DESCRITIVOPRESENCA.FORNECEDOR); dCalendário.Date.Variation.Hierarquia de datas.Ano; dCalendário.Date.Variation.Hierarquia de datas.Mês; dCalendário.Date.Variation.Hierarquia de datas.Dia | 1 |
| 20 | DISTRIBUIÇÃO POR FORMA PGTO | `columnChart` | DESCRITIVOPRESENCA.FORMAPGTO; DESCRITIVOPRESENCA.FORNECEDOR; CountNonNull(DESCRITIVOPRESENCA.FORNECEDOR); dCalendário.Date.Variation.Hierarquia de datas.Ano; dCalendário.Date.Variation.Hierarquia de datas.Mês; dCalendário.Date.Variation.Hierarquia de datas.Dia | 1 |
| 21 | IMÓVEL | `slicer` | DESCRITIVOPRESENCA.IMOVEL | 1 |
| 22 | % TIPO DESPESA | `hundredPercentStackedColumnChart` | CADASTROPRODUTO.TIPODESPESA; FILIAIS.FILIAL; MEDIDAS.LANÇAMENTOS | 5 |
| 23 | MÃO DE OBRA/FILIAL | `columnChart` | FILIAIS.FILIAL; FORNECEDORES.FORNECEDOR; LANÇAMENTOS.EFETUADO; LANÇAMENTOS.EMPENHADO; LANÇAMENTOS.DATA PGTO EFETUADO.Variation.Hierarquia de datas.Ano; LANÇAMENTOS.DATA PGTO EFETUADO.Variation.Hierarquia de datas.Mês; Sum(LANÇAMENTOS.EFETUADO); Sum(LANÇAMENTOS.EMPENHADO) | 12 |
| 24 | PRESENÇAS/PROFISSIONAL | `barChart` | DESCRITIVOPRESENCA.FORMAPGTO; DESCRITIVOPRESENCA.FORNECEDOR; CountNonNull(DESCRITIVOPRESENCA.FORNECEDOR) | 5 |
| 25 | ATIVIDADE EXECUTADA | `slicer` | DESCRITIVOPRESENCA.ATIVIDADEEXECUTADA | 2 |
| 26 | VALOR PENDENTE | `card` | DESCRITIVOPRESENCA.VLR DIARIO; Sum(DESCRITIVOPRESENCA.VLR DIARIO) | 2 |
| 27 | slicer | `slicer` | LANCAMENTOOBRA.STATUS | 0 |
| 28 | barChart | `barChart` | DESCRITIVOPRESENCA.FORNECEDOR; DESCRITIVOPRESENCA.PROFISSAO; LANCAMENTOOBRA.ETAPA; CountNonNull(DESCRITIVOPRESENCA.FORNECEDOR) | 2 |
| 29 | tableEx | `tableEx` | DESCRITIVOPRESENCA.DataFormatada; DESCRITIVOPRESENCA.FORNECEDOR; DESCRITIVOPRESENCA.Id; DESCRITIVOPRESENCA.VLR DIÁRIO; CountNonNull(DESCRITIVOPRESENCA.Id); Sum(DESCRITIVOPRESENCA.VLR DIÁRIO) | 3 |

**Interações:** F = filtrar, H = realçar, N = nenhuma. Metadados explícitos: F 104, H 2, N 0. Quando não houver aresta explícita, aplicar o comportamento padrão do Power BI: filtro/realce conforme o tipo do visual.

<details><summary>Matriz explícita de interação</summary>

- **lineChart (lineChart)** → **F:** CUSTO/FORNECEDOR (barChart), MÃO DE OBRA/ETAPA (clusteredBarChart), CUSTO/PROFISSÃO (clusteredBarChart), VALORES PENDENTES PGTO (barChart), DISTRIBUIÇÃO POR FORMA PGTO (columnChart), MÃO DE OBRA/FILIAL (columnChart), PRESENÇAS/PROFISSIONAL (barChart), PROFISSÕES/DIA (columnChart), barChart (barChart), % TIPO DESPESA (hundredPercentStackedColumnChart)
- **MÃO DE OBRA/ETAPA (clusteredBarChart)** → **F:** VALORES PENDENTES PGTO (barChart), CUSTO/PROFISSÃO (clusteredBarChart), CUSTO/FORNECEDOR (barChart), % TIPO DESPESA (hundredPercentStackedColumnChart), PROFISSÕES/DIA (columnChart), MÃO DE OBRA/FILIAL (columnChart), DISTRIBUIÇÃO POR FORMA PGTO (columnChart), PRESENÇAS/PROFISSIONAL (barChart), barChart (barChart)
- **CUSTO/FORNECEDOR (barChart)** → **F:** MÃO DE OBRA/ETAPA (clusteredBarChart), CUSTO/PROFISSÃO (clusteredBarChart), VALORES PENDENTES PGTO (barChart), DISTRIBUIÇÃO POR FORMA PGTO (columnChart), % TIPO DESPESA (hundredPercentStackedColumnChart), PROFISSÕES/DIA (columnChart), PRESENÇAS/PROFISSIONAL (barChart), MÃO DE OBRA/FILIAL (columnChart), barChart (barChart)
- **CUSTO/PROFISSÃO (clusteredBarChart)** → **F:** MÃO DE OBRA/ETAPA (clusteredBarChart), CUSTO/FORNECEDOR (barChart), DISTRIBUIÇÃO POR FORMA PGTO (columnChart), VALORES PENDENTES PGTO (barChart), % TIPO DESPESA (hundredPercentStackedColumnChart), PROFISSÕES/DIA (columnChart), MÃO DE OBRA/FILIAL (columnChart), PRESENÇAS/PROFISSIONAL (barChart), barChart (barChart)
- **PROFISSÕES/DIA (columnChart)** → **F:** VALORES PENDENTES PGTO (barChart), MÃO DE OBRA/ETAPA (clusteredBarChart), CUSTO/PROFISSÃO (clusteredBarChart), CUSTO/FORNECEDOR (barChart), % TIPO DESPESA (hundredPercentStackedColumnChart), MÃO DE OBRA/FILIAL (columnChart), DISTRIBUIÇÃO POR FORMA PGTO (columnChart), PRESENÇAS/PROFISSIONAL (barChart), barChart (barChart)
- **VALORES PENDENTES PGTO (barChart)** → **F:** CUSTO/PROFISSÃO (clusteredBarChart), MÃO DE OBRA/ETAPA (clusteredBarChart), CUSTO/FORNECEDOR (barChart), DISTRIBUIÇÃO POR FORMA PGTO (columnChart), barChart (barChart), PROFISSÕES/DIA (columnChart), PRESENÇAS/PROFISSIONAL (barChart)
- **DISTRIBUIÇÃO POR FORMA PGTO (columnChart)** → **F:** MÃO DE OBRA/ETAPA (clusteredBarChart), CUSTO/PROFISSÃO (clusteredBarChart), VALORES PENDENTES PGTO (barChart), CUSTO/FORNECEDOR (barChart), PROFISSÕES/DIA (columnChart), % TIPO DESPESA (hundredPercentStackedColumnChart), MÃO DE OBRA/FILIAL (columnChart), PRESENÇAS/PROFISSIONAL (barChart), barChart (barChart)
- **tableEx (tableEx)** → **F:** MÃO DE OBRA/ETAPA (clusteredBarChart), CUSTO/FORNECEDOR (barChart), CUSTO/PROFISSÃO (clusteredBarChart), barChart (barChart); **H:** PROFISSÕES/DIA (columnChart), PRESENÇAS/PROFISSIONAL (barChart)
- **% TIPO DESPESA (hundredPercentStackedColumnChart)** → **F:** CUSTO/PROFISSÃO (clusteredBarChart), MÃO DE OBRA/ETAPA (clusteredBarChart), CUSTO/FORNECEDOR (barChart), VALORES PENDENTES PGTO (barChart), PROFISSÕES/DIA (columnChart), DISTRIBUIÇÃO POR FORMA PGTO (columnChart), MÃO DE OBRA/FILIAL (columnChart), PRESENÇAS/PROFISSIONAL (barChart), barChart (barChart)
- **MÃO DE OBRA/FILIAL (columnChart)** → **F:** CUSTO/FORNECEDOR (barChart), TOTAL MÃO DE OBRA (card), CUSTO/PROFISSÃO (clusteredBarChart), MÃO DE OBRA/ETAPA (clusteredBarChart), % TIPO DESPESA (hundredPercentStackedColumnChart), VALORES PENDENTES PGTO (barChart), DISTRIBUIÇÃO POR FORMA PGTO (columnChart), tableEx (tableEx), PRESENÇAS/PROFISSIONAL (barChart), PROFISSÕES/DIA (columnChart), barChart (barChart)
- **PRESENÇAS/PROFISSIONAL (barChart)** → **F:** MÃO DE OBRA/FILIAL (columnChart), MÃO DE OBRA/ETAPA (clusteredBarChart), PROFISSÕES/DIA (columnChart), CUSTO/PROFISSÃO (clusteredBarChart), CUSTO/FORNECEDOR (barChart), % TIPO DESPESA (hundredPercentStackedColumnChart), VALORES PENDENTES PGTO (barChart), DISTRIBUIÇÃO POR FORMA PGTO (columnChart), barChart (barChart)
- **barChart (barChart)** → **F:** DISTRIBUIÇÃO POR FORMA PGTO (columnChart), VALORES PENDENTES PGTO (barChart), CUSTO/FORNECEDOR (barChart), % TIPO DESPESA (hundredPercentStackedColumnChart), CUSTO/PROFISSÃO (clusteredBarChart), PRESENÇAS/PROFISSIONAL (barChart), PROFISSÕES/DIA (columnChart), MÃO DE OBRA/FILIAL (columnChart), MÃO DE OBRA/ETAPA (clusteredBarChart)

</details>

### 5.4 ETAPA OBRA

- **Canvas:** 3200 × 1515; **visuais:** 21; **interações explícitas:** 108.
- **Tabelas/áreas referenciadas:** `APONTAMENTOSFUNCIONARIOS`, `CADASTROPRODUTO`, `DESCRITIVOPRESENCA`, `FILIAIS`, `FORNECEDORES`, `LANCAMENTOOBRA`, `LANÇAMENTOS`, `MEDIDAS`, `dCalendário`.
- **Objetivo no portal:** cronograma físico, andamento por etapa, custos, mão de obra, fornecedores e distribuição de despesas.
- **Filtros de página configurados:** `LANCAMENTOOBRA.FILIAL`; `LANCAMENTOOBRA.INDICE`.

| # | Visual | Tipo | Campos/medidas | Filtros configurados |
|---:|---|---|---|---:|
| 1 | Gantt1448688115699 | `Gantt1448688115699` | LANCAMENTOOBRA.DATA EM ATENDIMENTO; LANCAMENTOOBRA.DATA INICIO CORRIGIDA; LANCAMENTOOBRA.DIAS; LANCAMENTOOBRA.ETAPA ORDENADA; LANCAMENTOOBRA.PERCENTUALEFETUADO; Sum(LANCAMENTOOBRA.PERCENTUALEFETUADO); Min(LANCAMENTOOBRA.DATA EM ATENDIMENTO) | 6 |
| 2 | FILIAL | `slicer` | FILIAIS.FILIAL | 2 |
| 3 | barChart | `barChart` | LANÇAMENTOS.FORNECEDOR; MEDIDAS.LANÇAMENTOS; MEDIDAS.PENDENTE PGTO | 2 |
| 4 | % PRODUTO | `barChart` | LANÇAMENTOS.FAMÍLIA; LANÇAMENTOS.GRUPO; LANÇAMENTOS.PRODUTO; LANÇAMENTOS.SUBFAMÍLIA; MEDIDAS.LANÇAMENTOS; MEDIDAS.PENDENTE PGTO | 2 |
| 5 | ETAPA | `slicer` | LANCAMENTOOBRA.ETAPA | 1 |
| 6 | FORNECEDOR | `slicer` | FORNECEDORES.FORNECEDOR | 1 |
| 7 | PRODUTO | `slicer` | LANÇAMENTOS.PRODUTO | 1 |
| 8 | TIPO | `slicer` | FORNECEDORES.TIPO | 1 |
| 9 | DATA | `slicer` | dCalendário.Date.Variation.Hierarquia de datas.Mês | 3 |
| 10 | slicer | `slicer` | dCalendário.Date.Variation.Hierarquia de datas.Ano | 2 |
| 11 | slicer | `slicer` | LANCAMENTOOBRA.STATUS | 0 |
| 12 | columnChart | `columnChart` | DESCRITIVOPRESENCA.FORNECEDOR; DESCRITIVOPRESENCA.PROFISSAO; CountNonNull(DESCRITIVOPRESENCA.FORNECEDOR); dCalendário.Date.Variation.Hierarquia de datas.Ano; dCalendário.Date.Variation.Hierarquia de datas.Mês; dCalendário.Date.Variation.Hierarquia de datas.Dia | 1 |
| 13 | barChart | `barChart` | DESCRITIVOPRESENCA.FORMAPGTO; DESCRITIVOPRESENCA.FORNECEDOR; FORNECEDORES.FORNECEDOR; CountNonNull(DESCRITIVOPRESENCA.FORNECEDOR) | 5 |
| 14 | barChart | `barChart` | DESCRITIVOPRESENCA.FORNECEDOR; DESCRITIVOPRESENCA.PROFISSAO; LANCAMENTOOBRA.ETAPA; CountNonNull(DESCRITIVOPRESENCA.FORNECEDOR) | 1 |
| 15 | barChart | `barChart` | DESCRITIVOPRESENCA.ATIVIDADEEXECUTADA; DESCRITIVOPRESENCA.FORNECEDOR; DESCRITIVOPRESENCA.PROFISSAO; CountNonNull(DESCRITIVOPRESENCA.FORNECEDOR) | 1 |
| 16 | DISTRIBUIÇÃO POR FORMA PGTO | `columnChart` | DESCRITIVOPRESENCA.FORMAPGTO; DESCRITIVOPRESENCA.FORNECEDOR; CountNonNull(DESCRITIVOPRESENCA.FORNECEDOR); dCalendário.Date.Variation.Hierarquia de datas.Ano; dCalendário.Date.Variation.Hierarquia de datas.Mês; dCalendário.Date.Variation.Hierarquia de datas.Dia | 1 |
| 17 | barChart | `barChart` | APONTAMENTOSFUNCIONARIOS.FORNECEDOR; APONTAMENTOSFUNCIONARIOS.TIPO; LANCAMENTOOBRA.ETAPA; CountNonNull(APONTAMENTOSFUNCIONARIOS.FORNECEDOR) | 1 |
| 18 | FlowVisual_C29F1DCC_81F5_4973_94AD_0517D44CC06A | `FlowVisual_C29F1DCC_81F5_4973_94AD_0517D44CC06A` | — | 0 |
| 19 | actionButton | `actionButton` | — | 0 |
| 20 | % TIPO DESPESA | `columnChart` | CADASTROPRODUTO.TIPODESPESA; FILIAIS.FILIAL; MEDIDAS.LANÇAMENTOS | 5 |
| 21 | TIPO DESPESA/ETAPA | `barChart` | CADASTROPRODUTO.TIPODESPESA; LANÇAMENTOS.ETAPA; MEDIDAS.LANÇAMENTOS; Divide(MEDIDAS.LANÇAMENTOS, ScopedEval(MEDIDAS.LANÇAMENTOS, [])) | 2 |

**Interações:** F = filtrar, H = realçar, N = nenhuma. Metadados explícitos: F 94, H 0, N 14. Quando não houver aresta explícita, aplicar o comportamento padrão do Power BI: filtro/realce conforme o tipo do visual.

<details><summary>Matriz explícita de interação</summary>

- **Gantt1448688115699 (Gantt1448688115699)** → **F:** barChart (barChart), % PRODUTO (barChart), FORNECEDOR (slicer), ETAPA (slicer), columnChart (columnChart), barChart (barChart), barChart (barChart), DISTRIBUIÇÃO POR FORMA PGTO (columnChart), barChart (barChart), barChart (barChart), % TIPO DESPESA (columnChart), TIPO DESPESA/ETAPA (barChart)
- **% PRODUTO (barChart)** → **F:** barChart (barChart), Gantt1448688115699 (Gantt1448688115699), ETAPA (slicer), barChart (barChart), columnChart (columnChart), barChart (barChart), DISTRIBUIÇÃO POR FORMA PGTO (columnChart), barChart (barChart), % TIPO DESPESA (columnChart), TIPO DESPESA/ETAPA (barChart)
- **barChart (barChart)** → **F:** % PRODUTO (barChart), Gantt1448688115699 (Gantt1448688115699), ETAPA (slicer), barChart (barChart), columnChart (columnChart), columnChart (columnChart), % PRODUTO (barChart), barChart (barChart), Gantt1448688115699 (Gantt1448688115699), barChart (barChart), columnChart (columnChart), barChart (barChart), barChart (barChart), % PRODUTO (barChart), barChart (barChart), barChart (barChart), columnChart (columnChart), barChart (barChart), barChart (barChart), barChart (barChart), DISTRIBUIÇÃO POR FORMA PGTO (columnChart), barChart (barChart), barChart (barChart), TIPO (slicer), DISTRIBUIÇÃO POR FORMA PGTO (columnChart), DISTRIBUIÇÃO POR FORMA PGTO (columnChart), barChart (barChart), DISTRIBUIÇÃO POR FORMA PGTO (columnChart), barChart (barChart), % TIPO DESPESA (columnChart), % TIPO DESPESA (columnChart), % TIPO DESPESA (columnChart), % TIPO DESPESA (columnChart), % TIPO DESPESA (columnChart), barChart (barChart), TIPO DESPESA/ETAPA (barChart), TIPO DESPESA/ETAPA (barChart), TIPO DESPESA/ETAPA (barChart), TIPO DESPESA/ETAPA (barChart), TIPO DESPESA/ETAPA (barChart); **N:** % PRODUTO (barChart), barChart (barChart), columnChart (columnChart), DISTRIBUIÇÃO POR FORMA PGTO (columnChart), barChart (barChart), barChart (barChart), barChart (barChart)
- **columnChart (columnChart)** → **F:** barChart (barChart), Gantt1448688115699 (Gantt1448688115699), barChart (barChart), % PRODUTO (barChart), barChart (barChart), barChart (barChart), DISTRIBUIÇÃO POR FORMA PGTO (columnChart), % TIPO DESPESA (columnChart), TIPO DESPESA/ETAPA (barChart); **N:** barChart (barChart)
- **DISTRIBUIÇÃO POR FORMA PGTO (columnChart)** → **F:** barChart (barChart), barChart (barChart), columnChart (columnChart), barChart (barChart), barChart (barChart), % PRODUTO (barChart), barChart (barChart), % TIPO DESPESA (columnChart), TIPO DESPESA/ETAPA (barChart)
- **% TIPO DESPESA (columnChart)** → **F:** barChart (barChart), % PRODUTO (barChart), barChart (barChart), TIPO DESPESA/ETAPA (barChart); **N:** Gantt1448688115699 (Gantt1448688115699), DISTRIBUIÇÃO POR FORMA PGTO (columnChart), columnChart (columnChart), barChart (barChart), barChart (barChart), barChart (barChart)
- **TIPO DESPESA/ETAPA (barChart)** → **F:** barChart (barChart), columnChart (columnChart), DISTRIBUIÇÃO POR FORMA PGTO (columnChart), % TIPO DESPESA (columnChart), barChart (barChart), barChart (barChart), Gantt1448688115699 (Gantt1448688115699), barChart (barChart), barChart (barChart), % PRODUTO (barChart)

</details>

### 5.5 COMERCIAL

- **Canvas:** 3200 × 1515; **visuais:** 18; **interações explícitas:** 25.
- **Tabelas/áreas referenciadas:** `APONTAMENTOSCOMERCIAIS`, `CADASTRO CLIENTE`, `FILIAIS`, `HOMOLOGACAOCOMERCIAL`, `IMOVEL CADASTRADO`, `LANCAMENTOCOMPRAS`, `LANÇAMENTORECEITA`, `LANÇAMENTOS`, `dCalendário`.
- **Objetivo no portal:** receitas, clientes, corretores, imóveis, documentação e cronograma comercial.
- **Filtros de página configurados:** nenhum.

| # | Visual | Tipo | Campos/medidas | Filtros configurados |
|---:|---|---|---|---:|
| 1 | lineChart | `lineChart` | LANÇAMENTORECEITA.VALORTOTAL; LANÇAMENTORECEITA.DATAPGTOEFETUADO.Variation.Hierarquia de datas.Ano; LANÇAMENTORECEITA.DATAPGTOEFETUADO.Variation.Hierarquia de datas.Mês; LANÇAMENTORECEITA.DATAPGTOEFETUADO.Variation.Hierarquia de datas.Dia; Sum(LANÇAMENTORECEITA.VALORTOTAL) | 5 |
| 2 | FlowVisual_C29F1DCC_81F5_4973_94AD_0517D44CC06A | `FlowVisual_C29F1DCC_81F5_4973_94AD_0517D44CC06A` | — | 0 |
| 3 | actionButton | `actionButton` | — | 0 |
| 4 | FILIAL | `slicer` | FILIAIS.FILIAL | 2 |
| 5 | RECEITA/CLIENTE | `barChart` | CADASTRO CLIENTE.NOME; LANÇAMENTORECEITA.VALORPAGO; LANÇAMENTORECEITA.VALOR_NAO_PAGO; Sum(LANÇAMENTORECEITA.VALOR_NAO_PAGO); Sum(LANÇAMENTORECEITA.VALORPAGO) | 9 |
| 6 | VENDAS/CORRETOR | `barChart` | LANCAMENTOCOMPRAS.CORRETOR; LANÇAMENTORECEITA.VALORPAGO; LANÇAMENTORECEITA.VALOR_NAO_PAGO; Sum(LANÇAMENTORECEITA.VALORPAGO); Sum(LANÇAMENTORECEITA.VALOR_NAO_PAGO) | 14 |
| 7 | DATA | `slicer` | dCalendário.Date.Variation.Hierarquia de datas.Mês | 2 |
| 8 | slicer | `slicer` | dCalendário.Date.Variation.Hierarquia de datas.Ano | 2 |
| 9 | FORMA PGTO | `slicer` | LANÇAMENTOS.CONTA | 1 |
| 10 | TOTAL VENDAS | `card` | LANÇAMENTORECEITA.VALORTOTAL; Sum(LANÇAMENTORECEITA.VALORTOTAL) | 1 |
| 11 | DOCUMENTOS/FILIAL | `barChart` | HOMOLOGACAOCOMERCIAL.CLIENTE; HOMOLOGACAOCOMERCIAL.FILIAL; HOMOLOGACAOCOMERCIAL.TIPODOCUMENTO; CountNonNull(HOMOLOGACAOCOMERCIAL.CLIENTE) | 1 |
| 12 | IMÓVEIS/FILIAL | `hundredPercentStackedColumnChart` | FILIAIS.FILIAL; IMOVEL CADASTRADO.IMOVEL; IMOVEL CADASTRADO.STATUS; CountNonNull(IMOVEL CADASTRADO.IMOVEL) | 3 |
| 13 | RECEITA/FILIAL | `columnChart` | FILIAIS.FILIAL; LANÇAMENTORECEITA.VALORPAGO; LANÇAMENTORECEITA.VALOR_NAO_PAGO; dCalendário.Date.Variation.Hierarquia de datas.Ano; dCalendário.Date.Variation.Hierarquia de datas.Trimestre; dCalendário.Date.Variation.Hierarquia de datas.Mês; dCalendário.Date.Variation.Hierarquia de datas.Dia; Sum(LANÇAMENTORECEITA.VALORPAGO); Sum(LANÇAMENTORECEITA.VALOR_NAO_PAGO) | 15 |
| 14 | TOTAL RECEITAS | `card` | LANÇAMENTORECEITA.VALORPAGO; Sum(LANÇAMENTORECEITA.VALORPAGO) | 2 |
| 15 | DOCUMENTOS/IMÓVEL | `barChart` | HOMOLOGACAOCOMERCIAL.CLIENTE; HOMOLOGACAOCOMERCIAL.IMOVEL; HOMOLOGACAOCOMERCIAL.TIPODOCUMENTO; CountNonNull(HOMOLOGACAOCOMERCIAL.CLIENTE) | 1 |
| 16 | DOCUMENTOS | `tableEx` | LANÇAMENTORECEITA.DATA; LANÇAMENTORECEITA.DATAPGTOEFETUADO; LANÇAMENTORECEITA.DESCRIÇÃO; LANÇAMENTORECEITA.FILIAL; LANÇAMENTORECEITA.FORMAPGTO; LANÇAMENTORECEITA.FORNECEDOR; LANÇAMENTORECEITA.VALORTOTAL; Sum(LANÇAMENTORECEITA.VALORTOTAL) | 1 |
| 17 | Gantt1448688115699 | `Gantt1448688115699` | APONTAMENTOSCOMERCIAIS.%; APONTAMENTOSCOMERCIAIS.DATA EM ATENDIMENTO; APONTAMENTOSCOMERCIAIS.DATAINICIO; APONTAMENTOSCOMERCIAIS.DIAS; APONTAMENTOSCOMERCIAIS.TIPOMARCO; Min(APONTAMENTOSCOMERCIAIS.DATA EM ATENDIMENTO); Sum(APONTAMENTOSCOMERCIAIS.%) | 0 |
| 18 | IMÓVEL | `slicer` | APONTAMENTOSCOMERCIAIS.IMOVEL | 0 |

**Interações:** F = filtrar, H = realçar, N = nenhuma. Metadados explícitos: F 25, H 0, N 0. Quando não houver aresta explícita, aplicar o comportamento padrão do Power BI: filtro/realce conforme o tipo do visual.

<details><summary>Matriz explícita de interação</summary>

- **RECEITA/CLIENTE (barChart)** → **F:** VENDAS/CORRETOR (barChart), IMÓVEIS/FILIAL (hundredPercentStackedColumnChart), DOCUMENTOS/FILIAL (barChart), RECEITA/FILIAL (columnChart)
- **lineChart (lineChart)** → **F:** RECEITA/CLIENTE (barChart), VENDAS/CORRETOR (barChart), RECEITA/FILIAL (columnChart), DOCUMENTOS/FILIAL (barChart)
- **VENDAS/CORRETOR (barChart)** → **F:** RECEITA/CLIENTE (barChart), IMÓVEIS/FILIAL (hundredPercentStackedColumnChart), DOCUMENTOS/FILIAL (barChart), RECEITA/FILIAL (columnChart)
- **DOCUMENTOS/FILIAL (barChart)** → **F:** RECEITA/CLIENTE (barChart), VENDAS/CORRETOR (barChart), IMÓVEIS/FILIAL (hundredPercentStackedColumnChart), RECEITA/FILIAL (columnChart)
- **IMÓVEIS/FILIAL (hundredPercentStackedColumnChart)** → **F:** VENDAS/CORRETOR (barChart), RECEITA/CLIENTE (barChart), DOCUMENTOS/FILIAL (barChart), RECEITA/FILIAL (columnChart)
- **RECEITA/FILIAL (columnChart)** → **F:** TOTAL VENDAS (card), VENDAS/CORRETOR (barChart), RECEITA/CLIENTE (barChart), IMÓVEIS/FILIAL (hundredPercentStackedColumnChart), DOCUMENTOS/FILIAL (barChart)

</details>

### 5.6 AUDITORIA

- **Canvas:** 3200 × 1515; **visuais:** 17; **interações explícitas:** 37.
- **Tabelas/áreas referenciadas:** `CADASTRO TIPO DOCUMENTO`, `DIÁRIO DE OBRAS`, `FILIAIS`, `NOTASPENDENTES`, `Tabela_Documentos`.
- **Objetivo no portal:** pendências documentais, homologações, diários de obra e notas fiscais pendentes.
- **Filtros de página configurados:** nenhum.

| # | Visual | Tipo | Campos/medidas | Filtros configurados |
|---:|---|---|---|---:|
| 1 | STATUS POR HOMOLOGAÇÃO | `columnChart` | CADASTRO TIPO DOCUMENTO.HOMOLOGAÇÃO; Tabela_Documentos.STATUS; Tabela_Documentos.TIPODOCUMENTO; CountNonNull(Tabela_Documentos.TIPODOCUMENTO) | 0 |
| 2 | STATUS PENDENTE POR HOMOLOGAÇÃO | `hundredPercentStackedColumnChart` | CADASTRO TIPO DOCUMENTO.HOMOLOGAÇÃO; Tabela_Documentos.TIPODOCUMENTO; CountNonNull(Tabela_Documentos.TIPODOCUMENTO) | 1 |
| 3 | STATUS PENDENTE POR TIPO DOC | `barChart` | Tabela_Documentos.STATUS; Tabela_Documentos.TIPODOCUMENTO; CountNonNull(Tabela_Documentos.TIPODOCUMENTO) | 0 |
| 4 | STATUS POR TIPO DOCUMENTO | `barChart` | Tabela_Documentos.STATUS; Tabela_Documentos.TIPODOCUMENTO; CountNonNull(Tabela_Documentos.TIPODOCUMENTO) | 0 |
| 5 | STATUS POR FORNECEDOR | `barChart` | Tabela_Documentos.FORNECEDOR; Tabela_Documentos.STATUS; Tabela_Documentos.TIPODOCUMENTO; CountNonNull(Tabela_Documentos.TIPODOCUMENTO) | 0 |
| 6 | STATUS POR HOMOLOGAÇÃO FILIAL | `columnChart` | Tabela_Documentos.FILIAL; Tabela_Documentos.STATUS; Tabela_Documentos.TIPODOCUMENTO; CountNonNull(Tabela_Documentos.TIPODOCUMENTO) | 0 |
| 7 | STATUS DIÁRIOS DE OBRA | `columnChart` | DIÁRIO DE OBRAS.DATA; DIÁRIO DE OBRAS.FILIAL; DIÁRIO DE OBRAS.STATUS; CountNonNull(DIÁRIO DE OBRAS.DATA) | 1 |
| 8 | tableEx | `tableEx` | Tabela_Documentos.Created; Tabela_Documentos.DATASUBMETIDO; Tabela_Documentos.FILIAL; Tabela_Documentos.FORNECEDOR; Tabela_Documentos.STATUS; Tabela_Documentos.TIPODOCUMENTO | 1 |
| 9 | tableEx | `tableEx` | DIÁRIO DE OBRAS.DATA; DIÁRIO DE OBRAS.FILIAL; DIÁRIO DE OBRAS.Id; DIÁRIO DE OBRAS.RESPONSAVELTECNICO; DIÁRIO DE OBRAS.STATUS | 1 |
| 10 | NOTAS FISCAIS PEND. LANÇAMENTO | `barChart` | NOTASPENDENTES.FORNECEDOR; NOTASPENDENTES.STATUS; NOTASPENDENTES.VALORTOTAL; Sum(NOTASPENDENTES.VALORTOTAL) | 0 |
| 11 | FILIAL | `slicer` | FILIAIS.FILIAL | 2 |
| 12 | STATUS | `slicer` | Tabela_Documentos.STATUS | 2 |
| 13 | TIPO DOC | `slicer` | Tabela_Documentos.TIPODOCUMENTO | 2 |
| 14 | FORNECEDOR | `slicer` | Tabela_Documentos.FORNECEDOR | 2 |
| 15 | STATUS PENDENTE POR HOMOLOGAÇÃO | `hundredPercentStackedColumnChart` | Tabela_Documentos.FILIAL; Tabela_Documentos.TIPODOCUMENTO; CountNonNull(Tabela_Documentos.TIPODOCUMENTO) | 1 |
| 16 | DIÁRIOS PENDENTES | `card` | DIÁRIO DE OBRAS.DIARIOSPENDENTES | 2 |
| 17 | HOMOLOGAÇÕES PENDENTES | `card` | Tabela_Documentos.TIPODOCUMENTO; Min(Tabela_Documentos.TIPODOCUMENTO) | 2 |

**Interações:** F = filtrar, H = realçar, N = nenhuma. Metadados explícitos: F 37, H 0, N 0. Quando não houver aresta explícita, aplicar o comportamento padrão do Power BI: filtro/realce conforme o tipo do visual.

<details><summary>Matriz explícita de interação</summary>

- **STATUS POR FORNECEDOR (barChart)** → **F:** STATUS PENDENTE POR TIPO DOC (barChart), STATUS POR TIPO DOCUMENTO (barChart), STATUS POR HOMOLOGAÇÃO (columnChart), STATUS PENDENTE POR HOMOLOGAÇÃO (hundredPercentStackedColumnChart), STATUS POR HOMOLOGAÇÃO FILIAL (columnChart)
- **STATUS POR HOMOLOGAÇÃO (columnChart)** → **F:** STATUS POR FORNECEDOR (barChart), STATUS PENDENTE POR TIPO DOC (barChart), STATUS POR TIPO DOCUMENTO (barChart), STATUS PENDENTE POR HOMOLOGAÇÃO (hundredPercentStackedColumnChart), STATUS POR HOMOLOGAÇÃO FILIAL (columnChart)
- **STATUS PENDENTE POR TIPO DOC (barChart)** → **F:** STATUS POR FORNECEDOR (barChart), STATUS POR HOMOLOGAÇÃO (columnChart), STATUS PENDENTE POR HOMOLOGAÇÃO (hundredPercentStackedColumnChart), STATUS POR TIPO DOCUMENTO (barChart), STATUS POR HOMOLOGAÇÃO FILIAL (columnChart)
- **STATUS PENDENTE POR HOMOLOGAÇÃO (hundredPercentStackedColumnChart)** → **F:** STATUS POR HOMOLOGAÇÃO (columnChart), STATUS POR FORNECEDOR (barChart), STATUS PENDENTE POR TIPO DOC (barChart), STATUS POR TIPO DOCUMENTO (barChart), STATUS POR HOMOLOGAÇÃO FILIAL (columnChart), STATUS POR HOMOLOGAÇÃO (columnChart), STATUS POR FORNECEDOR (barChart), NOTAS FISCAIS PEND. LANÇAMENTO (barChart), STATUS POR HOMOLOGAÇÃO FILIAL (columnChart), STATUS PENDENTE POR TIPO DOC (barChart), STATUS PENDENTE POR HOMOLOGAÇÃO (hundredPercentStackedColumnChart)
- **STATUS POR TIPO DOCUMENTO (barChart)** → **F:** STATUS PENDENTE POR HOMOLOGAÇÃO (hundredPercentStackedColumnChart), STATUS POR HOMOLOGAÇÃO (columnChart), STATUS POR FORNECEDOR (barChart), STATUS PENDENTE POR TIPO DOC (barChart), STATUS POR HOMOLOGAÇÃO FILIAL (columnChart)
- **STATUS DIÁRIOS DE OBRA (columnChart)** → **F:** STATUS POR HOMOLOGAÇÃO FILIAL (columnChart), STATUS POR HOMOLOGAÇÃO (columnChart), STATUS POR TIPO DOCUMENTO (barChart), STATUS POR FORNECEDOR (barChart), STATUS PENDENTE POR TIPO DOC (barChart), STATUS PENDENTE POR HOMOLOGAÇÃO (hundredPercentStackedColumnChart)

</details>

### 5.7 IMOBILIZADO

- **Canvas:** 3200 × 1515; **visuais:** 28; **interações explícitas:** 33.
- **Tabelas/áreas referenciadas:** `ACUMULADO (2)`, `FILIAIS`, `FORNECEDORES`, `IMOBILIZADOS`, `LANÇAMENTOS`, `MEDIDAS`, `dCalendário`.
- **Objetivo no portal:** cadastro patrimonial, aquisição, valor atual, depreciação, residual e distribuição por item/grupo/função.
- **Filtros de página configurados:** nenhum.

| # | Visual | Tipo | Campos/medidas | Filtros configurados |
|---:|---|---|---|---:|
| 1 | tableEx | `tableEx` | IMOBILIZADOS.DATACADASTRO; IMOBILIZADOS.DATACOMPRA; IMOBILIZADOS.DATADEPRECIAÇÃO; IMOBILIZADOS.FILIAL; IMOBILIZADOS.ITEM; IMOBILIZADOS.NÚMEROIMOBILIZADO; IMOBILIZADOS.OData_%DEPRECIACAO; IMOBILIZADOS.QTD; IMOBILIZADOS.VALORESTIMADO; IMOBILIZADOS.VLRRESIDUAL; IMOBILIZADOS.VALOR DEPRECIADO; Sum(IMOBILIZADOS.VALORESTIMADO); Sum(IMOBILIZADOS.VALORRESIDUAL) | 0 |
| 2 | % PRODUTO | `clusteredBarChart` | LANÇAMENTOS.PRODUTO; MEDIDAS.LANÇAMENTOS | 3 |
| 3 | lineChart | `lineChart` | ACUMULADO (2).Início do Mês; MEDIDAS.ACUMULADO DEPRECIADO; select | 9 |
| 4 | tableEx | `tableEx` | IMOBILIZADOS.FUNÇÃO; IMOBILIZADOS.GRUPOIMOBILIZADO; LANÇAMENTOS.DATA; LANÇAMENTOS.DATA PGTO EFETUADO; LANÇAMENTOS.EFETUADO; LANÇAMENTOS.EMPENHADO; LANÇAMENTOS.FORNECEDOR; LANÇAMENTOS.LIQUIDAÇÃO; LANÇAMENTOS.PRODUTO; LANÇAMENTOS.QTD; LANÇAMENTOS.TOTAL; LANÇAMENTOS.VALOR UNITÁRIO; Sum(LANÇAMENTOS.EMPENHADO); Sum(LANÇAMENTOS.LIQUIDAÇÃO); Sum(LANÇAMENTOS.EFETUADO); Sum(LANÇAMENTOS.QTD); Sum(LANÇAMENTOS.TOTAL) | 2 |
| 5 | lineChart | `lineChart` | LANÇAMENTOS.EFETUADO; Sum(LANÇAMENTOS.EFETUADO); LANÇAMENTOS.DATA PGTO EFETUADO.Variation.Hierarquia de datas.Ano; LANÇAMENTOS.DATA PGTO EFETUADO.Variation.Hierarquia de datas.Mês | 1 |
| 6 | clusteredColumnChart | `clusteredColumnChart` | FILIAIS.FILIAL; IMOBILIZADOS.VLRRESIDUAL; LANÇAMENTOS.EFETUADO; Sum(IMOBILIZADOS.VLRRESIDUAL); Sum(LANÇAMENTOS.EFETUADO) | 1 |
| 7 | barChart | `barChart` | IMOBILIZADOS.FORNECEDOR; IMOBILIZADOS.VLRRESIDUAL; IMOBILIZADOS.VALOR DEPRECIADO; Sum(IMOBILIZADOS.VLRRESIDUAL) | 1 |
| 8 | slicer | `slicer` | LANÇAMENTOS.CONCLUÍDO | 1 |
| 9 | slicer | `slicer` | LANÇAMENTOS.FORNECEDOR | 1 |
| 10 | slicer | `slicer` | LANÇAMENTOS.PRODUTO | 2 |
| 11 | slicer | `slicer` | FORNECEDORES.PROFISSAO | 1 |
| 12 | slicer | `slicer` | ACUMULADO (2).ETAPA | 1 |
| 13 | slicer | `slicer` | LANÇAMENTOS.FILIAL | 1 |
| 14 | slicer | `slicer` | dCalendário.Date.Variation.Hierarquia de datas.Mês | 2 |
| 15 | slicer | `slicer` | dCalendário.Date.Variation.Hierarquia de datas.Ano | 1 |
| 16 | slicer | `slicer` | LANÇAMENTOS.CONTA | 1 |
| 17 | slicer | `slicer` | LANÇAMENTOS.TIPO DESPESA | 1 |
| 18 | barChart | `barChart` | IMOBILIZADOS.ITEM; IMOBILIZADOS.VLRRESIDUAL; IMOBILIZADOS.VALOR DEPRECIADO; Sum(IMOBILIZADOS.VLRRESIDUAL) | 1 |
| 19 | barChart | `barChart` | IMOBILIZADOS.GRUPOIMOBILIZADO; IMOBILIZADOS.VLRRESIDUAL; IMOBILIZADOS.VALOR DEPRECIADO; Sum(IMOBILIZADOS.VLRRESIDUAL) | 1 |
| 20 | VALOR ATUAL | `card` | IMOBILIZADOS.VLRRESIDUAL; Sum(IMOBILIZADOS.VLRRESIDUAL) | 1 |
| 21 | VALOR INICIAL | `card` | IMOBILIZADOS.VALORESTIMADO; Sum(IMOBILIZADOS.VALORESTIMADO) | 0 |
| 22 | VALOR DEPRECIADO | `card` | IMOBILIZADOS.VALOR DEPRECIADO | 1 |
| 23 | barChart | `barChart` | IMOBILIZADOS.FUNÇÃO; IMOBILIZADOS.VLRRESIDUAL; IMOBILIZADOS.VALOR DEPRECIADO; Sum(IMOBILIZADOS.VLRRESIDUAL) | 1 |
| 24 | % MED A DEPRECIAR %2F MÊS | `card` | IMOBILIZADOS.% MED DEPRECIADO | 2 |
| 25 | VALORES A DEPRECIAR | `card` | IMOBILIZADOS.VALORES A DEPRECIAR | 3 |
| 26 | DATA | `card` | IMOBILIZADOS.DATADEPRECIAÇÃO; Min(IMOBILIZADOS.DATADEPRECIAÇÃO) | 1 |
| 27 | FlowVisual_C29F1DCC_81F5_4973_94AD_0517D44CC06A | `FlowVisual_C29F1DCC_81F5_4973_94AD_0517D44CC06A` | — | 0 |
| 28 | actionButton | `actionButton` | — | 0 |

**Interações:** F = filtrar, H = realçar, N = nenhuma. Metadados explícitos: F 31, H 2, N 0. Quando não houver aresta explícita, aplicar o comportamento padrão do Power BI: filtro/realce conforme o tipo do visual.

<details><summary>Matriz explícita de interação</summary>

- **tableEx (tableEx)** → **F:** barChart (barChart), lineChart (lineChart), % PRODUTO (clusteredBarChart); **H:** clusteredColumnChart (clusteredColumnChart)
- **clusteredColumnChart (clusteredColumnChart)** → **F:** barChart (barChart), % PRODUTO (clusteredBarChart), barChart (barChart), barChart (barChart), VALOR INICIAL (card), barChart (barChart)
- **barChart (barChart)** → **F:** % PRODUTO (clusteredBarChart), clusteredColumnChart (clusteredColumnChart), barChart (barChart), % PRODUTO (clusteredBarChart), barChart (barChart), barChart (barChart), barChart (barChart), % PRODUTO (clusteredBarChart), VALOR INICIAL (card), barChart (barChart), clusteredColumnChart (clusteredColumnChart), barChart (barChart), barChart (barChart), % PRODUTO (clusteredBarChart), VALOR INICIAL (card), barChart (barChart), barChart (barChart), clusteredColumnChart (clusteredColumnChart)
- **slicer (slicer)** → **F:** barChart (barChart)
- **% PRODUTO (clusteredBarChart)** → **F:** VALOR INICIAL (card), slicer (slicer), barChart (barChart); **H:** clusteredColumnChart (clusteredColumnChart)

</details>

## 6. Filtros persistidos

- **Filtro global ativo:** `DESCRITIVOPRESENCA.PRESENCA` In `PRESENTE`.
- **Filtro da página ETAPA OBRA:** `LANCAMENTOOBRA.FILIAL` com modo de seleção invertida configurado e `LANCAMENTOOBRA.INDICE` no painel avançado; não há valor persistido nesses dois filtros.
- **Filtros de visual:** reproduzir os campos registrados na tabela de cada página. Valores e condições selecionados pelo usuário devem ficar no estado da rota e ser limpos por um comando único “Limpar filtros”.
- **Sincronização:** os slicers de filial e calendário devem alimentar todos os visuais compatíveis da página. O filtro global de presença deve ser aplicado antes de qualquer agregação de RH/obra.

## 7. Inventário de tabelas e campos

Todas as 50 consultas físicas apontam para `https://energeticaltda-my.sharepoint.com/personal/bernardonotini_energeticabr_com`. Os GUIDs abaixo são o identificador estável da lista. Campos marcados com `*` são calculados no modelo e precisam ser traduzidos para TypeScript/SQL em memória.

| Tabela do modelo | Origem | GUID da lista | Colunas | Medidas | Campos |
|---|---|---|---:|---:|---|
| dCalendário | Calendário DAX | `calculada/local` | 2 | 0 | Date:dateTime, DIA*:string |
| LANÇAMENTOS | Lista SharePoint | `40d7ef08-594a-4835-85d7-036eb1a098e0` | 56 | 1 | TIPO TRANSAÇÃO:string, DATA:dateTime, DATA PGTO PREVISTO:dateTime, DATA PGTO EFETUADO:dateTime, FORNECEDOR:string, ETAPA:string, PRODUTO:string, QTD:double, VALOR UNITÁRIO:double, FRETE:double, SINAL:double, PAGAMENTO NA ENTREGA:double, ORIGEM PGTO:string, CONTA:string, FORMA DE PGTO:string, DESCRIÇÃO:string, SC / OC / CONTRATO:string, NF:double, CONCLUÍDO:string, __PowerAppsId__:string, ID:int64, TOTAL*:double, GRUPO*:string, FAMÍLIA*:string, SUBFAMÍLIA*:string, TIPO*:string, UNIDADE*:string, EMPENHADO*:double, EFETUADO*:double, LIQUIDAÇÃO*:double, ITEM ENTREGUE*:string, MÊS COMPETÊNCIA:string, MÊS CAIXA:string, ANO COMPETÊNCIA:string, ANO CAIXA:string, VALOR TOTAL*:double, NCOMPRA:string, DATA RMS:dateTime, ID 2:string, NOTA:string, OBSERVAÇÕES ENTREGA:string, ASSINATURA:string, ACUMULADO:string, TIPO DESPESA:string, NomeMes*:string, NumeroMes*:int64, ENVIARCOMPROVANTE:string, ADIANTAMENTO:string, CONTRATO:string, GERADESEMBOLSO:string, MEDICAOPARCIAL:string, IDPGTOAGENDADO:string, UN:string, FILIAL:string, APROVACAO:string, AGRUPAR:string |
| CADASTRO FAMÍLIA | Lista SharePoint | `feca3842-1b1c-43fc-b378-b6bd3c731ec9` | 4 | 0 | GRUPO:string, FAMÍLIA:string, ID:int64, STATUS:string |
| CADASTRO IMPACTO | Lista SharePoint | `7e2c03fa-954c-4aa8-bef4-f2691fe0ecc1` | 3 | 0 | IMPACTO:string, __PowerAppsId__:string, ID:int64 |
| CADASTROCONTA | Lista SharePoint | `0a284d9d-2901-4978-a8cb-d587a8f9ca25` | 4 | 0 | CONTA:string, __PowerAppsId__:string, ID:int64, STATUS:string |
| CADASTRODIFICULDADE | Lista SharePoint | `e84da4e7-16b8-46c2-8bae-f65799aaf19b` | 3 | 0 | DIFICULDADE:string, __PowerAppsId__:string, ID:int64 |
| CADASTROGRUPO | Lista SharePoint | `99ff4509-4601-4f61-b29f-3a972345e48d` | 4 | 0 | GRUPO:string, __PowerAppsId__:string, ID:int64, STATUS:string |
| CADASTROPRODUTO | Lista SharePoint | `9c01076a-6aae-42a3-ac47-2417bcc1c783` | 9 | 0 | SUBFAMÍLIA:string, PRODUTO:string, __PowerAppsId__:string, ID:int64, STATUS:string, TIPO:string, GERADESEMBOLSO:string, TIPODESPESA:string, UNIDADE:string |
| CADASTROSUBFAMÍLIA | Lista SharePoint | `5a312ac0-456d-49f7-9ac2-0c37ef4cbf4f` | 7 | 0 | FAMÍLIA:string, SUBFAMÍLIAS CADASTRADAS:string, UNIDADE:string, TIPO:string, __PowerAppsId__:string, ID:int64, STATUS:string |
| CADASTROTAREFAS | Lista SharePoint | `f9db1ed0-93ac-4e4e-87b3-169e56060b23` | 6 | 0 | Título:string, ASSOCIAÇÃO:string, PONTUAÇÃO:double, __PowerAppsId__:string, ID:int64, TIPO:string |
| CADASTROTIPOMATERIAL | Lista SharePoint | `6571e592-140a-4d18-bd34-074e05f227e0` | 3 | 0 | TIPO:string, ID:int64, STATUS:string |
| CADASTROUNIDADEMEDIDA | Lista SharePoint | `281b8e30-6e2c-409f-aac4-fb7eb4dc5da9` | 3 | 0 | UNIDADE MEDIDA:string, ID:int64, STATUS:string |
| CADASTROURGÊNCIA | Lista SharePoint | `ab4110f2-03b0-45d2-ac8a-817b17637336` | 2 | 0 | URGÊNCIA:string, ID:int64 |
| CONCLUIDOLANCAMENTOS | Lista SharePoint | `87f8890d-3e68-4ebb-a4b2-2c48e5c91ba3` | 3 | 0 | __PowerAppsId__:string, ID:int64, STATUS:string |
| FILIAIS | Lista SharePoint | `72802b35-1401-4921-9305-4f1c9d80a410` | 7 | 0 | FILIAL:string, UN:double, __PowerAppsId__:string, ID:int64, STATUS:string, VALORVISITA:string, CIDADE:string |
| FORNECEDORES | Lista SharePoint | `eb179360-ebda-4693-852f-f3aed3eb50b7` | 26 | 0 | FORNECEDOR:string, TIPO:string, ATIVIDADE EXERCIDA:string, TELEFONE:string, E-MAIL:string, CIDADE:string, ENDEREÇO:double, __PowerAppsId__:string, ID:int64, FILIAL:string, DOCUMENTO FORNECEDOR:string, EMPREITEIRO:string, STATUS:string, HOMOLOGACAO:string, PROFISSAO:string, VLR DIARIO:double, FORMA PGTO:string, TELEFONECONTATO:string, WHATSAPP:string, MEDIÇÃOATUAL:string, DESCRITIVOETAPA ATUAL:string, HORASTRABALHO:string, IMOVEL:string, TIPODOCUMENTO:string, DATANASCIMENTO:dateTime, EMAIL:string |
| LANCAMENTOOBRA | Lista SharePoint | `ba22a7e9-48a6-40f9-8fbe-e719da7c2e02` | 26 | 1 | GRUPO DE OBRA:string, FASE DA OBRA:string, TIPO:string, ETAPA:string, INÍCIO:dateTime, FIM:dateTime, VALOR:double, TEMPO:double, __PowerAppsId__:string, ID:int64, EXECUTADO:string, TOTAL:string, ACOMPANHAMENTO:string, FILIAL:string, DESCRIÇÃO ETAPA:string, ACOMPANHAMENTO ETAPA:string, ATIVIDADEFANTASMA:string, DATA FATAL:dateTime, INDICE:double, DATA C/ LANCAMENTO:string, DATA EM ATENDIMENTO*:dateTime, DATA INICIO CORRIGIDA*:dateTime, ETAPA ORDENADA*:string, PERCENTUALEFETUADO:double, STATUS:string, DIAS*:int64 |
| LANCAMENTOTAREFAS | Lista SharePoint | `ac0bf209-fb7a-4331-b560-902eabe939dc` | 26 | 6 | GRAU URGÊNCIA:string, IMPACTO:string, DIFICULDADE:string, FILIAL:string, DATA IDENTIFICAÇÃO:dateTime, DATA INÍCIO:dateTime, DATA FATAL:dateTime, DATA CONCLUSÃO:dateTime, TIPO:string, ASSOCIAÇÃO:string, CONCLUÍDO:string, __PowerAppsId__:string, ID:int64, DESCRICAOMAIUSCULA*:string, DIAS P/ FATAL*:int64, ID 2:string, REFERENTE:string, PONTUAÇÃO:int64, PONTUAÇÃO IMPACTO:int64, PONTUAÇÃO URGÊNCIA:int64, CONJUGADO PONTUACOES*:double, TAREFA:string, PRIORITÁRIA:string, STATUS*:string, EMAIL:string, APROVACAO:string |
| MEDIDAS | Tabela local de medidas | `calculada/local` | 2 | 20 | Coluna 1:string, COR ALEATÓRIA*:string |
| CUSTO DE COMPETÊNCIA | Lista SharePoint | `40d7ef08-594a-4835-85d7-036eb1a098e0` | 6 | 0 | MÊS:string, CUSTO:double, ANO:string, TIPO:string, Início do Mês:dateTime, FILIAL:string |
| CUSTO DE CAIXA | Lista SharePoint | `40d7ef08-594a-4835-85d7-036eb1a098e0` | 6 | 0 | MÊS:string, ANO:string, CUSTO:double, TIPO:string, Início do Mês:dateTime, FILIAL:string |
| TAREFAS CRIADAS | Lista SharePoint | `ac0bf209-fb7a-4331-b560-902eabe939dc` | 3 | 0 | DATA:dateTime, DESCRIÇÃO:string, Contagem:int64 |
| TAREFAS CONCLUÍDAS | Lista SharePoint | `ac0bf209-fb7a-4331-b560-902eabe939dc` | 3 | 0 | DATA:dateTime, Contagem:int64, DESCRIÇÃO:string |
| ACUMULADO TAREFAS | Lista SharePoint | `ac0bf209-fb7a-4331-b560-902eabe939dc` | 3 | 0 | DATA:dateTime, Contagem:int64, DESCRIÇÃO:string |
| ACUMULADO | Lista SharePoint | `40d7ef08-594a-4835-85d7-036eb1a098e0` | 6 | 0 | ANO:string, MÊS:string, Início do Mês:dateTime, CUSTO:double, TIPO:string, FILIAL:string |
| ACUMULADO PGTO FORNECEDOR | Lista SharePoint | `40d7ef08-594a-4835-85d7-036eb1a098e0` | 4 | 1 | FORNECEDOR:string, Início do Mês:dateTime, ACUMULADO EMPREITEIRO:double, FILIAL:string |
| DIÁRIO DE OBRAS | Lista SharePoint | `9488f168-da1e-471a-89a8-0b59bacc4c51` | 21 | 1 | Id:string, DATA:dateTime, DESCRIÇÃO:string, MEDIÇÃOEFETUADA:string, VALORMEDIÇÃO:string, INFORMAÇÕESCLIM_x00c:string, ATIVIDADESEXECUTADAS:string, OCORRÊNCIASEIMPREVISTOS:string, SERVIÇOSPARALISADOS:string, OData_ID2:string, FILIAL:string, OData_ÚLTIMADATA:dateTime, Modified:string, Created:string, Attachments:string, RESPONSAVELTECNICO:string, DATAÚLTIMARDO:string, DIASENTREÚLTIMARDOEATUAL:string, VALORESTOQUE:string, VARMOVIMENTACOES:string, STATUS:string |
| APONTAMENTO DE PRESENÇA | Lista SharePoint | `12e9808d-5bd6-4896-8ee2-bdd7b45ff319` | 21 | 0 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, COLABORADOR:string, DATA:string, PROFISSÃO:string, ATIVIDADEEXECUTADA:string, FILIAL:string, ID.1:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string |
| IMOBILIZADOS | Lista SharePoint | `a9bdb746-d54b-40c4-bf6b-3c49e9b1cd6e` | 35 | 3 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, ITEM:string, VALORESTIMADO:double, QTD:double, FILIAL:string, GRUPOIMOBILIZADO:string, DATACADASTRO:dateTime, DATACOMPRA:dateTime, DATADEPRECIAÇÃO:dateTime, VLRRESIDUAL:double, OData_%DEPRECIACAO:int64, HTML:string, ID.1:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string, FORNECEDOR:string, DATAULTIMADEP:string, NÚMEROIMOBILIZADO:int64, FUNÇÃO:string, STATUS:string, CONDIÇÃO:string, QTD* VALOR *DEP*:double, DEPRECIAR:string |
| CADASTROIMOBILIZADO | Lista SharePoint | `df26f998-d9b2-4269-8828-5d1ca40f2351` | 19 | 0 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, GRUPOIMOBILIZADO:string, IMOBILIZADO:string, ID.1:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string, FUNCAO:string |
| GRUPO IMOBILIZADOS | Lista SharePoint | `0f9539c2-bcb6-49e6-a6c8-b586a4811c04` | 17 | 0 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, GRUPOIMOBILIZADOS:string, ID 2:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string |
| ACUMULADO (2) | Lista SharePoint | `40d7ef08-594a-4835-85d7-036eb1a098e0` | 7 | 0 | ANO:string, MÊS:string, Início do Mês:dateTime, ETAPA:string, CUSTO:double, TIPO:string, FILIAL:string |
| DESCRITIVOPRESENCA | Lista SharePoint | `567286e4-3783-4562-b9bc-f91f487c395e` | 48 | 5 | FileSystemObjectType:string, Id:int64, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, DATA:dateTime, FILIAL:string, FORNECEDOR:string, PROFISSAO:string, ATIVIDADEEXECUTADA:string, RAZAO:double, FORMAPGTO:string, HORÁRIO:dateTime, OBSERVAÇÃO:string, HORARIOSAIDA1:dateTime, HORARIOENTRADA2:dateTime, HORARIOSAIDA2:dateTime, VLR DIÁRIO:double, VALORMEDICAO:string, ID 2:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string, ETAPA:string, HORAS TOTAIS DECIMAL:double, HORAS ÚTEIS:string, HORAS CONTRATADAS:double, DataFormatada*:string, VLR DIARIO*:double, EXECUTADO DIÁRIO*:double, IDMEDICAO:string, STATUS:string, IDPGTO:string, DATAPGTO:string, DESCRICAOETAPA:string, IMOVEL:string, IDDESCRITIVOETAPA:string, IDMEDICAOPARCIAL:string, MesPresenca*:string, PRESENCA:string, MOTIVACAO:string |
| DEMONSTRATIVOETAPA | Lista SharePoint | `28bc22d1-c75b-4dcc-bcaf-bd7bbf93acf8` | 31 | 1 | FileSystemObjectType:string, Id:int64, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, DATAEXECUTADO:dateTime, DATAPREVISTO:dateTime, FORNECEDOR:string, FILIAL:string, STATUS:string, ETAPA:string, IMOVEL:string, QTDEXECUTADA:double, TOTAL:double, ATIVIDADEEXECUTADA:string, ID 2:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string, OBSERVACOESFINALIZACAO:string, IDENTIFICADOR DEMONSTRATIVO*:string, DATEDIF*:int64, DATA EM ATENDIMENTO*:dateTime, DEMONSTRATIVOETAPA*:string |
| TAREFASDELEGADAS | Lista SharePoint | `82096aa5-ee81-4440-b301-7ee0d0c3d9e6` | 40 | 0 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, IMPACTO:string, DIFICULDADE:string, FILIAL:string, DATAIDENTIFICACAO:dateTime, TIPO:string, ASSOCIACAO:string, TAREFA:string, CONCLUÍDO:string, OData_ID2:string, RESPONSÁVEL:string, PROFISSÃO:string, FORMAPRESTAÇÃOSERVI_:string, VALORESTIMADO:string, VALORGASTO:string, PRIORITÁRIA:string, TOTALTAREFA:string, EXECUTADO:string, DATAFATAL:dateTime, DATACONCLUSAO0:dateTime, URGENCIA:string, DATAINÍCIO:dateTime, OBSERVACOESCONCLUSAO:string, IMOVEL:string, ID.1:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string, STATUS*:string |
| APONTAMENTOSFUNCIONARIOS | Lista SharePoint | `480b5a84-3c38-462d-b1a7-02ff26b6171d` | 32 | 0 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, TIPO:string, INDICATIVO:string, IMPACTOERRO:string, FORNECEDOR:string, FILIAL:string, DATA:dateTime, DATACORRECAO:string, ETAPA:string, ATIVIDADEEXECUTADA:string, DIFICULDADECORREÇÃO:string, PERDAESTIMADA:string, DESCRICAO:string, ID.1:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string, STATUS:string, NUMEROCONTRATO:string, CONTRATO:string, FORMAPGTO:string |
| DESCRICAOMEDICOES | Lista SharePoint | `882da820-8fe0-4dc2-a965-3c5a9a5629d9` | 40 | 1 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, FORNECEDOR:string, AVALIACAO:string, OBSERVACAO:string, PENDENCIAS:string, ETAPAOBRA:string, VALORMEDIDO:string, QTD:string, VALORTOTAL:double, TIPODEMEDICAO:string, ATIVIDADE:string, DATAINÍCIO:dateTime, DATAFIM:dateTime, SALDOCONTRATO:double, OData_ID2:string, FILIAL:string, ID.1:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string, Coluna*:int64, NUMEROCONTRATO:string, VALORUNITARIO:string, html:string, STATUS:string, IDLANCAMENTO:string, SUPRIMENTOS:string, DEMONSTRATIVOETAPA:string, ASSINATURA:string |
| EMPREITEIRO | Lista SharePoint | `4307a84e-0803-475a-a407-2ba348639770` | 51 | 0 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, FORNECEDOR:string, ACRÉSCIMO:string, DESCRICAO:string, AVALIACAOSERVICO:string, OBSERVACAOAVALIACAO:string, PENDENCIAS:string, ETAPAOBRA:string, LOCAL:string, CONSUMO:string, VALORUNITARIO:string, DATA:string, FILIAL:string, VALORTOTAL:double, ASSINATURA:string, IDRDO:string, TIPODEMEDIÇÃO:string, TABELA:string, ATIVIDADE:string, STATUS:string, ACUMULADO:string, DATAINÍCIO:dateTime, DATAFIM:dateTime, ID.1:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string, NUMEROCONTRATO:string, CONTRATO:string, FORMAPGTO:string, DETALHAMENTOSERVICO:string, LOCALSERVICO:string, ATIVIDADEEXECUTADA:string, DESCRITIVOETAPA:string, INDICADOR CONTRAT*:string, OBRIGACOESCONTRATADO:string, CRONOGRAMA:string, PENALIDADES:string, GARANTIA:string, VALORTOTALMEDICOES:string |
| ACUMULADO ETAPA | Lista SharePoint | `40d7ef08-594a-4835-85d7-036eb1a098e0` | 3 | 3 | ETAPA:string, CUSTO CAIXA:double, FILIAL:string |
| LINHACONTRATO | Lista SharePoint | `9cf25e59-06db-4945-b45a-25e66631d545` | 29 | 0 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, IDCONTRATO:string, FORNECEDOR:string, FILIAL:string, DATAINICIO:string, DEMONSTRATIVOETAPA:string, INDICELINHA:string, ATIVIDADE:string, TIPOMEDICAO:string, UNIDADE:string, VALORUNITARIO:string, QTD:string, DESCRICAO:string, TIPOLINHA:string, ID.1:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string |
| LINHASMEDICAO | Lista SharePoint | `c9e8f316-635e-417d-9150-e40dfae366dd` | 37 | 0 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, LINHACONTRATO:string, ATIVIDADEEXECUTADA:string, VALORUNITARIO:string, LARGURA:string, ALTURA:string, FORNECEDOR:string, FILIAL:string, IMOVEL:string, ETAPA:string, OBSERVAÇÃO:string, VALORTOTAL:string, QTD:string, TIPOMEDICAO:string, UN:string, NUMEROCONTRATO:string, IDMEDICAO:string, DATAMEDICAO:string, TIPO:string, IDPGTO:string, DATAPGTO:string, STATUS:string, ID.1:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string |
| CADASTRO CLIENTE | Lista SharePoint | `2b0f05de-760d-47ad-840c-18975f26789f` | 28 | 0 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, NOME:string, CPF:string, TELEFONE:string, IMÓVELADQUIRIDO:string, DESCRIÇÃO:string, FILIAL:string, CORRETOR:string, RG:string, DATAVENDA:string, DATAASSINATURAPROPCOMEVEND:string, ID.1:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string, STATUS:string, EMAIL:string |
| LANCAMENTOCOMPRAS | Lista SharePoint | `b9a07cb7-e103-423d-9bbb-0ea15c31d59f` | 33 | 0 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, FILIAL:string, IMOVEL:string, NOME:string, DATAVENDA:string, DATAASSINATURAPROP.COMP_x0:string, DATAPGTOSINAL:string, RG:string, CPF:string, TELEFONE:string, CORRETOR:string, DESCRICAOVENDA:string, DESCRICAOPGTOS:string, STATUS:string, ACUMULADO:string, TOTAL:string, IDCONTRATO:string, ID.1:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string, MOTIVOBAIXA:string |
| IMOVEL CADASTRADO | Lista SharePoint | `ac8054a3-0b8a-43f4-a2de-68a205bdb8ad` | 24 | 0 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, FILIAL:string, IMOVEL:string, STATUS:string, ID.1:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string, IDPROV:string, STATUSVISUAL:string, FISCAL:string, CORRETAGEM:string, DESCRITIVOCORRETAGEM:string |
| HOMOLOGACAOCOMERCIAL | Lista SharePoint | `6e373db1-6403-42ab-a370-f5536b41c356` | 25 | 0 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, FILIAL:string, TIPODOCUMENTO:string, STATUS:string, CLIENTE:string, DATASUBMETIDO:string, OBS:string, IMOVEL:string, NUMCONTRATO:string, ID.1:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string, TIPOMARCO:string |
| LANÇAMENTORECEITA | Lista SharePoint | `ff9252ba-af44-4e79-9c4b-dd3901c1370a` | 36 | 0 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, FILIAL:string, TIPO:string, DATA:dateTime, DATAPGTOPREVISTO:string, DATAPGTOEFETUADO:dateTime, FORNECEDOR:string, QUANTIDADE:string, VALORUNITÁRIO:string, VALORTOTAL:double, FORMAPGTO:string, CONTA:string, DESCRIÇÃO:string, STATUS:string, ENVIARCOMPROVANTE:string, PRODUTO:string, IMOVEL:string, IDCONTRATO:string, ID.1:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string, VALORPAGO*:double, VALOR_NAO_PAGO*:double, PGTODIR.CORRETOR:string |
| APONTAMENTOSCOMERCIAIS | Lista SharePoint | `f21c31d9-383b-435b-b95e-164cbefc2d73` | 31 | 1 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, FILIAL:string, IMOVEL:string, IDCONTRATO:string, COMPRADOR:string, RELACAOMARCO:string, TIPOMARCO:string, DESCRICAO:string, DATAINICIO:dateTime, DATAFIM:dateTime, DATAFATAL:string, STATUS:string, NOME:string, ID.1:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string, DATA EM ATENDIMENTO*:dateTime, DIAS*:int64, %*:int64 |
| HOMOLOGARFORNECEDOR | Lista SharePoint | `2b140384-4ee4-4edb-876c-6b476bc24e2e` | 28 | 0 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, FILIAL:string, TIPODOCUMENTO:string, STATUS:string, APROVADO:string, FORNECEDOR:string, COBRAR:string, DATA:string, DATASUBMETIDO:string, DATAVALIDADE:string, URGÊNCIA:string, COMPRIMIR:string, OBSERVACOES:string, ID.1:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string |
| HOMOLOGARCONTRATO | Lista SharePoint | `18ce7f86-bd0f-4bc6-94b3-3bd11f6e3d19` | 28 | 0 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, FILIAL:string, TIPODOCUMENTO:string, STATUS:string, FORNECEDOR:string, NUMEROCONTRATO:string, IDPGTO:string, DATACRIADO:string, DATASUBMISSAO:string, COMPRIMIR:string, ATIVIDADEEXECUTADA:string, ETAPA:string, OBSERVACOES:string, ID 2:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string |
| Tabela_Documentos | Tabela DAX UNION | `calculada/local` | 6 | 0 | TIPODOCUMENTO:string, STATUS:string, FORNECEDOR:string, FILIAL:string, Created:dateTime, DATASUBMETIDO:dateTime |
| DOCUMENTOS RELEVANTES | Lista SharePoint | `b9e344bd-546f-4967-838c-5d285cd45555` | 29 | 0 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, FILIAL:string, TIPODOCUMENTO:string, PESSOARELACIONADA:string, DATA:string, DATAVALIDADE:string, STATUS:string, COBRAR:string, URGÊNCIA:string, DATASUBMETIDO:string, IMOVEL:string, COMPRIMIR:string, HOMOLOGARDOCUMENTOS:string, OBSERVACOES:string, ID.1:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string |
| CADASTRO TIPO DOCUMENTO | Lista SharePoint | `6d6afb9d-1968-4dfa-bea2-aa01a367192e` | 19 | 0 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, TIPODOCUMENTO:string, HOMOLOGAÇÃO:string, GRUPO:string, ID.1:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string |
| NOTASPENDENTES | Lista SharePoint | `dfffa843-823f-4da3-939b-aaafb5297893` | 26 | 0 | FileSystemObjectType:string, Id:string, ServerRedirectedEmbedUri:string, ServerRedirectedEmbedUrl:string, ContentTypeId:string, Title:string, OData__ColorTag:string, ComplianceAssetId:string, FORNECEDOR:string, VALORTOTAL:double, DATAPGTOEFETUADO:string, FILIAL:string, STATUS:string, OBS:string, FORMAPGTO:string, ID.1:string, Modified:string, Created:string, AuthorId:string, EditorId:string, OData__UIVersionString:string, Attachments:string, GUID:string, NF:string, NUMEROPEDIDO:string, DATAPEDIDO:string |

### 7.1 Consultas derivadas que não devem virar novas bases

- `CUSTO DE COMPETÊNCIA`: agrupa LANÇAMENTOS por início do mês, ano, mês e filial; soma `QUANTIDADE × VALOR UNITÁRIO + FRETE`.
- `CUSTO DE CAIXA`: mesma base, agrupada pela data de pagamento efetuado.
- `ACUMULADO`: união dos dois conjuntos anteriores.
- `ACUMULADO PGTO FORNECEDOR`: agrupa por filial, fornecedor e mês, atualmente filtrado para fornecedor `BEDEU`.
- `ACUMULADO (2)`: recorte de caixa da etapa `DEPRECIAÇÃO E AMORTIZAÇÃO`.
- `ACUMULADO ETAPA`: agrupa custo por filial e etapa.
- `TAREFAS CRIADAS`, `TAREFAS CONCLUÍDAS` e `ACUMULADO TAREFAS`: agregações da lista `LANCAMENTOTAREFAS`.
- `Tabela_Documentos`: união DAX de `HOMOLOGARFORNECEDOR`, `HOMOLOGARCONTRATO`, `DOCUMENTOS RELEVANTES` e `HOMOLOGACAOCOMERCIAL`.
- Essas estruturas são views calculadas em memória e não devem ser persistidas no SharePoint nem em outra base.

### 7.2 Consulta não carregada

Existe a expressão M `CADASTRO CORRETOR`, lista GUID `d090c93f-ae07-4536-8616-e38a2bdb9107`, mas ela não está carregada como tabela do modelo e nenhum visual a referencia diretamente. No portal, só deve ser ativada quando uma tela exigir seleção ou manutenção de corretores.

## 8. Relacionamentos de negócio

Relações automáticas com `LocalDateTable_*` foram excluídas desta tabela. “Ambas” exige propagação bidirecional; relações inativas só entram quando uma regra equivalente a `USERELATIONSHIP` for invocada.

| De | Para | Ativa | Cardinalidade | Filtro cruzado |
|---|---|---|---|---|
| LANÇAMENTOS.PRODUTO | CADASTROPRODUTO.PRODUTO | Sim | many:one | Ambas |
| LANCAMENTOTAREFAS.ASSOCIAÇÃO | CADASTROTAREFAS.ASSOCIAÇÃO | Sim | many:one | Uma direção |
| CADASTROPRODUTO.SUBFAMÍLIA | CADASTROSUBFAMÍLIA.SUBFAMÍLIAS CADASTRADAS | Sim | many:one | Uma direção |
| CADASTROSUBFAMÍLIA.FAMÍLIA | CADASTRO FAMÍLIA.FAMÍLIA | Sim | many:one | Uma direção |
| CADASTRO FAMÍLIA.GRUPO | CADASTROGRUPO.GRUPO | Sim | many:one | Uma direção |
| CADASTROSUBFAMÍLIA.UNIDADE | CADASTROUNIDADEMEDIDA.UNIDADE MEDIDA | Sim | many:one | Uma direção |
| LANÇAMENTOS.FORNECEDOR | FORNECEDORES.FORNECEDOR | Sim | many:one | Uma direção |
| LANCAMENTOTAREFAS.IMPACTO | CADASTRO IMPACTO.IMPACTO | Sim | many:one | Uma direção |
| LANCAMENTOTAREFAS.DIFICULDADE | CADASTRODIFICULDADE.DIFICULDADE | Sim | many:one | Uma direção |
| LANCAMENTOTAREFAS.GRAU URGÊNCIA | CADASTROURGÊNCIA.URGÊNCIA | Sim | many:one | Uma direção |
| LANÇAMENTOS.DATA | dCalendário.Date | Sim | many:one | Uma direção |
| ACUMULADO PGTO FORNECEDOR.FORNECEDOR | FORNECEDORES.FORNECEDOR | Sim | many:one | Uma direção |
| DIÁRIO DE OBRAS.FILIAL | FILIAIS.FILIAL | Sim | many:one | Ambas |
| APONTAMENTO DE PRESENÇA.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| IMOBILIZADOS.FORNECEDOR | FORNECEDORES.FORNECEDOR | Sim | many:one | Ambas |
| LANÇAMENTOS.PRODUTO | IMOBILIZADOS.ITEM | Sim | many:many | Uma direção |
| LANÇAMENTOS.FORNECEDOR | IMOBILIZADOS.FORNECEDOR | Não | many:many | Uma direção |
| LANCAMENTOOBRA.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| DESCRITIVOPRESENCA.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| DESCRITIVOPRESENCA.FORNECEDOR | FORNECEDORES.FORNECEDOR | Sim | many:one | Uma direção |
| DEMONSTRATIVOETAPA.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| DEMONSTRATIVOETAPA.FORNECEDOR | FORNECEDORES.FORNECEDOR | Não | many:one | Uma direção |
| TAREFASDELEGADAS.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| TAREFASDELEGADAS.IMPACTO | CADASTRO IMPACTO.IMPACTO | Sim | many:one | Uma direção |
| TAREFASDELEGADAS.DIFICULDADE | CADASTRODIFICULDADE.DIFICULDADE | Sim | many:one | Ambas |
| DESCRITIVOPRESENCA.DATA | dCalendário.Date | Sim | many:one | Uma direção |
| APONTAMENTOSFUNCIONARIOS.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| LANCAMENTOOBRA.ETAPA | ACUMULADO ETAPA.ETAPA | Sim | many:many | Ambas |
| DESCRICAOMEDICOES.IDLANCAMENTO | LANÇAMENTOS.ID | Sim | many:one | Uma direção |
| DESCRICAOMEDICOES.NUMEROCONTRATO | EMPREITEIRO.Id | Sim | many:one | Uma direção |
| DESCRICAOMEDICOES.DEMONSTRATIVOETAPA | DEMONSTRATIVOETAPA.Id | Não | many:one | Uma direção |
| DEMONSTRATIVOETAPA.ETAPA | EMPREITEIRO.ETAPAOBRA | Não | many:many | Ambas |
| DEMONSTRATIVOETAPA.ETAPA | LANÇAMENTOS.ETAPA | Sim | many:many | Ambas |
| LINHACONTRATO.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| LINHASMEDICAO.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| LINHACONTRATO.FORNECEDOR | FORNECEDORES.FORNECEDOR | Sim | many:one | Uma direção |
| LINHASMEDICAO.FORNECEDOR | FORNECEDORES.FORNECEDOR | Sim | many:one | Uma direção |
| LINHACONTRATO.ID.1 | IMOBILIZADOS.ID.1 | Não | one:one | Ambas |
| LINHACONTRATO.ID.1 | APONTAMENTOSFUNCIONARIOS.ID.1 | Não | one:one | Ambas |
| DESCRITIVOPRESENCA.ETAPA | LANCAMENTOOBRA.ETAPA | Sim | many:many | Uma direção |
| DESCRITIVOPRESENCA.IDMEDICAO | EMPREITEIRO.Id | Sim | many:one | Uma direção |
| APONTAMENTOSFUNCIONARIOS.ETAPA | LANCAMENTOOBRA.ETAPA | Sim | many:many | Uma direção |
| APONTAMENTOSFUNCIONARIOS.FORNECEDOR | FORNECEDORES.FORNECEDOR | Sim | many:one | Uma direção |
| LANCAMENTOCOMPRAS.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| DESCRITIVOPRESENCA.IMOVEL | IMOVEL CADASTRADO.IMOVEL | Não | many:many | Uma direção |
| DEMONSTRATIVOETAPA.IMOVEL | IMOVEL CADASTRADO.IMOVEL | Não | many:many | Uma direção |
| LINHASMEDICAO.IMOVEL | IMOVEL CADASTRADO.IMOVEL | Não | many:many | Uma direção |
| HOMOLOGACAOCOMERCIAL.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| HOMOLOGACAOCOMERCIAL.IMOVEL | IMOVEL CADASTRADO.IMOVEL | Não | many:many | Uma direção |
| HOMOLOGACAOCOMERCIAL.ID.1 | APONTAMENTOSFUNCIONARIOS.ID.1 | Não | one:one | Ambas |
| LANÇAMENTOS.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| CUSTO DE COMPETÊNCIA.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| CUSTO DE CAIXA.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| ACUMULADO.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| ACUMULADO PGTO FORNECEDOR.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| ACUMULADO (2).FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| LANÇAMENTOS.ETAPA | LANCAMENTOOBRA.ETAPA | Sim | many:many | Ambas |
| ACUMULADO ETAPA.FILIAL | FILIAIS.FILIAL | Não | many:one | Uma direção |
| LANÇAMENTORECEITA.PRODUTO | CADASTROPRODUTO.PRODUTO | Sim | many:one | Uma direção |
| LANÇAMENTORECEITA.CONTA | CADASTROCONTA.CONTA | Sim | many:one | Uma direção |
| LANÇAMENTORECEITA.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| LANÇAMENTORECEITA.IMOVEL | IMOVEL CADASTRADO.IMOVEL | Não | many:many | Uma direção |
| LANÇAMENTORECEITA.ID.1 | APONTAMENTOSFUNCIONARIOS.ID.1 | Não | one:one | Ambas |
| IMOVEL CADASTRADO.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| APONTAMENTOSCOMERCIAIS.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| LANÇAMENTORECEITA.FORNECEDOR | CADASTRO CLIENTE.NOME | Sim | many:one | Uma direção |
| HOMOLOGARFORNECEDOR.FORNECEDOR | FORNECEDORES.FORNECEDOR | Sim | many:one | Uma direção |
| HOMOLOGARCONTRATO.FORNECEDOR | FORNECEDORES.FORNECEDOR | Sim | many:one | Uma direção |
| HOMOLOGARCONTRATO.ID 2 | GRUPO IMOBILIZADOS.ID 2 | Sim | one:one | Ambas |
| HOMOLOGARFORNECEDOR.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| HOMOLOGARCONTRATO.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| HOMOLOGARFORNECEDOR.ID.1 | APONTAMENTOSFUNCIONARIOS.ID.1 | Não | one:one | Ambas |
| DOCUMENTOS RELEVANTES.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| DOCUMENTOS RELEVANTES.URGÊNCIA | CADASTROURGÊNCIA.URGÊNCIA | Sim | many:one | Uma direção |
| HOMOLOGACAOCOMERCIAL.TIPODOCUMENTO | CADASTRO TIPO DOCUMENTO.TIPODOCUMENTO | Sim | many:one | Uma direção |
| HOMOLOGARFORNECEDOR.TIPODOCUMENTO | CADASTRO TIPO DOCUMENTO.TIPODOCUMENTO | Sim | many:one | Uma direção |
| HOMOLOGARCONTRATO.TIPODOCUMENTO | CADASTRO TIPO DOCUMENTO.TIPODOCUMENTO | Sim | many:one | Uma direção |
| DOCUMENTOS RELEVANTES.TIPODOCUMENTO | CADASTRO TIPO DOCUMENTO.TIPODOCUMENTO | Sim | many:one | Uma direção |
| Tabela_Documentos.TIPODOCUMENTO | CADASTRO TIPO DOCUMENTO.TIPODOCUMENTO | Sim | many:one | Uma direção |
| NOTASPENDENTES.FORNECEDOR | FORNECEDORES.FORNECEDOR | Sim | many:one | Ambas |
| NOTASPENDENTES.FILIAL | FILIAIS.FILIAL | Não | many:one | Uma direção |
| Tabela_Documentos.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |
| IMOBILIZADOS.FILIAL | FILIAIS.FILIAL | Sim | many:one | Uma direção |

### 8.1 Riscos de modelagem a preservar conscientemente

- Há relações muitos-para-muitos e bidirecionais. No portal, não executar junções ingênuas que multipliquem valores; agregue primeiro pela chave de negócio.
- Existem relações `ID.1` um-para-um inativas ligando tabelas sem afinidade funcional aparente. Devem permanecer inativas até validação com um visual que realmente as use.
- `NOTASPENDENTES → FORNECEDORES` é bidirecional, mas a relação com FILIAIS está inativa. O filtro por filial em Auditoria precisa ser implementado explicitamente.
- O calendário oficial do portal deve ser único (`dCalendário`, 01/01/2023 a 01/01/2030), evitando as 47 tabelas automáticas do PBIX.

## 9. Medidas DAX

Foram encontradas 44 medidas. O portal deve manter testes de paridade para cada uma usando amostras sintéticas. A fórmula original é mantida abaixo sem correção silenciosa.

<details><summary><code>LANÇAMENTOS[% VALOR POR FILIAL]</code> — formato <code>0.00%;-0.00%;0.00%</code></summary>

```DAX

DIVIDE(
    [LANÇAMENTOS],
    CALCULATE(
        [LANÇAMENTOS],
        ALLEXCEPT(
            'LANÇAMENTOS',
            'FILIAIS'[FILIAL]
        ),
        ALL('CADASTROPRODUTO')
    )
)

```

</details>

<details><summary><code>LANCAMENTOOBRA[HOJE]</code> — formato <code>General Date</code></summary>

```DAX
TODAY()
```

</details>

<details><summary><code>LANCAMENTOTAREFAS[ATIVIDADE CRIADA]</code> — formato <code>0</code></summary>

```DAX
CALCULATE(COUNT(LANCAMENTOTAREFAS[DESCRICAOMAIUSCULA]),LANCAMENTOTAREFAS[CONCLUÍDO]="ATIVIDADE CRIADA")
```

</details>

<details><summary><code>LANCAMENTOTAREFAS[EM ATENDIMENTO]</code> — formato <code>0</code></summary>

```DAX
CALCULATE(COUNT(LANCAMENTOTAREFAS[DESCRICAOMAIUSCULA]),LANCAMENTOTAREFAS[CONCLUÍDO]="EM ATENDIMENTO")
```

</details>

<details><summary><code>LANCAMENTOTAREFAS[CONCLUÍDO TOTAL]</code> — formato <code>0</code></summary>

```DAX
CALCULATE(COUNT(LANCAMENTOTAREFAS[DESCRICAOMAIUSCULA]),LANCAMENTOTAREFAS[CONCLUÍDO]="CONCLUÍDO")
```

</details>

<details><summary><code>LANCAMENTOTAREFAS[%FEITAS]</code> — formato <code>0.00%;-0.00%;0.00%</code></summary>

```DAX
[CONCLUÍDO TOTAL]/COUNT(LANCAMENTOTAREFAS[DESCRICAOMAIUSCULA])
```

</details>

<details><summary><code>LANCAMENTOTAREFAS[VENCIDADS]</code> — formato <code>0</code></summary>

```DAX
CALCULATE(COUNT(LANCAMENTOTAREFAS[DESCRICAOMAIUSCULA]),LANCAMENTOTAREFAS[DIAS P/ FATAL]<0)+0
```

</details>

<details><summary><code>LANCAMENTOTAREFAS[DIAS P/ FATAL < 5]</code> — formato <code>0</code></summary>

```DAX
CALCULATE(COUNT(LANCAMENTOTAREFAS[DESCRICAOMAIUSCULA]),LANCAMENTOTAREFAS[DIAS P/ FATAL]<5)
```

</details>

<details><summary><code>MEDIDAS[VALOR TOTAL]</code> — formato <code>\$#,0.00;(\$#,0.00);\$#,0.00</code></summary>

```DAX
SUM('LANÇAMENTOS'[VALOR TOTAL])
```

</details>

<details><summary><code>MEDIDAS[PENDENTE PGTO]</code> — formato <code>\$#,0.00;(\$#,0.00);\$#,0.00</code></summary>

```DAX
SUM('LANÇAMENTOS'[EMPENHADO])+SUM('LANÇAMENTOS'[LIQUIDAÇÃO])
```

</details>

<details><summary><code>MEDIDAS[LANÇAMENTOS]</code> — formato <code>\$#,0.00;(\$#,0.00);\$#,0.00</code></summary>

```DAX
SUM('LANÇAMENTOS'[EFETUADO])+0
```

</details>

<details><summary><code>MEDIDAS[ACUMULADO CUSTO]</code> — formato <code>\$#,0.###############;(\$#,0.###############);\$#,0.###############</code></summary>

```DAX
CALCULATE(SUM(ACUMULADO[Custo]),FILTER(ALL('ACUMULADO'[Início do Mês]),'ACUMULADO'[Início do Mês]<=maX('ACUMULADO'[Início do Mês])))
```

</details>

<details><summary><code>MEDIDAS[TOTAL P/ CASA]</code> — formato <code>\$#,0.00;(\$#,0.00);\$#,0.00</code></summary>

```DAX
SUM('LANÇAMENTOS'[VALOR TOTAL])/4
```

</details>

<details><summary><code>MEDIDAS[VALOR P/ CASA]</code> — formato <code>\$#,0.###############;(\$#,0.###############);\$#,0.###############</code></summary>

```DAX
SUM('LANÇAMENTOS'[EFETUADO])/SUM(FILIAIS[UN]) +0
```

</details>

<details><summary><code>MEDIDAS[BEDEU EMPREITA]</code> — formato <code>\$#,0.###############;(\$#,0.###############);\$#,0.###############</code></summary>

```DAX
SUM('LANÇAMENTOS'[VALOR TOTAL]) -160
```

</details>

<details><summary><code>MEDIDAS[BEDEU P/ CASA]</code> — formato <code>\$#,0.###############;(\$#,0.###############);\$#,0.###############</code></summary>

```DAX
[BEDEU EMPREITA]/4
```

</details>

<details><summary><code>MEDIDAS[20]</code> — formato <code>0%;-0%;0%</code></summary>

```DAX
CALCULATE(sum('LANÇAMENTOS'[EFETUADO])-160,'LANÇAMENTOS'[FORNECEDOR]="BEDEU")/120000
```

</details>

<details><summary><code>MEDIDAS[VLR MÉDIO]</code></summary>

```DAX
[VALOR TOTAL]/SUM('LANÇAMENTOS'[QTD])
```

</details>

<details><summary><code>MEDIDAS[Maior Custo Mês Atual]</code></summary>

```DAX

VAR DataInicialMes = DATE(YEAR(TODAY()), MONTH(TODAY()), 1)
VAR DataFinalMes = EOMONTH(TODAY(), 0)

RETURN
MAXX(
    SUMMARIZE(
        FILTER(
            'LANÇAMENTOS',
            'LANÇAMENTOS'[Data] >= DataInicialMes &&
            'LANÇAMENTOS'[Data] <= DataFinalMes
        ),
        'LANÇAMENTOS'[Etapa],
        "TotalEtapa", SUM('LANÇAMENTOS'[VALOR TOTAL])
    ),
    [TotalEtapa]
)

```

</details>

<details><summary><code>MEDIDAS[Maior Custo por Etapa]</code></summary>

```DAX

MAXX(
    VALUES('LANÇAMENTOS'[ETAPA]),
    CALCULATE(SUM('LANÇAMENTOS'[VALOR TOTAL]))
)


```

</details>

<details><summary><code>MEDIDAS[Maior Valor Fornecedor em Qualquer Mês]</code></summary>

```DAX

MAXX(
    SUMMARIZE(
        'LANÇAMENTOS',
        'LANÇAMENTOS'[FORNECEDOR],
        "TotalMesFornecedor", SUM('LANÇAMENTOS'[VALOR TOTAL])
    ),
    [TotalMesFornecedor]
)

```

</details>

<details><summary><code>MEDIDAS[Fornecedor com Maior Custo no Último Mês]</code></summary>

```DAX

VAR DataInicioUltimoMes = DATE(YEAR(TODAY()), MONTH(TODAY()) - 1, 1)
VAR DataFimUltimoMes = EOMONTH(TODAY(), -1)

VAR TabelaResumo =
    SUMMARIZE(
        FILTER(
            'LANÇAMENTOS',
            'LANÇAMENTOS'[Data] >= DataInicioUltimoMes &&
            'LANÇAMENTOS'[Data] <= DataFimUltimoMes
        ),
        'LANÇAMENTOS'[FORNECEDOR],
        "TotalFornecedor", SUM('LANÇAMENTOS'[VALOR TOTAL])
    )

VAR MaiorValor = MAXX(TabelaResumo, [TotalFornecedor])

RETURN
    MAXX(
        FILTER(TabelaResumo, [TotalFornecedor] = MaiorValor),
        'LANÇAMENTOS'[FORNECEDOR]
    )

```

</details>

<details><summary><code>MEDIDAS[Valor do Maior Fornecedor no Último Mês]</code> — formato <code>\$#,0.###############;(\$#,0.###############);\$#,0.###############</code></summary>

```DAX

VAR DataInicioUltimoMes = DATE(YEAR(TODAY()), MONTH(TODAY())-1 , 1)
VAR DataFimUltimoMes = EOMONTH(TODAY(), -1)

VAR TabelaResumo =
    SUMMARIZE(
        FILTER(
            'LANÇAMENTOS',
            'LANÇAMENTOS'[Data] >= DataInicioUltimoMes &&
            'LANÇAMENTOS'[Data] <= DataFimUltimoMes
        ),
        'LANÇAMENTOS'[FORNECEDOR],
        "TotalFornecedor", SUM('LANÇAMENTOS'[VALOR TOTAL])
    )

VAR MaiorValor = MAXX(TabelaResumo, [TotalFornecedor])

RETURN
    MaiorValor

```

</details>

<details><summary><code>MEDIDAS[Fornecedor com Maior Custo Global]</code></summary>

```DAX

MAXX(
    FILTER(
        ADDCOLUMNS(
            SUMMARIZE('LANÇAMENTOS', 'LANÇAMENTOS'[FORNECEDOR]),
            "TotalFornecedor", CALCULATE(SUM('LANÇAMENTOS'[VALOR TOTAL]))
        ),
        [TotalFornecedor] = MAXX(
            ADDCOLUMNS(
                SUMMARIZE('LANÇAMENTOS', 'LANÇAMENTOS'[FORNECEDOR]),
                "TotalFornecedor", CALCULATE(SUM('LANÇAMENTOS'[VALOR TOTAL]))
            ),
            [TotalFornecedor]
        )
    ),
    'LANÇAMENTOS'[FORNECEDOR]
)

```

</details>

<details><summary><code>MEDIDAS[ETAPA com Maior Custo no Último DIA]</code></summary>

```DAX

VAR DataInicioUltimoMes = DATE(YEAR(TODAY()), MONTH(TODAY()) - 1, 1)
VAR DataFimUltimoMes = EOMONTH(TODAY(), -1)

VAR TabelaResumo =
    SUMMARIZE(
        FILTER(
            'LANÇAMENTOS',
            'LANÇAMENTOS'[Data] >= DataInicioUltimoMes &&
            'LANÇAMENTOS'[Data] <= DataFimUltimoMes
        ),
        'LANÇAMENTOS'[ETAPA],
        "TotalFornecedor", SUM('LANÇAMENTOS'[VALOR TOTAL])
    )

VAR MaiorValor = MAXX(TabelaResumo, [TotalFornecedor])

RETURN
    MAXX(
        FILTER(TabelaResumo, [TotalFornecedor] = MaiorValor),
        'LANÇAMENTOS'[ETAPA]
    )


```

</details>

<details><summary><code>MEDIDAS[ETAPA MAIOR CUSTO]</code></summary>

```DAX

MAXX(
    FILTER(
        ADDCOLUMNS(
            SUMMARIZE('LANÇAMENTOS', 'LANÇAMENTOS'[ETAPA]),
            "TotalFornecedor", CALCULATE(SUM('LANÇAMENTOS'[VALOR TOTAL]))
        ),
        [TotalFornecedor] = MAXX(
            ADDCOLUMNS(
                SUMMARIZE('LANÇAMENTOS', 'LANÇAMENTOS'[ETAPA]),
                "TotalFornecedor", CALCULATE(SUM('LANÇAMENTOS'[VALOR TOTAL]))
            ),
            [TotalFornecedor]
        )
    ),
    'LANÇAMENTOS'[ETAPA]
)
```

</details>

<details><summary><code>MEDIDAS[MÃO DE OBRA / MATERIAL]</code></summary>

```DAX

CALCULATE(
    SUM('LANÇAMENTOS'[VALOR TOTAL]),
    CADASTROPRODUTO[TIPO] = "MÃO DE OBRA"
)/CALCULATE(
    SUM('LANÇAMENTOS'[VALOR TOTAL]),
    CADASTROPRODUTO[TIPO] = "MATERIAL"
)

```

</details>

<details><summary><code>MEDIDAS[ACUMULADO DEPRECIADO]</code> — formato <code>\$#,0.###############;(\$#,0.###############);\$#,0.###############</code></summary>

```DAX
CALCULATE(SUM('ACUMULADO (2)'[Custo]),FILTER(ALL('ACUMULADO (2)'[Início do Mês]),'ACUMULADO (2)'[Início do Mês]<=maX('ACUMULADO (2)'[Início do Mês])))
```

</details>

<details><summary><code>ACUMULADO PGTO FORNECEDOR[ACUMULADO CUSTO EMPREITEIRO]</code> — formato <code>\$#,0.###############;(\$#,0.###############);\$#,0.###############</code></summary>

```DAX
CALCULATE(
    SUM('ACUMULADO PGTO FORNECEDOR'[ACUMULADO EMPREITEIRO]),
    FILTER(
        ALL('ACUMULADO PGTO FORNECEDOR'[Início do Mês]),
        'ACUMULADO PGTO FORNECEDOR'[Início do Mês] <= MAX('ACUMULADO PGTO FORNECEDOR'[Início do Mês])
    )
)
```

</details>

<details><summary><code>DIÁRIO DE OBRAS[DIARIOSPENDENTES]</code> — formato <code>0</code></summary>

```DAX
CALCULATE(COUNT('DIÁRIO DE OBRAS'[DATA]),'DIÁRIO DE OBRAS'[STATUS]="PENDENTE")+0
```

</details>

<details><summary><code>IMOBILIZADOS[VALOR DEPRECIADO]</code> — formato <code>\$#,0.00;(\$#,0.00);\$#,0.00</code></summary>

```DAX
SUM(IMOBILIZADOS[VALORESTIMADO])-SUM(IMOBILIZADOS[VLRRESIDUAL])
```

</details>

<details><summary><code>IMOBILIZADOS[% MED DEPRECIADO]</code> — formato <code>0.00%;-0.00%;0.00%</code></summary>

```DAX

DIVIDE(
    SUMX(
        IMOBILIZADOS,
        IMOBILIZADOS[QTD] * IMOBILIZADOS[VLRRESIDUAL] * (IMOBILIZADOS[OData_%DEPRECIACAO] / 100)
    ),
    SUMX(
        IMOBILIZADOS,
        IMOBILIZADOS[QTD] * IMOBILIZADOS[VLRRESIDUAL]
    ))


```

</details>

<details><summary><code>IMOBILIZADOS[VALORES A DEPRECIAR]</code> — formato <code>\$#,0.00;(\$#,0.00);\$#,0.00</code></summary>

```DAX
[% MED DEPRECIADO]*SUM(IMOBILIZADOS[VLRRESIDUAL])
```

</details>

<details><summary><code>DESCRITIVOPRESENCA[IntervaloDatas]</code></summary>

```DAX

VAR DataMin = MIN('DESCRITIVOPRESENCA'[Data])
VAR DataMax = MAX('DESCRITIVOPRESENCA'[Data])
RETURN
    FORMAT(DataMin, "dd/MM/yyyy") & " - " & FORMAT(DataMax, "dd/MM/yyyy")

```

</details>

<details><summary><code>DESCRITIVOPRESENCA[DatasPresencaFormatadas]</code></summary>

```DAX

CONCATENATEX(
    VALUES(DESCRITIVOPRESENCA[Data]),
    FORMAT(DESCRITIVOPRESENCA[Data], "dd/MM/yyyy") & " (" & FORMAT(DESCRITIVOPRESENCA[Data], "dddd") & ")",
    ", "
)

```

</details>

<details><summary><code>DESCRITIVOPRESENCA[ProfissoesPorData]</code></summary>

```DAX

CONCATENATEX(
    VALUES(DESCRITIVOPRESENCA[Profissao]),
    DESCRITIVOPRESENCA[Profissao] & " (" & CALCULATE(COUNTROWS(DESCRITIVOPRESENCA)) & ")",
    ", "
)

```

</details>

<details><summary><code>DESCRITIVOPRESENCA[PresencaCheck]</code></summary>

```DAX

VAR DataSelecionada = MAX('dCalendário'[Date])
VAR NomeSelecionado = MAX(DESCRITIVOPRESENCA[FORNECEDOR])

VAR Presente =
    CALCULATE(
        COUNTROWS(DESCRITIVOPRESENCA),
        DESCRITIVOPRESENCA[DATA] = DataSelecionada,
        DESCRITIVOPRESENCA[FORNECEDOR] = NomeSelecionado
    )

RETURN
    IF(ISBLANK(NomeSelecionado) || ISBLANK(DataSelecionada), BLANK(),
        IF(Presente > 0, "✅", "❌")
    )

```

</details>

<details><summary><code>DESCRITIVOPRESENCA[% VALOR FORMA PGTO MÊS]</code> — formato <code>0.00%;-0.00%;0.00%</code></summary>

```DAX

DIVIDE(
    /* NUMERADOR */
    COUNT('DESCRITIVOPRESENCA'[FORNECEDOR]),

    /* DENOMINADOR */
    CALCULATE(
        COUNT('DESCRITIVOPRESENCA'[FORNECEDOR]),

        -- mantém FILIAL e DATA (mês)
        ALLEXCEPT(
            'DESCRITIVOPRESENCA',
            'FILIAIS'[FILIAL],
            'dCalendário'[Date].[Mês],
            'dCalendário'[Date].[Ano]
        ),

        -- remove apenas a FORMA DE PAGAMENTO
        ALL('DESCRITIVOPRESENCA'[FORMAPGTO])
    )
)

```

</details>

<details><summary><code>DEMONSTRATIVOETAPA[PERCENTUAL]</code> — formato <code>0%;-0%;0%</code></summary>

```DAX
SUM(DEMONSTRATIVOETAPA[QTDEXECUTADA])/SUM(DEMONSTRATIVOETAPA[TOTAL])
```

</details>

<details><summary><code>DESCRICAOMEDICOES[RESTANTE]</code> — formato <code>\$#,0.00;(\$#,0.00);\$#,0.00</code></summary>

```DAX
MAX(DESCRICAOMEDICOES[SALDOCONTRATO]) - SUM(DESCRICAOMEDICOES[VALORTOTAL])
```

</details>

<details><summary><code>ACUMULADO ETAPA[ACUMULADO ETAPA]</code> — formato <code>\$#,0.00;(\$#,0.00);\$#,0.00</code></summary>

```DAX

CALCULATE(
    SUM('ACUMULADO ETAPA'[CUSTO CAIXA]),
    FILTER(
        ALL('ACUMULADO ETAPA'),
        'ACUMULADO ETAPA'[FILIAL] = MAX('ACUMULADO ETAPA'[FILIAL])
            && 'ACUMULADO ETAPA'[ETAPA] <= MAX('ACUMULADO ETAPA'[ETAPA])
    )
)

```

</details>

<details><summary><code>ACUMULADO ETAPA[% Etapa]</code></summary>

```DAX

DIVIDE(
    SUM('ACUMULADO ETAPA'[CUSTO CAIXA]),
    CALCULATE(
        SUM('ACUMULADO ETAPA'[CUSTO CAIXA]),
        ALLEXCEPT('ACUMULADO ETAPA', 'ACUMULADO ETAPA'[FILIAL])
    )
)

```

</details>

<details><summary><code>ACUMULADO ETAPA[% ACUMULADO ETAPA]</code> — formato <code>#,0.00%;-#,0.00%;#,0.00%</code></summary>

```DAX

VAR TotalFilial =
    CALCULATE(
        SUM('ACUMULADO ETAPA'[CUSTO CAIXA]),
        ALLEXCEPT('ACUMULADO ETAPA', 'ACUMULADO ETAPA'[FILIAL])
    )
VAR RankingAtual =
    RANKX(
        FILTER(
            ALL('ACUMULADO ETAPA'),
            'ACUMULADO ETAPA'[FILIAL] = MAX('ACUMULADO ETAPA'[FILIAL])
        ),
        [% Etapa],
        ,
        DESC
    )
VAR Acumulado =
    CALCULATE(
        SUM('ACUMULADO ETAPA'[CUSTO CAIXA]),
        FILTER(
            FILTER(
                ALL('ACUMULADO ETAPA'),
                'ACUMULADO ETAPA'[FILIAL] = MAX('ACUMULADO ETAPA'[FILIAL])
            ),
            RANKX(
                FILTER(
                    ALL('ACUMULADO ETAPA'),
                    'ACUMULADO ETAPA'[FILIAL] = MAX('ACUMULADO ETAPA'[FILIAL])
                ),
                [% Etapa],
                ,
                DESC
            ) <= RankingAtual
        )
    )
RETURN
DIVIDE(Acumulado, TotalFilial)

```

</details>

<details><summary><code>APONTAMENTOSCOMERCIAIS[Medida]</code></summary>

```DAX

```

</details>

### 9.1 Pontos que exigem decisão antes da paridade final

- `APONTAMENTOSCOMERCIAIS[Medida]` está vazia; não há regra a reproduzir.
- `MEDIDAS[COR ALEATÓRIA]` é não determinística; no portal deve ser substituída por paleta estável por categoria.
- `DESCRICAOMEDICOES[Coluna]` é uma coluna calculada `null`; não deve aparecer em formulários.
- Existem nomes e fórmulas com possíveis erros legados, como `VENCIDADS`, comparação de datas com `0` e moeda formatada como `$`. O contrato preserva o resultado atual; qualquer correção exige validação de negócio separada.

## 10. Colunas calculadas DAX de negócio

Foram encontradas 40 colunas calculadas de negócio. Elas não existem como campos confiáveis para escrita no SharePoint e devem ser calculadas após a leitura.

<details><summary><code>dCalendário[DIA]</code></summary>

```DAX
FORMAT('dCalendário'[Date], "dd/MM/yyyy") & " (" & FORMAT('dCalendário'[Date], "dddd") & ")"
```

</details>

<details><summary><code>LANÇAMENTOS[TOTAL]</code></summary>

```DAX
'LANÇAMENTOS'[QTD]* 'LANÇAMENTOS'[VALOR UNITÁRIO]+'LANÇAMENTOS'[FRETE]
```

</details>

<details><summary><code>LANÇAMENTOS[GRUPO]</code></summary>

```DAX
RELATED('CADASTRO FAMÍLIA'[GRUPO])
```

</details>

<details><summary><code>LANÇAMENTOS[FAMÍLIA]</code></summary>

```DAX
RELATED('CADASTRO FAMÍLIA'[FAMÍLIA])
```

</details>

<details><summary><code>LANÇAMENTOS[SUBFAMÍLIA]</code></summary>

```DAX
RELATED(CADASTROPRODUTO[SUBFAMÍLIA])
```

</details>

<details><summary><code>LANÇAMENTOS[TIPO]</code></summary>

```DAX
RELATED('CADASTROSUBFAMÍLIA'[TIPO])
```

</details>

<details><summary><code>LANÇAMENTOS[UNIDADE]</code></summary>

```DAX
RELATED('CADASTROSUBFAMÍLIA'[UNIDADE])
```

</details>

<details><summary><code>LANÇAMENTOS[EMPENHADO]</code></summary>

```DAX
IF(AND('LANÇAMENTOS'[DATA PGTO PREVISTO]=0, 'LANÇAMENTOS'[DATA PGTO EFETUADO]=0), 'LANÇAMENTOS'[TOTAL], 0)
```

</details>

<details><summary><code>LANÇAMENTOS[EFETUADO]</code></summary>

```DAX
IF( 'LANÇAMENTOS'[DATA PGTO EFETUADO]<>0, 'LANÇAMENTOS'[TOTAL], 0)
```

</details>

<details><summary><code>LANÇAMENTOS[LIQUIDAÇÃO]</code></summary>

```DAX
IF(AND('LANÇAMENTOS'[DATA PGTO EFETUADO]=0, 'LANÇAMENTOS'[DATA PGTO PREVISTO]<>0), 'LANÇAMENTOS'[TOTAL],0)
```

</details>

<details><summary><code>LANÇAMENTOS[ITEM ENTREGUE]</code></summary>

```DAX
IF(AND('LANÇAMENTOS'[DATA]<>0, AND('LANÇAMENTOS'[DATA PGTO EFETUADO]=0,'LANÇAMENTOS'[DATA PGTO PREVISTO]=0)),"PEDIDO EMPENHADO", IF(AND('LANÇAMENTOS'[DATA]<>0, AND('LANÇAMENTOS'[DATA PGTO PREVISTO]<>0,'LANÇAMENTOS'[DATA PGTO EFETUADO]=0)), "PEDIDO LIQUIDADO PENDENTE PGTO", IF(AND('LANÇAMENTOS'[DATA]<>0, AND('LANÇAMENTOS'[DATA PGTO EFETUADO]<>0, 'LANÇAMENTOS'[DATA PGTO PREVISTO]=0)), "PA PENDENTE ENTREGA", IF(AND('LANÇAMENTOS'[DATA]<>0, AND('LANÇAMENTOS'[DATA PGTO PREVISTO]<>0, 'LANÇAMENTOS'[DATA PGTO EFETUADO]<>0)), "FINALIZADO"))))
```

</details>

<details><summary><code>LANÇAMENTOS[VALOR TOTAL]</code></summary>

```DAX
'LANÇAMENTOS'[VALOR UNITÁRIO] * 'LANÇAMENTOS'[QTD] +'LANÇAMENTOS'[FRETE]
```

</details>

<details><summary><code>LANÇAMENTOS[NomeMes]</code></summary>

```DAX
FORMAT('LANÇAMENTOS'[DATA PGTO EFETUADO], "mmmm")

```

</details>

<details><summary><code>LANÇAMENTOS[NumeroMes]</code></summary>

```DAX
MONTH('LANÇAMENTOS'[DATA PGTO EFETUADO])
```

</details>

<details><summary><code>LANCAMENTOOBRA[DATA EM ATENDIMENTO]</code></summary>

```DAX

IF(ISBLANK(LANCAMENTOOBRA[INÍCIO]),TODAY()+1000,
    IF(
        ISBLANK(LANCAMENTOOBRA[FIM]),
        TODAY()+1,
        LANCAMENTOOBRA[FIM]
    ))


```

</details>

<details><summary><code>LANCAMENTOOBRA[DATA INICIO CORRIGIDA]</code></summary>

```DAX

    IF(
        ISBLANK(LANCAMENTOOBRA[INÍCIO]),
        TODAY()+1000,
        LANCAMENTOOBRA[INÍCIO]
    )

```

</details>

<details><summary><code>LANCAMENTOOBRA[ETAPA ORDENADA]</code></summary>

```DAX
LANCAMENTOOBRA[INDICE]& " - " & LANCAMENTOOBRA[ETAPA]
```

</details>

<details><summary><code>LANCAMENTOOBRA[DIAS]</code></summary>

```DAX
DATEDIFF(LANCAMENTOOBRA[DATA INICIO CORRIGIDA],LANCAMENTOOBRA[DATA EM ATENDIMENTO],DAY)
```

</details>

<details><summary><code>LANCAMENTOTAREFAS[DESCRICAOMAIUSCULA]</code></summary>

```DAX
UPPER(LANCAMENTOTAREFAS[TAREFA])
```

</details>

<details><summary><code>LANCAMENTOTAREFAS[DIAS P/ FATAL]</code></summary>

```DAX
DATEDIFF(TODAY(),LANCAMENTOTAREFAS[DATA FATAL],DAY)
```

</details>

<details><summary><code>LANCAMENTOTAREFAS[CONJUGADO PONTUACOES]</code></summary>

```DAX
(LANCAMENTOTAREFAS[PONTUAÇÃO IMPACTO] * LANCAMENTOTAREFAS[PONTUAÇÃO URGÊNCIA] * LANCAMENTOTAREFAS[PONTUAÇÃO]) ^ (1/3)
```

</details>

<details><summary><code>LANCAMENTOTAREFAS[STATUS]</code></summary>

```DAX
IF(LANCAMENTOTAREFAS[DATA CONCLUSÃO]<>0,"CONCLUÍDO",IF(LANCAMENTOTAREFAS[DATA FATAL]=TODAY(),"FATAL HOJE",IF(LANCAMENTOTAREFAS[DIAS P/ FATAL]<0,"ATIVIDADE ATRASADA",IF([DIAS P/ FATAL < 5],"MENOS DE 5 DIAS P/ FATAL","FATAL EM MAIS DE 5 DIAS"))))
```

</details>

<details><summary><code>MEDIDAS[COR ALEATÓRIA]</code></summary>

```DAX

"#" &
FORMAT(INT(RANDBETWEEN(0, 255)), "X2") &
FORMAT(INT(RANDBETWEEN(0, 255)), "X2") &
FORMAT(INT(RANDBETWEEN(0, 255)), "X2")
```

</details>

<details><summary><code>IMOBILIZADOS[QTD* VALOR *DEP]</code></summary>

```DAX
IMOBILIZADOS[QTD]*[VLRRESIDUAL]*IMOBILIZADOS[OData_%DEPRECIACAO]
```

</details>

<details><summary><code>DESCRITIVOPRESENCA[DataFormatada]</code></summary>

```DAX

FORMAT([DATA], "dd/MM/yyyy") & " (" & FORMAT([DATA], "dddd") & ")"

```

</details>

<details><summary><code>DESCRITIVOPRESENCA[VLR DIARIO]</code></summary>

```DAX
RELATED(FORNECEDORES[VLR DIARIO])
```

</details>

<details><summary><code>DESCRITIVOPRESENCA[EXECUTADO DIÁRIO]</code></summary>

```DAX
DESCRITIVOPRESENCA[HORAS TOTAIS DECIMAL]/DESCRITIVOPRESENCA[HORAS CONTRATADAS] *DESCRITIVOPRESENCA[VLR DIARIO]
```

</details>

<details><summary><code>DESCRITIVOPRESENCA[MesPresenca]</code></summary>

```DAX
FORMAT(DESCRITIVOPRESENCA[DATA], "MMMM")
```

</details>

<details><summary><code>DEMONSTRATIVOETAPA[IDENTIFICADOR DEMONSTRATIVO]</code></summary>

```DAX
DEMONSTRATIVOETAPA[Id] & " -" & DEMONSTRATIVOETAPA[ATIVIDADEEXECUTADA]
```

</details>

<details><summary><code>DEMONSTRATIVOETAPA[DATEDIF]</code></summary>

```DAX
DATEDIFF(DEMONSTRATIVOETAPA[DATAEXECUTADO],DEMONSTRATIVOETAPA[DATAPREVISTO],DAY)
```

</details>

<details><summary><code>DEMONSTRATIVOETAPA[DATA EM ATENDIMENTO]</code></summary>

```DAX

IF(ISBLANK(DEMONSTRATIVOETAPA[DATAEXECUTADO]),TODAY()+1000,
    IF(
        ISBLANK(DEMONSTRATIVOETAPA[DATAPREVISTO]),
        TODAY()+1,
        DEMONSTRATIVOETAPA[DATAPREVISTO]
    ))

```

</details>

<details><summary><code>DEMONSTRATIVOETAPA[DEMONSTRATIVOETAPA]</code></summary>

```DAX
DEMONSTRATIVOETAPA[IMOVEL] & "- " & DEMONSTRATIVOETAPA[IDENTIFICADOR DEMONSTRATIVO]
```

</details>

<details><summary><code>TAREFASDELEGADAS[STATUS]</code></summary>

```DAX
IF(NOT ISBLANK(TAREFASDELEGADAS[DATACONCLUSAO0]),"ATIVIDADE CONCLUÍDA",IF(TAREFASDELEGADAS[DATAFATAL]<TODAY(),"ATRASADA", IF(NOT ISBLANK(TAREFASDELEGADAS[DATAINÍCIO]),"ATIVIDADE INICIADA",IF(ISBLANK(TAREFASDELEGADAS[DATAINÍCIO]),"ATIVIDADE NÃO INICIADA"))))
```

</details>

<details><summary><code>DESCRICAOMEDICOES[Coluna]</code></summary>

```DAX

```

</details>

<details><summary><code>EMPREITEIRO[INDICADOR CONTRAT]</code></summary>

```DAX
EMPREITEIRO[Id] & " - " & EMPREITEIRO[FORNECEDOR]
```

</details>

<details><summary><code>LANÇAMENTORECEITA[VALORPAGO]</code></summary>

```DAX

CALCULATE(
    SUM('LANÇAMENTORECEITA'[VALORTOTAL]),
    NOT ISBLANK('LANÇAMENTORECEITA'[DATAPGTOEFETUADO])
)

```

</details>

<details><summary><code>LANÇAMENTORECEITA[VALOR_NAO_PAGO]</code></summary>

```DAX

CALCULATE(
    SUM('LANÇAMENTORECEITA'[VALORTOTAL]),
    ISBLANK('LANÇAMENTORECEITA'[DATAPGTOEFETUADO])
)

```

</details>

<details><summary><code>APONTAMENTOSCOMERCIAIS[DATA EM ATENDIMENTO]</code></summary>

```DAX

IF(ISBLANK(APONTAMENTOSCOMERCIAIS[DATAINICIO]),TODAY()+1000,
    IF(
        ISBLANK(APONTAMENTOSCOMERCIAIS[DATAFIM]),
        TODAY()+1,
        APONTAMENTOSCOMERCIAIS[DATAFIM]
    ))
```

</details>

<details><summary><code>APONTAMENTOSCOMERCIAIS[DIAS]</code></summary>

```DAX
DATEDIFF(APONTAMENTOSCOMERCIAIS[DATAINICIO],APONTAMENTOSCOMERCIAIS[DATA EM ATENDIMENTO],DAY)
```

</details>

<details><summary><code>APONTAMENTOSCOMERCIAIS[%]</code></summary>

```DAX
if(isblank(APONTAMENTOSCOMERCIAIS[DATAFIM]),0,1)
```

</details>

## 11. Contrato CRUD, galerias e relatórios

### 11.1 Galerias

- Uma rota por lista física, com paginação server-side, busca, filtros por coluna, ordenação e seleção persistida na URL.
- Colunas padrão: ID, título/nome principal, filial, status, criado/modificado e responsável quando existirem. Campos adicionais são configurados pelo catálogo da entidade.
- Contagens dos cartões e relatórios são consultas derivadas da mesma coleção carregada; não criar listas de resumo.

### 11.2 Formulários

- Abrir somente por comando Novo/Editar; nunca deixar formulário extenso exposto no painel.
- Tipos SharePoint viram controles semânticos: Choice → select, Lookup/Person → busca remota, Boolean → checkbox, DateTime → data/hora, Currency/Number → entrada numérica, Attachments → uploader separado.
- Campos calculados, somente leitura, sistema (`Created`, `Modified`, `Author`, `Editor`) e colunas auxiliares do Power BI não podem ser enviados no PATCH.
- Após salvar, atualizar a galeria e todos os KPIs dependentes sem mudar de rota.

### 11.3 Relatórios

- Cada página do item 5 vira uma aba do portal. Slicers ficam em uma barra de filtros recolhível; KPIs no topo; gráficos no centro; tabela detalhada no fim.
- Clique em elemento de gráfico aplica filtro cruzado; segundo clique ou botão Limpar remove. O estado deve ser acessível por teclado e anunciado por `aria-live`.
- Exportação permitida apenas para o conjunto já filtrado e somente a usuários com permissão de leitura da entidade.

## 12. Ordem de implementação

1. Criar catálogo das 41 listas por GUID e resolver `siteId/listId` via Graph.
2. Implementar cliente Graph paginado, schema de colunas, ETags, anexos e erros 401/403/404/412/429.
3. Implementar calendário único, joins e agregações em DuckDB-WASM.
4. Traduzir as 40 colunas calculadas e 44 medidas para funções testadas.
5. Entregar páginas nesta ordem: Auditoria, Comercial, Financeiro, Etapa Obra, Recursos Humanos, Imobilizado e Apps.
6. Adicionar galerias e formulários apenas depois da paridade de leitura, para não misturar erro de cálculo com erro de gravação.
7. Validar cada visual contra o PBIX aberto com os mesmos filtros e uma amostra controlada.

## 13. Critérios de aceite

- Login somente Microsoft; nenhuma chave, segredo ou credencial no navegador.
- Nenhuma base duplicada e nenhum dado operacional persistido fora do SharePoint.
- Catálogo contém 41 GUIDs de lista, 53 tabelas de negócio, 44 medidas, 40 colunas calculadas e 83 relações de negócio.
- As sete páginas exibem 141 visuais equivalentes e respeitam as 393 interações explícitas.
- O filtro global `DESCRITIVOPRESENCA.PRESENCA = PRESENTE` está ativo antes de qualquer cálculo.
- Totais financeiros e comerciais coincidem com o PBIX para os mesmos filtros e datas.
- Relações inativas não afetam resultados até uma regra explícita ativá-las.
- Formulários usam nomes internos do SharePoint, ETag e permissões reais; falhas não deixam a interface em estado otimista incorreto.
- Visuais pagos são substituídos por bibliotecas gratuitas sem perder campos, filtros ou navegação.

## 14. Limites desta inspeção

- O relatório documenta metadados e fórmulas, não valida a qualidade dos registros atuais.
- O PBIX não contém todas as regras de validação de escrita das listas. Essas regras devem ser obtidas do schema SharePoint em tempo de execução.
- A semântica dos códigos de interação do layout foi aplicada como `1=filtrar`, `2=realçar`, `3=nenhuma`, coerente com as opções do Power BI; a primeira implementação deve confirmar a matriz com um teste visual por tipo.
- Power Apps e Power Automate incorporados dependem de permissões e licenciamento Microsoft. O contrato gratuito substitui os visuais por funções próprias do portal, mas não altera os aplicativos ou fluxos existentes.

---

**Resultado:** o Power BI aberto é reproduzível no portal sem base duplicada. Os dados podem vir diretamente das listas SharePoint; Power Query e DAX precisam ser traduzidos para uma camada de cálculo em memória; visuais pagos podem ser substituídos por ECharts/Tabulator/DuckDB-WASM.
