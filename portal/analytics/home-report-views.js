const HOME_ANALYTICS_VIEWS = Object.freeze({
  "presenca-semanal": Object.freeze({
    filterIds: ["fornecedor", "profissao", "etapa", "filial"],
    kpiIds: [],
    chartIds: ["profissoes-dia", "presencas-profissional", "profissionais-etapa"],
    tableViewIds: ["presencas"],
  }),
  "apontamentos-funcionarios": Object.freeze({
    filterIds: ["fornecedor", "profissao", "etapa", "filial", "mes", "ano"],
    kpiIds: ["total-mao-de-obra"],
    chartIds: ["custo-por-data", "mao-de-obra-etapa", "custo-fornecedor", "custo-profissao", "mao-de-obra-filial"],
    tableViewIds: ["lancamentos"],
  }),
  presencas: Object.freeze({
    filterIds: ["fornecedor", "profissao", "etapa", "filial", "forma-pagamento", "atividade-executada"],
    kpiIds: ["valor-pendente"],
    chartIds: ["valores-pendentes-pagamento", "distribuicao-forma-pagamento", "presencas-profissional", "profissionais-etapa"],
    tableViewIds: ["presencas"],
  }),
  provisoes: Object.freeze({
    filterIds: ["produto", "forma-pagamento", "mes", "ano", "fornecedor", "etapa", "filial"],
    kpiIds: ["total-desembolsos-efetuados"],
    chartIds: ["empenhado-liquidacao-por-fornecedor", "custos-mensais-por-fornecedor", "custo-acumulado"],
  }),
});

function selected(values = [], ids) {
  if (!Array.isArray(ids)) return [...values];
  const allowed = new Set(ids);
  return values.filter(value => allowed.has(value.id));
}

function tableForView(table, view) {
  if (!table || !Array.isArray(view?.tableViewIds) || !Array.isArray(table.views)) return table;
  return { ...table, views: selected(table.views, view.tableViewIds) };
}

export function homeAnalyticsDefinition(action, definition) {
  if (!action || !definition) return definition;
  const view = HOME_ANALYTICS_VIEWS[action.id] || {};
  return {
    ...definition,
    homeViewId: action.id,
    title: action.label,
    filters: selected(definition.filters, view.filterIds),
    kpis: selected(definition.kpis, view.kpiIds),
    charts: selected(definition.charts, view.chartIds),
    table: tableForView(definition.table, view),
    powerAppsHtmlControl: action.sourceHtmlControl,
    powerAppsOnSelect: action.powerFx,
  };
}

export default homeAnalyticsDefinition;
