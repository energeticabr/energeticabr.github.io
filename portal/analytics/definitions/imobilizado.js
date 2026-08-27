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
    { id: "concluido", title: "CONCLUÍDO", field: "LANÇAMENTOS.CONCLUÍDO" },
    { id: "fornecedor", title: "FORNECEDOR", field: "LANÇAMENTOS.FORNECEDOR" },
    { id: "produto", title: "PRODUTO", field: "LANÇAMENTOS.PRODUTO" },
    { id: "profissao", title: "PROFISSÃO", field: "FORNECEDORES.PROFISSAO" },
    { id: "etapa", title: "ETAPA", field: "ACUMULADO (2).ETAPA" },
    { id: "filial", title: "FILIAL", field: "LANÇAMENTOS.FILIAL" },
    { id: "mes", title: "MÊS", field: "dCalendário.Date.Mês" },
    { id: "ano", title: "ANO", field: "dCalendário.Date.Ano" },
    { id: "conta", title: "CONTA", field: "LANÇAMENTOS.CONTA" },
    { id: "tipo-despesa", title: "TIPO DESPESA", field: "LANÇAMENTOS.TIPO DESPESA" },
  ],
  kpis: [
    { id: "valor-atual", title: "VALOR ATUAL", measure: "Sum(IMOBILIZADOS.VLRRESIDUAL)", format: "currency" },
    { id: "valor-inicial", title: "VALOR INICIAL", measure: "Sum(IMOBILIZADOS.VALORESTIMADO)", format: "currency" },
    { id: "valor-depreciado", title: "VALOR DEPRECIADO", measure: "IMOBILIZADOS.VALOR DEPRECIADO", format: "currency" },
    { id: "media-depreciacao", title: "% MED A DEPRECIAR %2F MÊS", measure: "IMOBILIZADOS.% MED DEPRECIADO", format: "percent" },
    { id: "valores-a-depreciar", title: "VALORES A DEPRECIAR", measure: "IMOBILIZADOS.VALORES A DEPRECIAR", format: "currency" },
    { id: "data-depreciacao", title: "DATA", measure: "Min(IMOBILIZADOS.DATADEPRECIAÇÃO)", format: "date" },
  ],
  charts: [
    {
      id: "percentual-produto",
      title: "% PRODUTO",
      type: "clusteredBarChart",
      dimensions: ["LANÇAMENTOS.PRODUTO"],
      measures: ["MEDIDAS.LANÇAMENTOS"],
      crossFilters: { filter: ["valor-inicial", "valor-por-fornecedor"], highlight: ["valor-por-filial"] },
    },
    {
      id: "depreciacao-acumulada",
      title: "DEPRECIAÇÃO ACUMULADA",
      type: "lineChart",
      dimensions: ["ACUMULADO (2).Início do Mês"],
      measures: ["MEDIDAS.ACUMULADO DEPRECIADO"],
      crossFilters: noCrossFilters(),
    },
    {
      id: "desembolsos-efetuados",
      title: "DESEMBOLSOS EFETUADOS",
      type: "lineChart",
      dimensions: ["LANÇAMENTOS.DATA PGTO EFETUADO.Ano", "LANÇAMENTOS.DATA PGTO EFETUADO.Mês"],
      measures: ["Sum(LANÇAMENTOS.EFETUADO)"],
      crossFilters: noCrossFilters(),
    },
    {
      id: "valor-por-filial",
      title: "VALOR POR FILIAL",
      type: "clusteredColumnChart",
      dimensions: ["FILIAIS.FILIAL"],
      measures: ["Sum(IMOBILIZADOS.VLRRESIDUAL)", "Sum(LANÇAMENTOS.EFETUADO)"],
      crossFilters: { filter: [...assetBreakdowns, "percentual-produto", "valor-inicial"], highlight: [] },
    },
    {
      id: "valor-por-fornecedor",
      title: "VALOR POR FORNECEDOR",
      type: "barChart",
      dimensions: ["IMOBILIZADOS.FORNECEDOR"],
      measures: ["Sum(IMOBILIZADOS.VLRRESIDUAL)", "IMOBILIZADOS.VALOR DEPRECIADO"],
      crossFilters: breakdownCrossFilters("valor-por-fornecedor"),
    },
    {
      id: "valor-por-item",
      title: "VALOR POR ITEM",
      type: "barChart",
      dimensions: ["IMOBILIZADOS.ITEM"],
      measures: ["Sum(IMOBILIZADOS.VLRRESIDUAL)", "IMOBILIZADOS.VALOR DEPRECIADO"],
      crossFilters: breakdownCrossFilters("valor-por-item"),
    },
    {
      id: "valor-por-grupo",
      title: "VALOR POR GRUPO",
      type: "barChart",
      dimensions: ["IMOBILIZADOS.GRUPOIMOBILIZADO"],
      measures: ["Sum(IMOBILIZADOS.VLRRESIDUAL)", "IMOBILIZADOS.VALOR DEPRECIADO"],
      crossFilters: breakdownCrossFilters("valor-por-grupo"),
    },
    {
      id: "valor-por-funcao",
      title: "VALOR POR FUNÇÃO",
      type: "barChart",
      dimensions: ["IMOBILIZADOS.FUNÇÃO"],
      measures: ["Sum(IMOBILIZADOS.VLRRESIDUAL)", "IMOBILIZADOS.VALOR DEPRECIADO"],
      crossFilters: breakdownCrossFilters("valor-por-funcao"),
    },
  ],
  table: {
    id: "imobilizados",
    title: "IMOBILIZADOS",
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
  },
});

export default IMOBILIZADO_DEFINITION;
