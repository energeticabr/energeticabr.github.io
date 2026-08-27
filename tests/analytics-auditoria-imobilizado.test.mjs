import assert from "node:assert/strict";
import test from "node:test";
import auditoriaDefault, { AUDITORIA_DEFINITION } from "../portal/analytics/definitions/auditoria.js";
import imobilizadoDefault, { IMOBILIZADO_DEFINITION } from "../portal/analytics/definitions/imobilizado.js";
import { ENTITIES } from "../portal/catalog/entities.js";

const CONTRACT_KEYS = ["charts", "filters", "id", "kpis", "sourceEntityIds", "table", "title"];

function assertDeepFrozen(value, path = "definition") {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true, `${path} deve estar congelado`);
  for (const [key, child] of Object.entries(value)) {
    assertDeepFrozen(child, `${path}.${key}`);
  }
}

function byId(items) {
  return Object.fromEntries(items.map(item => [item.id, item]));
}

test("exporta os dois contratos declarativos com a superfície estável", () => {
  assert.equal(auditoriaDefault, AUDITORIA_DEFINITION);
  assert.equal(imobilizadoDefault, IMOBILIZADO_DEFINITION);
  assert.deepEqual(Object.keys(AUDITORIA_DEFINITION).sort(), CONTRACT_KEYS);
  assert.deepEqual(Object.keys(IMOBILIZADO_DEFINITION).sort(), CONTRACT_KEYS);
  assert.equal(AUDITORIA_DEFINITION.id, "auditoria");
  assert.equal(AUDITORIA_DEFINITION.title, "AUDITORIA");
  assert.equal(IMOBILIZADO_DEFINITION.id, "imobilizado");
  assert.equal(IMOBILIZADO_DEFINITION.title, "IMOBILIZADO");
});

test("declara somente fontes físicas para materializar a visão de auditoria", () => {
  assert.deepEqual(AUDITORIA_DEFINITION.sourceEntityIds, [
    "tipos-de-documento",
    "diarios-de-obras",
    "filiais",
    "notas-pendentes",
    "homologacoes-de-fornecedor",
    "linhas-de-contrato",
    "documentos-operacionais",
  ]);

  const filters = byId(AUDITORIA_DEFINITION.filters);
  assert.equal(filters.filial.field, "FILIAIS.FILIAL");
  assert.equal(filters.status.field, "Tabela_Documentos.STATUS");
  assert.equal(filters["tipo-documento"].field, "Tabela_Documentos.TIPODOCUMENTO");
  assert.equal(filters.fornecedor.field, "Tabela_Documentos.FORNECEDOR");
});

test("resolve todos os sourceEntityIds no catálogo real do portal", () => {
  const catalogIds = new Set(ENTITIES.map(entity => entity.id));
  for (const definition of [AUDITORIA_DEFINITION, IMOBILIZADO_DEFINITION]) {
    for (const sourceEntityId of definition.sourceEntityIds) {
      assert.equal(catalogIds.has(sourceEntityId), true, `${definition.id}: fonte inexistente ${sourceEntityId}`);
    }
  }
});

test("preserva KPIs, dimensões e filtros cruzados principais de auditoria", () => {
  const kpis = byId(AUDITORIA_DEFINITION.kpis);
  assert.equal(kpis["diarios-pendentes"].measure, "DIÁRIO DE OBRAS.DIARIOSPENDENTES");
  assert.equal(kpis["homologacoes-pendentes"].measure, "Min(Tabela_Documentos.TIPODOCUMENTO)");

  const charts = byId(AUDITORIA_DEFINITION.charts);
  assert.deepEqual(charts["status-homologacao"].dimensions, [
    "CADASTRO TIPO DOCUMENTO.HOMOLOGAÇÃO",
    "Tabela_Documentos.STATUS",
  ]);
  assert.deepEqual(charts["status-homologacao"].measures, [
    "CountNonNull(Tabela_Documentos.TIPODOCUMENTO)",
  ]);
  assert.ok(charts["status-fornecedor"].crossFilters.filter.includes("status-homologacao"));
  assert.ok(charts["status-diarios-obras"].crossFilters.filter.includes("status-tipo-documento"));
  assert.equal(charts["notas-fiscais-pendentes"].measures[0], "Sum(NOTASPENDENTES.VALORTOTAL)");
  assert.deepEqual(AUDITORIA_DEFINITION.table.columns, [
    "Tabela_Documentos.Created",
    "Tabela_Documentos.DATASUBMETIDO",
    "Tabela_Documentos.FILIAL",
    "Tabela_Documentos.FORNECEDOR",
    "Tabela_Documentos.STATUS",
    "Tabela_Documentos.TIPODOCUMENTO",
  ]);
});

test("declara as fontes físicas e os dez slicers do painel imobilizado", () => {
  assert.deepEqual(IMOBILIZADO_DEFINITION.sourceEntityIds, [
    "filiais",
    "fornecedores",
    "imobilizados",
    "lancamentos",
  ]);
  assert.deepEqual(IMOBILIZADO_DEFINITION.filters.map(filter => filter.field), [
    "LANÇAMENTOS.CONCLUÍDO",
    "LANÇAMENTOS.FORNECEDOR",
    "LANÇAMENTOS.PRODUTO",
    "FORNECEDORES.PROFISSAO",
    "ACUMULADO (2).ETAPA",
    "LANÇAMENTOS.FILIAL",
    "dCalendário.Date.Mês",
    "dCalendário.Date.Ano",
    "LANÇAMENTOS.CONTA",
    "LANÇAMENTOS.TIPO DESPESA",
  ]);
});

test("preserva medidas patrimoniais e interações de filtro e realce", () => {
  const kpis = byId(IMOBILIZADO_DEFINITION.kpis);
  assert.equal(kpis["valor-atual"].measure, "Sum(IMOBILIZADOS.VLRRESIDUAL)");
  assert.equal(kpis["valor-inicial"].measure, "Sum(IMOBILIZADOS.VALORESTIMADO)");
  assert.equal(kpis["valor-depreciado"].measure, "IMOBILIZADOS.VALOR DEPRECIADO");
  assert.equal(kpis["media-depreciacao"].measure, "IMOBILIZADOS.% MED DEPRECIADO");
  assert.equal(kpis["valores-a-depreciar"].measure, "IMOBILIZADOS.VALORES A DEPRECIAR");

  const charts = byId(IMOBILIZADO_DEFINITION.charts);
  assert.deepEqual(charts["depreciacao-acumulada"].dimensions, ["ACUMULADO (2).Início do Mês"]);
  assert.deepEqual(charts["depreciacao-acumulada"].measures, ["MEDIDAS.ACUMULADO DEPRECIADO"]);
  assert.ok(charts["percentual-produto"].crossFilters.highlight.includes("valor-por-filial"));
  assert.ok(charts["valor-por-filial"].crossFilters.filter.includes("valor-inicial"));
  assert.ok(IMOBILIZADO_DEFINITION.table.crossFilters.highlight.includes("valor-por-filial"));
  assert.ok(IMOBILIZADO_DEFINITION.table.columns.includes("IMOBILIZADOS.NÚMEROIMOBILIZADO"));
  assert.ok(IMOBILIZADO_DEFINITION.table.columns.includes("IMOBILIZADOS.VALOR DEPRECIADO"));
});

test("congela profundamente todos os níveis exportados", () => {
  assertDeepFrozen(AUDITORIA_DEFINITION, "AUDITORIA_DEFINITION");
  assertDeepFrozen(IMOBILIZADO_DEFINITION, "IMOBILIZADO_DEFINITION");
});
