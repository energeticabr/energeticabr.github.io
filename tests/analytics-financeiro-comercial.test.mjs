import assert from "node:assert/strict";
import test from "node:test";
import { ENTITIES } from "../portal/catalog/entities.js";

const ROOT_KEYS = ["id", "title", "sourceEntityIds", "filters", "kpis", "charts", "table"];
const ENTITY_IDS = new Set(ENTITIES.map(entity => entity.id));

async function loadModule(path, label) {
  try {
    return await import(path);
  } catch (error) {
    assert.fail(`${label} deve exportar uma definição carregável: ${error.code || error.message}`);
  }
}

function assertDeeplyFrozen(value, path = "definition") {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true, `${path} deve estar congelado`);
  for (const [key, child] of Object.entries(value)) {
    assertDeeplyFrozen(child, `${path}.${key}`);
  }
}

function assertCatalogBacked(definition) {
  for (const entityId of definition.sourceEntityIds) {
    assert.equal(ENTITY_IDS.has(entityId), true, `sourceEntityId desconhecido: ${entityId}`);
  }

  const visit = value => {
    if (value === null || typeof value !== "object") return;
    if (typeof value.sourceEntityId === "string") {
      assert.equal(ENTITY_IDS.has(value.sourceEntityId), true, `sourceEntityId desconhecido: ${value.sourceEntityId}`);
      assert.equal(definition.sourceEntityIds.includes(value.sourceEntityId), true, `fonte não declarada: ${value.sourceEntityId}`);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(definition);
}

test("FINANCEIRO declara fontes, aliases, visuais e interações do inventário", async () => {
  const module = await loadModule("../portal/analytics/definitions/financeiro.js", "FINANCEIRO");
  const definition = module.default;

  assert.equal(definition, module.FINANCEIRO_DEFINITION);
  assert.deepEqual(Object.keys(definition), ROOT_KEYS);
  assert.equal(definition.id, "financeiro");
  assert.equal(definition.title, "FINANCEIRO");
  assert.deepEqual(definition.sourceEntityIds, [
    "lancamentos",
    "produtos",
    "filiais",
    "lancamentos-de-obras",
  ]);
  assert.deepEqual(definition.filters.map(filter => filter.field), [
    "LANÇAMENTOS.PRODUTO",
    "LANÇAMENTOS.SUBFAMÍLIA",
    "LANÇAMENTOS.FAMÍLIA",
    "LANÇAMENTOS.GRUPO",
    "LANÇAMENTOS.CONTA",
    "dCalendário.Date.Mês",
    "dCalendário.Date.Ano",
    "LANÇAMENTOS.FORNECEDOR",
    "LANCAMENTOOBRA.ETAPA",
    "CADASTROPRODUTO.TIPODESPESA",
    "FILIAIS.FILIAL",
  ]);
  assert.deepEqual(definition.kpis.map(kpi => kpi.id), [
    "total-desembolsos-efetuados",
    "total-viagens-em-campo",
  ]);

  const chartsById = new Map(definition.charts.map(chart => [chart.id, chart]));
  assert.deepEqual([...chartsById.keys()], [
    "desembolsos-por-periodo",
    "principais-lancamentos",
    "empenhado-liquidacao-por-fornecedor",
    "custos-mensais-por-fornecedor",
    "custos-por-fornecedor",
    "participacao-por-etapa",
    "custo-acumulado",
    "custo-por-filial",
    "custo-por-etapa",
    "percentual-tipo-despesa",
    "principais-materiais",
  ]);
  assert.equal(chartsById.get("participacao-por-etapa").type, "waterfallChart");
  assert.equal(chartsById.get("empenhado-liquidacao-por-fornecedor").type, "pivotTable");
  assert.deepEqual(chartsById.get("principais-lancamentos").dimensions, [
    "LANÇAMENTOS.FAMÍLIA",
    "LANÇAMENTOS.GRUPO",
    "LANÇAMENTOS.PRODUTO",
    "LANÇAMENTOS.SUBFAMÍLIA",
  ]);
  assert.deepEqual(chartsById.get("principais-lancamentos").measures, [
    "MEDIDAS.LANÇAMENTOS",
    "MEDIDAS.PENDENTE PGTO",
  ]);
  assert.deepEqual(chartsById.get("principais-lancamentos").crossFilters.filter, [
    "custos-por-fornecedor",
    "desembolsos-por-periodo",
    "custo-por-filial",
    "empenhado-liquidacao-por-fornecedor",
    "percentual-tipo-despesa",
    "custo-por-etapa",
    "principais-materiais",
  ]);
  assert.deepEqual(chartsById.get("principais-lancamentos").crossFilters.none, [
    "custos-mensais-por-fornecedor",
  ]);

  assert.equal(definition.table.id, "lancamentos-detalhados");
  assert.deepEqual(definition.table.columns.map(column => column.field), [
    "LANÇAMENTOS.DATA",
    "LANÇAMENTOS.DATA PGTO EFETUADO",
    "LANÇAMENTOS.EFETUADO",
    "LANÇAMENTOS.FILIAL",
    "LANÇAMENTOS.FORNECEDOR",
    "LANÇAMENTOS.FRETE",
    "LANÇAMENTOS.ID",
    "LANÇAMENTOS.PRODUTO",
    "LANÇAMENTOS.QTD",
    "LANÇAMENTOS.TOTAL",
    "LANÇAMENTOS.VALOR UNITÁRIO",
  ]);
  assert.equal(definition.kpis[0].measure, "MEDIDAS.LANÇAMENTOS");
  assert.deepEqual(definition.kpis[0].valueAliases, ["EFETUADO"]);

  assertCatalogBacked(definition);
  assertDeeplyFrozen(definition);
});

test("COMERCIAL declara fontes, aliases, visuais e interações do inventário", async () => {
  const module = await loadModule("../portal/analytics/definitions/comercial.js", "COMERCIAL");
  const definition = module.default;

  assert.equal(definition, module.COMERCIAL_DEFINITION);
  assert.deepEqual(Object.keys(definition), ROOT_KEYS);
  assert.equal(definition.id, "comercial");
  assert.equal(definition.title, "COMERCIAL");
  assert.deepEqual(definition.sourceEntityIds, [
    "apontamentos-comerciais",
    "clientes",
    "filiais",
    "homologacoes-de-fornecedor",
    "imoveis",
    "compras",
    "receitas",
    "lancamentos",
  ]);
  assert.deepEqual(definition.filters.map(filter => filter.field), [
    "FILIAIS.FILIAL",
    "dCalendário.Date.Mês",
    "dCalendário.Date.Ano",
    "LANÇAMENTOS.CONTA",
    "APONTAMENTOSCOMERCIAIS.IMOVEL",
  ]);
  assert.deepEqual(definition.kpis.map(kpi => kpi.id), ["total-vendas", "total-receitas"]);

  const chartsById = new Map(definition.charts.map(chart => [chart.id, chart]));
  assert.deepEqual([...chartsById.keys()], [
    "receita-por-periodo",
    "receita-por-cliente",
    "vendas-por-corretor",
    "documentos-por-filial",
    "imoveis-por-filial",
    "receita-por-filial",
    "documentos-por-imovel",
    "cronograma-comercial",
  ]);
  assert.equal(chartsById.get("imoveis-por-filial").type, "hundredPercentStackedColumnChart");
  assert.equal(chartsById.get("cronograma-comercial").type, "gantt");
  assert.deepEqual(chartsById.get("receita-por-cliente").dimensions, ["CADASTRO CLIENTE.NOME"]);
  assert.deepEqual(chartsById.get("receita-por-cliente").measures, [
    "Sum(LANÇAMENTORECEITA.VALOR_NAO_PAGO)",
    "Sum(LANÇAMENTORECEITA.VALORPAGO)",
  ]);
  assert.deepEqual(chartsById.get("receita-por-cliente").crossFilters.filter, [
    "vendas-por-corretor",
    "imoveis-por-filial",
    "documentos-por-filial",
    "receita-por-filial",
  ]);
  assert.deepEqual(chartsById.get("receita-por-filial").crossFilters.filter, [
    "total-vendas",
    "vendas-por-corretor",
    "receita-por-cliente",
    "imoveis-por-filial",
    "documentos-por-filial",
  ]);

  assert.equal(definition.table.id, "documentos-receita");
  assert.deepEqual(definition.table.columns.map(column => column.field), [
    "LANÇAMENTORECEITA.DATA",
    "LANÇAMENTORECEITA.DATAPGTOEFETUADO",
    "LANÇAMENTORECEITA.DESCRIÇÃO",
    "LANÇAMENTORECEITA.FILIAL",
    "LANÇAMENTORECEITA.FORMAPGTO",
    "LANÇAMENTORECEITA.FORNECEDOR",
    "LANÇAMENTORECEITA.VALORTOTAL",
  ]);
  assert.equal(definition.kpis[0].measure, "Sum(LANÇAMENTORECEITA.VALORTOTAL)");
  assert.deepEqual(chartsById.get("cronograma-comercial").progressAliases, ["%"]);

  assertCatalogBacked(definition);
  assertDeeplyFrozen(definition);
});
