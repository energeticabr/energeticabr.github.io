function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const noCrossFilters = () => ({ filter: [], highlight: [] });
const assetBreakdowns = ["valor-por-fornecedor", "valor-por-item", "valor-por-grupo", "valor-por-funcao"];

const breakdownCrossFilters = currentId => ({
  filter: [
    "percentual-produto",
    "valor-por-filial",
    "valor-inicial",
    ...assetBreakdowns.filter(id => id !== currentId),
  ],
  highlight: [],
});

export const IMOBILIZADO_DEFINITION = deepFreeze({
  id: "imobilizado",
  title: "IMOBILIZADO",
  sourceEntityIds: ["filiais", "fornecedores", "imobilizados", "lancamentos"],
  filters: [
    { id: "concluido", title: "CONCLUÍDO", sourceEntityId: "lancamentos", field: "LANÇAMENTOS.CONCLUÍDO" },
    { id: "fornecedor", title: "FORNECEDOR", sourceEntityId: "lancamentos", field: "LANÇAMENTOS.FORNECEDOR" },
    { id: "produto", title: "PRODUTO", sourceEntityId: "lancamentos", field: "LANÇAMENTOS.PRODUTO" },
    { id: "profissao", title: "PROFISSÃO", sourceEntityId: "fornecedores", field: "FORNECEDORES.PROFISSAO" },
    { id: "etapa", title: "ETAPA", sourceEntityId: "lancamentos", field: "ACUMULADO (2).ETAPA", aliases: ["ETAPA"] },
    { id: "filial", title: "FILIAL", sourceEntityId: "lancamentos", field: "LANÇAMENTOS.FILIAL" },
    { id: "mes", title: "MÊS", sourceEntityId: "lancamentos", field: "dCalendário.Date.Mês", aliases: ["DATA PGTO EFETUADO"], granularity: "month" },
    { id: "ano", title: "ANO", sourceEntityId: "lancamentos", field: "dCalendário.Date.Ano", aliases: ["DATA PGTO EFETUADO"], granularity: "year" },
    { id: "conta", title: "CONTA", sourceEntityId: "lancamentos", field: "LANÇAMENTOS.CONTA" },
    { id: "tipo-despesa", title: "TIPO DESPESA", sourceEntityId: "lancamentos", field: "LANÇAMENTOS.TIPO DESPESA" },
  ],
  kpis: [
    { id: "valor-atual", title: "VALOR ATUAL", sourceEntityId: "imobilizados", measure: "Sum(IMOBILIZADOS.VLRRESIDUAL)", format: "currency" },
    { id: "valor-inicial", title: "VALOR INICIAL", sourceEntityId: "imobilizados", measure: "Sum(IMOBILIZADOS.VALORESTIMADO)", format: "currency" },
    { id: "valor-depreciado", title: "VALOR DEPRECIADO", sourceEntityId: "imobilizados", operation: "difference-sum", aliases: ["VALORESTIMADO"], subtractAliases: ["VLRRESIDUAL"], measure: "IMOBILIZADOS.VALOR DEPRECIADO", format: "currency" },
    { id: "media-depreciacao", title: "% MED A DEPRECIAR %2F MÊS", sourceEntityId: "imobilizados", operation: "weighted-rate", aliases: ["VLRRESIDUAL"], quantityAliases: ["QTD"], rateAliases: ["OData_%DEPRECIACAO", "%DEPRECIACAO"], measure: "IMOBILIZADOS.% MED DEPRECIADO", format: "percent" },
    { id: "valores-a-depreciar", title: "VALORES A DEPRECIAR", sourceEntityId: "imobilizados", operation: "weighted-rate-sum", aliases: ["VLRRESIDUAL"], quantityAliases: ["QTD"], rateAliases: ["OData_%DEPRECIACAO", "%DEPRECIACAO"], measure: "IMOBILIZADOS.VALORES A DEPRECIAR", format: "currency" },
    { id: "data-depreciacao", title: "DATA", sourceEntityId: "imobilizados", operation: "min", aliases: ["DATADEPRECIAÇÃO", "DATADEPRECIACAO"], format: "date" },
  ],
  charts: [
    {
      id: "percentual-produto",
      title: "% PRODUTO",
      type: "clusteredBarChart",
      sourceEntityId: "lancamentos",
      dimensions: ["LANÇAMENTOS.PRODUTO"],
      measures: ["MEDIDAS.LANÇAMENTOS"],
      crossFilters: { filter: ["valor-inicial", "valor-por-fornecedor"], highlight: ["valor-por-filial"] },
    },
    {
      id: "depreciacao-acumulada",
      title: "DEPRECIAÇÃO ACUMULADA",
      type: "lineChart",
      sourceEntityId: "imobilizados",
      dimensions: ["ACUMULADO (2).Início do Mês"],
      measures: ["MEDIDAS.ACUMULADO DEPRECIADO"],
      crossFilters: noCrossFilters(),
    },
    {
      id: "desembolsos-efetuados",
      title: "DESEMBOLSOS EFETUADOS",
      type: "lineChart",
      sourceEntityId: "lancamentos",
      dimensions: ["LANÇAMENTOS.DATA PGTO EFETUADO.Ano", "LANÇAMENTOS.DATA PGTO EFETUADO.Mês"],
      measures: ["Sum(LANÇAMENTOS.EFETUADO)"],
      crossFilters: noCrossFilters(),
    },
    {
      id: "valor-por-filial",
      title: "VALOR POR FILIAL",
      type: "clusteredColumnChart",
      sourceEntityIds: ["imobilizados", "lancamentos"],
      dimensions: ["FILIAIS.FILIAL"],
      measures: ["Sum(IMOBILIZADOS.VLRRESIDUAL)", "Sum(LANÇAMENTOS.EFETUADO)"],
      crossFilters: { filter: [...assetBreakdowns, "percentual-produto", "valor-inicial"], highlight: [] },
    },
    {
      id: "valor-por-fornecedor",
      title: "VALOR POR FORNECEDOR",
      type: "barChart",
      sourceEntityId: "imobilizados",
      dimensions: ["IMOBILIZADOS.FORNECEDOR"],
      measures: ["Sum(IMOBILIZADOS.VLRRESIDUAL)", "IMOBILIZADOS.VALOR DEPRECIADO"],
      crossFilters: breakdownCrossFilters("valor-por-fornecedor"),
    },
    {
      id: "valor-por-item",
      title: "VALOR POR ITEM",
      type: "barChart",
      sourceEntityId: "imobilizados",
      dimensions: ["IMOBILIZADOS.ITEM"],
      measures: ["Sum(IMOBILIZADOS.VLRRESIDUAL)", "IMOBILIZADOS.VALOR DEPRECIADO"],
      crossFilters: breakdownCrossFilters("valor-por-item"),
    },
    {
      id: "valor-por-grupo",
      title: "VALOR POR GRUPO",
      type: "barChart",
      sourceEntityId: "imobilizados",
      dimensions: ["IMOBILIZADOS.GRUPOIMOBILIZADO"],
      measures: ["Sum(IMOBILIZADOS.VLRRESIDUAL)", "IMOBILIZADOS.VALOR DEPRECIADO"],
      crossFilters: breakdownCrossFilters("valor-por-grupo"),
    },
    {
      id: "valor-por-funcao",
      title: "VALOR POR FUNÇÃO",
      type: "barChart",
      sourceEntityId: "imobilizados",
      dimensions: ["IMOBILIZADOS.FUNÇÃO"],
      measures: ["Sum(IMOBILIZADOS.VLRRESIDUAL)", "IMOBILIZADOS.VALOR DEPRECIADO"],
      crossFilters: breakdownCrossFilters("valor-por-funcao"),
    },
  ],
  table: {
    id: "imobilizados",
    title: "IMOBILIZADOS",
    sourceEntityId: "imobilizados",
    source: "IMOBILIZADOS",
    columns: [
      "IMOBILIZADOS.DATACADASTRO",
      "IMOBILIZADOS.DATACOMPRA",
      "IMOBILIZADOS.DATADEPRECIAÇÃO",
      "IMOBILIZADOS.FILIAL",
      "IMOBILIZADOS.ITEM",
      "IMOBILIZADOS.NÚMEROIMOBILIZADO",
      "IMOBILIZADOS.OData_%DEPRECIACAO",
      "IMOBILIZADOS.QTD",
      "IMOBILIZADOS.VALORESTIMADO",
      "IMOBILIZADOS.VLRRESIDUAL",
      "IMOBILIZADOS.VALOR DEPRECIADO",
    ],
    crossFilters: {
      filter: ["valor-por-fornecedor", "depreciacao-acumulada", "percentual-produto"],
      highlight: ["valor-por-filial"],
    },
    views: [
      {
        id: "lancamentos-imobilizado",
        title: "LANÇAMENTOS DO IMOBILIZADO",
        sourceEntityId: "lancamentos",
        columns: [
          "LANÇAMENTOS.DATA",
          "LANÇAMENTOS.DATA PGTO EFETUADO",
          "LANÇAMENTOS.EFETUADO",
          "LANÇAMENTOS.EMPENHADO",
          "LANÇAMENTOS.FORNECEDOR",
          "LANÇAMENTOS.LIQUIDAÇÃO",
          "LANÇAMENTOS.PRODUTO",
          "LANÇAMENTOS.QTD",
          "LANÇAMENTOS.TOTAL",
          "LANÇAMENTOS.VALOR UNITÁRIO",
        ],
      },
    ],
  },
});

export default IMOBILIZADO_DEFINITION;
