import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAnalyticsDefinition } from "../portal/analytics/definition-normalizer.js";

test("normaliza aliases explicitos, campos qualificados e referencias entityId/field", () => {
  const definition = {
    id: "financeiro",
    title: "FINANCEIRO",
    sourceEntityIds: ["lancamentos", "filiais"],
    filters: [
      { id: "filial", title: "FILIAL", aliases: ["FILIAL", "Title"] },
      { id: "status", title: "STATUS", field: "LANÇAMENTOS.STATUS" },
      { id: "cliente", title: "CLIENTE", field: { entityId: "clientes", field: "NOME" } },
    ],
  };

  const normalized = normalizeAnalyticsDefinition(definition);

  assert.equal(normalized.id, "financeiro");
  assert.equal(normalized.title, "FINANCEIRO");
  assert.deepEqual(normalized.sourceEntityIds, ["lancamentos", "filiais"]);
  assert.deepEqual(normalized.filters, [
    { id: "filial", title: "FILIAL", aliases: ["FILIAL", "Title"] },
    { id: "status", title: "STATUS", aliases: ["STATUS", "LANÇAMENTOS.STATUS"] },
    { id: "cliente", title: "CLIENTE", aliases: ["NOME"] },
  ]);
});

test("mapeia agregacoes conhecidas sem avaliar expressoes", () => {
  delete globalThis.__analyticsNormalizerExecuted;
  const definition = {
    kpis: [
      { id: "soma", title: "SOMA", measure: "Sum(IMOBILIZADOS.VLRRESIDUAL)", format: "currency" },
      { id: "quantidade", title: "QUANTIDADE", aggregate: "count" },
      { id: "preenchidos", title: "PREENCHIDOS", measure: "CountNonNull(Tabela_Documentos.STATUS)" },
      { id: "distintos", title: "DISTINTOS", operation: "distinct", valueAliases: ["FORNECEDOR"] },
      { id: "media", title: "MEDIA", aggregate: { operation: "average", field: "LANÇAMENTOS.VALOR" } },
      {
        id: "pendente",
        title: "PENDENTE",
        operation: "pending-sum",
        aliases: ["VALOR"],
        statusAliases: ["STATUS", "SITUACAO"],
      },
      {
        id: "seguro",
        title: "SEGURO",
        measure: "globalThis.__analyticsNormalizerExecuted = true",
      },
    ],
  };

  const normalized = normalizeAnalyticsDefinition(definition);

  assert.deepEqual(normalized.kpis, [
    {
      id: "soma",
      title: "SOMA",
      operation: "sum",
      aliases: ["VLRRESIDUAL", "IMOBILIZADOS.VLRRESIDUAL"],
      statusAliases: [],
      format: "currency",
    },
    { id: "quantidade", title: "QUANTIDADE", operation: "count", aliases: [], statusAliases: [], format: "number" },
    {
      id: "preenchidos",
      title: "PREENCHIDOS",
      operation: "count",
      aliases: ["STATUS", "Tabela_Documentos.STATUS"],
      statusAliases: [],
      format: "number",
    },
    {
      id: "distintos",
      title: "DISTINTOS",
      operation: "distinct-count",
      aliases: ["FORNECEDOR"],
      statusAliases: [],
      format: "number",
    },
    {
      id: "media",
      title: "MEDIA",
      operation: "average",
      aliases: ["VALOR", "LANÇAMENTOS.VALOR"],
      statusAliases: [],
      format: "number",
    },
    {
      id: "pendente",
      title: "PENDENTE",
      operation: "pending-sum",
      aliases: ["VALOR"],
      statusAliases: ["STATUS", "SITUACAO"],
      format: "number",
    },
    { id: "seguro", title: "SEGURO", operation: "count", aliases: [], statusAliases: [], format: "number" },
  ]);
  assert.equal(globalThis.__analyticsNormalizerExecuted, undefined);
});

test("normaliza graficos com dimensions, series, measures e aliases modernos", () => {
  const definition = {
    charts: [
      {
        id: "por-filial",
        title: "VALOR POR FILIAL",
        type: "clusteredColumnChart",
        dimensions: ["FILIAIS.FILIAL"],
        series: [{ entityId: "lancamentos", field: "STATUS" }],
        measures: ["Sum(LANÇAMENTOS.EFETUADO)"],
        dimensionAliases: ["UNIDADE"],
        valueAliases: ["VALOR"],
        format: "currency",
      },
    ],
  };

  const normalized = normalizeAnalyticsDefinition(definition);

  assert.deepEqual(normalized.charts, [
    {
      id: "por-filial",
      title: "VALOR POR FILIAL",
      type: "clusteredColumnChart",
      dimensionAliases: ["UNIDADE", "FILIAL", "FILIAIS.FILIAL", "STATUS"],
      operation: "sum",
      valueAliases: ["VALOR", "EFETUADO", "LANÇAMENTOS.EFETUADO"],
      format: "currency",
    },
  ]);
});

test("normaliza colunas textuais e estruturadas da tabela", () => {
  const definition = {
    table: {
      id: "ativos",
      title: "ATIVOS",
      columns: [
        "IMOBILIZADOS.DATADEPRECIAÇÃO",
        { id: "valor", title: "VALOR", aliases: ["VLRRESIDUAL"], type: "currency" },
        { id: "cliente", title: "CLIENTE", field: { entityId: "clientes", field: "NOME" } },
      ],
    },
  };

  const normalized = normalizeAnalyticsDefinition(definition);

  assert.equal(normalized.table.id, "ativos");
  assert.equal(normalized.table.title, "ATIVOS");
  assert.deepEqual(normalized.table.columns, [
    {
      id: "datadepreciacao",
      title: "DATADEPRECIAÇÃO",
      aliases: ["DATADEPRECIAÇÃO", "IMOBILIZADOS.DATADEPRECIAÇÃO"],
      type: "text",
    },
    { id: "valor", title: "VALOR", aliases: ["VLRRESIDUAL"], type: "currency" },
    { id: "cliente", title: "CLIENTE", aliases: ["NOME"], type: "text" },
  ]);
});

test("aplica defaults seguros, congela profundamente e nao muta a entrada", () => {
  const definition = {
    filters: [{ field: "Tabela.STATUS" }],
    kpis: [{}],
    charts: [{}],
    table: { columns: [{}] },
  };
  const before = structuredClone(definition);

  const normalized = normalizeAnalyticsDefinition(definition);

  assert.deepEqual(definition, before);
  assert.deepEqual(normalized.filters[0], {
    id: "filter-1",
    title: "STATUS",
    aliases: ["STATUS", "Tabela.STATUS"],
  });
  assert.deepEqual(normalized.kpis[0], {
    id: "kpi-1",
    title: "KPI 1",
    operation: "count",
    aliases: [],
    statusAliases: [],
    format: "number",
  });
  assert.deepEqual(normalized.charts[0], {
    id: "chart-1",
    title: "GRÁFICO 1",
    type: "barChart",
    dimensionAliases: [],
    operation: "count",
    valueAliases: [],
    format: "number",
  });
  assert.deepEqual(normalized.table.columns[0], {
    id: "column-1",
    title: "COLUNA 1",
    aliases: [],
    type: "text",
  });
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.filters), true);
  assert.equal(Object.isFrozen(normalized.filters[0].aliases), true);
  assert.equal(Object.isFrozen(normalized.table.columns[0]), true);
  assert.throws(() => normalized.filters.push({}), TypeError);
});
