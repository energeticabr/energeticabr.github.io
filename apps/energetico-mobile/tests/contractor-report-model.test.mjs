import test from "node:test";
import assert from "node:assert/strict";

const model = await import("../src/chat/contractor-report-model.js").catch(() => ({}));

const columns = [
  { name: "field_1", displayName: "FILIAL" },
  { name: "field_2", displayName: "FORNECEDOR" },
  { name: "field_3", displayName: "ETAPA OBRA" },
  { name: "field_4", displayName: "ATIVIDADEEXECUTADA" },
  { name: "field_5", displayName: "STATUS" },
  { name: "field_6", displayName: "DATA INÍCIO" },
  { name: "field_7", displayName: "DATA FIM" },
  { name: "field_8", displayName: "TIPO DE MEDIÇÃO" },
  { name: "field_9", displayName: "IDCONTRATO" },
  { name: "field_10", displayName: "IDESTIMATIVA" },
  { name: "field_11", displayName: "VALORGLOBALESTIMADO" },
  { name: "field_12", displayName: "VALORTOTAL" },
  { name: "field_13", displayName: "VALORTOTALMEDICOES" },
];

function contractor(id, overrides = {}) {
  return { id: String(id), fields: {
    field_1: "004 - EDIFÍCIO XAVANTE", field_2: "Israel Escoramento", field_3: "Fundações",
    field_4: "Armação", field_5: "ATIVO", field_6: "2026-08-10T03:00:00Z",
    field_7: "", field_8: "MEDIÇÃO VALOR UNITÁRIO", field_9: "214", field_10: "215",
    field_11: "3.386,08", field_12: "", field_13: "", ...overrides,
  } };
}

test("normaliza os nomes internos pelas colunas SharePoint e mantém o ID da linha separado do documento", () => {
  assert.equal(typeof model.normalizeContractorRow, "function");
  const row = model.normalizeContractorRow(contractor(237), columns);
  assert.equal(row.id, "237");
  assert.equal(row.contractDocumentId, "214");
  assert.equal(row.estimateDocumentId, "215");
  assert.equal(row.branch, "004 - EDIFÍCIO XAVANTE");
  assert.equal(row.startDate, "2026-08-10T03:00:00Z");
  assert.equal(row.globalEstimatedValue, 3386.08);
});

test("combina os seis filtros e calcula indicadores sobre todas as linhas filtradas", () => {
  const rows = [
    model.normalizeContractorRow(contractor(237), columns),
    model.normalizeContractorRow(contractor(238, { field_6: "2026-09-10", field_9: "214", field_11: "100", field_5: "inativo" }), columns),
    model.normalizeContractorRow(contractor(239, { field_1: "000 - CENTRAL", field_9: "", field_11: "valor inválido" }), columns),
  ];
  const all = model.contractorReport(rows);
  assert.deepEqual(all.rows.map(row => row.id), ["238", "239", "237"]);
  assert.deepEqual(all.metrics, { active: 2, inactive: 1, contracts: 1, activeGlobalValue: 3386.08 });
  const filtered = model.contractorReport(rows, { branch: "004 - EDIFÍCIO XAVANTE", status: "ATIVO", supplier: "Israel Escoramento", stage: "Fundações", activity: "Armação", id: "237" });
  assert.deepEqual(filtered.rows.map(row => row.id), ["237"]);
  assert.deepEqual(filtered.metrics, { active: 1, inactive: 0, contracts: 1, activeGlobalValue: 3386.08 });
});

test("filtro de fornecedor preserva pontuação e acentos para não incluir contratos de nomes diferentes", () => {
  const rows = [
    model.normalizeContractorRow(contractor(1, { field_2: "ACME-A", field_11: "100" }), columns),
    model.normalizeContractorRow(contractor(2, { field_2: "ACMEA", field_9: "300", field_11: "200" }), columns),
    model.normalizeContractorRow(contractor(3, { field_2: "ACME-Á", field_9: "400", field_11: "300" }), columns),
  ];
  const filtered = model.contractorReport(rows, { supplier: "acme-a" });
  assert.deepEqual(filtered.rows.map(row => row.id), ["1"]);
  assert.deepEqual(filtered.metrics, { active: 1, inactive: 0, contracts: 1, activeGlobalValue: 100 });
});

test("classifica documentos pendentes e submetidos sem tratar ausência de status como aprovação", () => {
  assert.equal(model.documentCell("214", "PENDENTE").tone, "danger");
  assert.equal(model.documentCell("215", "SUBMETIDO").tone, "success");
  assert.equal(model.documentCell("215", "").tone, "neutral");
  assert.deepEqual(model.documentCell("", "SUBMETIDO"), { text: "PENDENTE", tone: "pending" });
});

test("calcula o valor do lançamento vinculado e preserva PENDENTE quando falta valor unitário", () => {
  const launchColumns = [
    { name: "field_2", displayName: "DATA" }, { name: "field_5", displayName: "FORNECEDOR" },
    { name: "field_8", displayName: "QUANTIDADE" }, { name: "field_9", displayName: "VALOR UNITÁRIO" },
    { name: "field_10", displayName: "FRETE" }, { name: "field_19", displayName: "CONCLUÍDO" },
    { name: "CONTRATO", displayName: "CONTRATO" },
  ];
  const paid = model.normalizeLaunchRow({ id: "100", fields: { field_2: "2026-10-01", field_5: "Fornecedor", field_8: 2, field_9: 70, field_10: 30, field_19: "PAGO", CONTRATO: "237" } }, launchColumns);
  const pending = model.normalizeLaunchRow({ id: "101", fields: { field_19: "PENDENTE", CONTRATO: "237" } }, launchColumns);
  assert.equal(paid.total, 170);
  assert.equal(paid.paymentTone, "success");
  assert.equal(pending.total, null);
  assert.equal(pending.paymentTone, "pending");
});

test("formata datas e moedas da base sem deslocar a data pelo fuso", () => {
  assert.equal(model.formatReportDate("2026-08-10T00:00:00Z"), "10/08/2026");
  assert.equal(model.formatReportDate(""), "PENDENTE");
  assert.equal(model.formatReportMoney(3386.08), "R$ 3.386,08");
});
