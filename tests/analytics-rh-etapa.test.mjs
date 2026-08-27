import assert from "node:assert/strict";
import test from "node:test";

import etapaObra, { ETAPA_OBRA_DEFINITION } from "../portal/analytics/definitions/etapa-obra.js";
import recursosHumanos, { RECURSOS_HUMANOS_DEFINITION } from "../portal/analytics/definitions/recursos-humanos.js";
import { ENTITIES } from "../portal/catalog/entities.js";

const REQUIRED_KEYS = Object.freeze([
  "id",
  "title",
  "sourceEntityIds",
  "filters",
  "kpis",
  "charts",
  "table",
]);

function assertDeeplyFrozen(value, path = "definition") {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true, `${path} precisa ser imutavel`);
  for (const [key, nested] of Object.entries(value)) {
    assertDeeplyFrozen(nested, `${path}.${key}`);
  }
}

function assertDefinitionContract(definition) {
  assert.deepEqual(Object.keys(definition), REQUIRED_KEYS);
  assert.match(definition.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(definition.title.length > 0);
  assert.ok(definition.sourceEntityIds.length > 0);
  assert.ok(Array.isArray(definition.filters));
  assert.ok(Array.isArray(definition.kpis));
  assert.ok(Array.isArray(definition.charts));
  assert.equal(typeof definition.table, "object");
  assertDeeplyFrozen(definition);
}

test("os paineis exportam contratos declarativos profundamente imutaveis", () => {
  assert.equal(recursosHumanos, RECURSOS_HUMANOS_DEFINITION);
  assert.equal(etapaObra, ETAPA_OBRA_DEFINITION);
  assertDefinitionContract(RECURSOS_HUMANOS_DEFINITION);
  assertDefinitionContract(ETAPA_OBRA_DEFINITION);
});

test("todas as fontes dos paineis usam ids existentes no catalogo", () => {
  const catalogIds = new Set(ENTITIES.map(entity => entity.id));

  assert.deepEqual(RECURSOS_HUMANOS_DEFINITION.sourceEntityIds, [
    "produtos",
    "descricoes-de-presenca",
    "filiais",
    "fornecedores",
    "lancamentos-de-obras",
    "lancamentos",
  ]);
  assert.deepEqual(ETAPA_OBRA_DEFINITION.sourceEntityIds, [
    "apontamentos-de-funcionarios",
    "produtos",
    "descricoes-de-presenca",
    "filiais",
    "fornecedores",
    "lancamentos-de-obras",
    "lancamentos",
  ]);

  for (const definition of [RECURSOS_HUMANOS_DEFINITION, ETAPA_OBRA_DEFINITION]) {
    for (const entityId of definition.sourceEntityIds) {
      assert.ok(catalogIds.has(entityId), `${definition.id} referencia id ausente: ${entityId}`);
    }
  }
});

test("recursos humanos declara filtros, indicadores, graficos e as duas tabelas inventariadas", () => {
  const definition = RECURSOS_HUMANOS_DEFINITION;

  assert.equal(definition.id, "recursos-humanos");
  assert.equal(definition.title, "RECURSOS HUMANOS");
  assert.deepEqual(definition.filters.map(filter => filter.id), [
    "presenca-presente",
    "status-fornecedor",
    "fornecedor",
    "produto",
    "profissao",
    "etapa",
    "filial",
    "mes",
    "ano",
    "forma-pagamento",
    "imovel",
    "atividade-executada",
    "status-obra",
  ]);
  assert.deepEqual(definition.filters[0], {
    id: "presenca-presente",
    title: "PRESENÇA",
    sourceEntityId: "descricoes-de-presenca",
    aliases: ["PRESENCA"],
    scope: "global",
    operator: "in",
    values: ["PRESENTE"],
  });
  assert.deepEqual(definition.kpis.map(kpi => kpi.id), ["total-mao-de-obra", "valor-pendente"]);
  assert.deepEqual(definition.charts.map(chart => chart.id), [
    "custo-por-data",
    "custo-fornecedor",
    "mao-de-obra-etapa",
    "valores-pendentes-pagamento",
    "custo-profissao",
    "profissoes-dia",
    "distribuicao-forma-pagamento",
    "tipo-despesa",
    "mao-de-obra-filial",
    "presencas-profissional",
    "profissionais-etapa",
  ]);
  assert.ok(definition.charts.every(chart => chart.interaction === "cross-filter"));
  assert.deepEqual(definition.table.views.map(view => view.id), ["lancamentos", "presencas"]);
  assert.ok(definition.table.views.every(view => view.interaction === "cross-filter"));
});

test("etapa obra preserva filtros de pagina e traduz o Gantt para timeline", () => {
  const definition = ETAPA_OBRA_DEFINITION;

  assert.equal(definition.id, "etapa-obra");
  assert.equal(definition.title, "ETAPA OBRA");
  assert.deepEqual(definition.filters.map(filter => filter.id), [
    "presenca-presente",
    "filial",
    "etapa",
    "fornecedor",
    "produto",
    "tipo-fornecedor",
    "mes",
    "ano",
    "status-obra",
    "filial-obra",
    "indice-obra",
  ]);
  assert.deepEqual(definition.filters.find(filter => filter.id === "filial-obra"), {
    id: "filial-obra",
    title: "LANCAMENTOOBRA.FILIAL",
    aliases: ["FILIAL"],
    sourceEntityId: "lancamentos-de-obras",
    scope: "page",
    selectionMode: "inverted",
    values: [],
  });
  assert.deepEqual(definition.filters.find(filter => filter.id === "indice-obra"), {
    id: "indice-obra",
    title: "LANCAMENTOOBRA.INDICE",
    aliases: ["INDICE"],
    sourceEntityId: "lancamentos-de-obras",
    scope: "page",
    mode: "advanced",
    values: [],
  });
  assert.deepEqual(definition.kpis, []);
  assert.equal(definition.charts.length, 11);
  assert.ok(definition.charts.every(chart => chart.interaction === "cross-filter"));

  const timeline = definition.charts.find(chart => chart.type === "timeline");
  assert.deepEqual(timeline, {
    id: "cronograma-fisico",
    title: "Gantt1448688115699",
    type: "timeline",
    sourceEntityId: "lancamentos-de-obras",
    dimensionAliases: ["ETAPA ORDENADA"],
    startAliases: ["DATA INICIO CORRIGIDA"],
    endAliases: ["DATA EM ATENDIMENTO"],
    durationAliases: ["DIAS"],
    progressAliases: ["PERCENTUALEFETUADO"],
    interaction: "cross-filter",
    crossFilters: {
      filter: [
        "custo-fornecedor",
        "percentual-produto",
        "profissoes-dia",
        "presencas-profissional",
        "profissionais-etapa",
        "atividades-executadas",
        "distribuicao-forma-pagamento",
        "apontamentos-funcionarios",
        "tipo-despesa",
        "tipo-despesa-etapa",
      ],
      highlight: [],
      none: [],
    },
  });
  assert.deepEqual(definition.table.columns, []);
});
