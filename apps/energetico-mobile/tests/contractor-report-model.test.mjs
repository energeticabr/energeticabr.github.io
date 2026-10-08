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
    model.normalizeContractorRow(contractor(239, { field_1: "000 - CENTRAL", field_9: "", field_11: "" }), columns),
  ];
  const all = model.contractorReport(rows);
  assert.deepEqual(all.rows.map(row => row.id), ["238", "239", "237"]);
  assert.deepEqual(all.metrics, { active: 2, inactive: 1, contracts: 1, activeGlobalValue: 3386.08 });
  const filtered = model.contractorReport(rows, { branch: "004 - EDIFÍCIO XAVANTE", status: "ATIVO", supplier: "Israel Escoramento", stage: "Fundações", activity: "Armação", id: "237" });
  assert.deepEqual(filtered.rows.map(row => row.id), ["237"]);
  assert.deepEqual(filtered.metrics, { active: 1, inactive: 0, contracts: 1, activeGlobalValue: 3386.08 });
});

test("ignora LinkTitle calculado e rejeita ambiguidade real de nome interno ou exibição", () => {
  const item = { id: "237", fields: { Title: "Fornecedor real", LinkTitle: "errado", extra: "outro" } };
  const schema = [
    { name: "LinkTitle", displayName: "FORNECEDOR", readOnly: true },
    { name: "LinkTitleNoMenu", displayName: "FORNECEDOR" },
    { name: "LinkTitle2", displayName: "FORNECEDOR" },
    { name: "computed", displayName: "FORNECEDOR", computed: true },
    { name: "Title", displayName: "FORNECEDOR" },
  ];
  assert.equal(model.normalizeContractorRow(item, schema).supplier, "Fornecedor real");
  assert.throws(() => model.normalizeContractorRow(item, [...schema, { name: "extra", displayName: "FORNECEDOR" }]), /coluna|amb.gu/i);
  assert.throws(() => model.normalizeContractorRow({ id: "1", fields: { FORNECEDOR: "A", Fornecedor: "B" } }), /coluna|amb.gu/i);
});

test("metadados semânticos prevalecem sobre aliases legados mesmo quando o valor está vazio", () => {
  const schema = [
    { name: "field_9", displayName: "QUANTIDADE" },
    { name: "price", displayName: "VALOR UNITÁRIO" },
    { name: "field_19", displayName: "OUTRO CAMPO" },
    { name: "paid", displayName: "CONCLUÍDO" },
    { name: "freight", displayName: "FRETE" },
  ];
  const row = model.normalizeLaunchRow({ id: "1", fields: { field_9: 2, price: 0.1, paid: "", field_19: "PAGO" } }, schema);
  assert.equal(row.total, 0.2);
  assert.equal(row.paymentStatus, "PENDENTE");
  assert.equal(model.normalizeLaunchRow({ id: "2", fields: { field_9: 70 } }, [{ name: "field_9", displayName: "OUTRO CAMPO" }]).total, null);
  assert.equal(model.normalizeLaunchRow({ id: "3", fields: { field_9: 70, field_8: 2, field_10: 30, field_19: "PAGO" } }).total, 170);
});

test("não fabrica valores monetários removendo letras ou separadores inválidos", () => {
  for (const raw of ["USD 50", "12 reais", "12abc34", "R$", "1.2.3", "1,2,3", "1.23,45", "1,23.45", "--2", Infinity, NaN]) {
    const row = model.normalizeContractorRow(contractor(1, { field_11: raw }), columns);
    assert.equal(row.globalEstimatedValue, null, String(raw));
    assert.equal(model.contractorReport([row]).metrics.activeGlobalValue, null, String(raw));
  }
});

test("valores monetários mantêm tipos numéricos e rejeitam objetos ou arrays não escalares", () => {
  for (const raw of [{ invalid: "not blank" }, [], [10], { Value: [] }, true]) {
    const row = model.normalizeContractorRow(contractor(1, { field_11: raw }), columns);
    assert.equal(row.globalEstimatedValue, null);
    assert.equal(model.contractorReport([row]).metrics.activeGlobalValue, null);
  }
  assert.equal(model.normalizeContractorRow(contractor(1, { field_11: { Value: 12.5 } }), columns).globalEstimatedValue, 12.5);
  assert.equal(model.normalizeLaunchRow({ id: "1", fields: { VALORUNITARIO: 1e-7, QUANTIDADE: 2, FRETE: 0 } }).total, 0.0000002);
  for (const raw of ["1.234.567", "1,234,567"]) {
    assert.equal(model.normalizeContractorRow(contractor(1, { field_11: raw }), columns).globalEstimatedValue, 1234567);
  }
});

test("valores globais vazios coalescem a zero e valores malformados tornam só a soma ativa desconhecida", () => {
  const blank = model.normalizeContractorRow(contractor(1, { field_11: "   " }), columns);
  const invalid = model.normalizeContractorRow(contractor(2, { field_11: "inválido" }), columns);
  assert.equal(blank.globalEstimatedValue, null);
  assert.equal(blank.globalEstimatedValueKnownBlank, true);
  assert.equal(model.formatReportMoney(blank.globalEstimatedValue), "PENDENTE");
  assert.equal(invalid.globalEstimatedValue, null);
  assert.equal(invalid.globalEstimatedValueKnownBlank, false);
  assert.equal(blank.totalValue, null);
  assert.equal(model.contractorReport([blank]).metrics.activeGlobalValue, 0);
  assert.equal(model.contractorReport([blank, invalid]).metrics.activeGlobalValue, null);
  assert.equal(model.contractorReport([{ ...invalid, status: "INATIVO" }, blank]).metrics.activeGlobalValue, 0);
  assert.equal(model.contractorReport([invalid, blank], { id: "1" }).metrics.activeGlobalValue, 0);
});

test("célula global vazia permanece PENDENTE enquanto só o indicador coalesce vazios reais a zero", () => {
  for (const value of [undefined, null, "", "  ", { Value: null }, { Value: "" }]) {
    const row = model.normalizeContractorRow(contractor(1, { field_11: value }), columns);
    assert.equal(row.globalEstimatedValue, null);
    assert.equal(row.globalEstimatedValueKnownBlank, true);
    assert.equal(model.formatReportMoney(row.globalEstimatedValue), "PENDENTE");
    assert.equal(model.contractorReport([row]).metrics.activeGlobalValue, 0);
  }
  const zero = model.normalizeContractorRow(contractor(2, { field_11: 0 }), columns);
  assert.equal(zero.globalEstimatedValueKnownBlank, false);
  assert.equal(model.formatReportMoney(zero.globalEstimatedValue), "R$ 0,00");
  for (const value of ["erro", "R$", {}, [], { Value: [] }]) {
    const row = model.normalizeContractorRow(contractor(3, { field_11: value }), columns);
    assert.equal(row.globalEstimatedValueKnownBlank, false);
    assert.equal(model.formatReportMoney(row.globalEstimatedValue), "PENDENTE");
    assert.equal(model.contractorReport([row]).metrics.activeGlobalValue, null);
  }
  assert.equal(model.contractorReport([{ ...zero, globalEstimatedValue: null }]).metrics.activeGlobalValue, null);
});

test("mapeamento global desconhecido não confirma vazio nem fabrica soma zero", () => {
  const unknown = model.normalizeContractorRow({ id: "237", fields: { state: "ATIVO", field_999: 999 } }, [
    { name: "state", displayName: "STATUS" }, { name: "field_999", displayName: "OUTRO CAMPO" },
  ]);
  assert.equal(unknown.globalEstimatedValue, null);
  assert.equal(unknown.globalEstimatedValueKnownBlank, false);
  assert.equal(model.contractorReport([unknown]).metrics.activeGlobalValue, null);
  assert.equal(unknown.supplier, "");
  const withoutSchema = model.normalizeContractorRow({ id: "238", fields: { STATUS: "ATIVO" } });
  assert.equal(withoutSchema.globalEstimatedValueKnownBlank, false);
  assert.equal(model.contractorReport([withoutSchema]).metrics.activeGlobalValue, null);
});

test("coluna global resolvida omitida pelo Graph confirma vazio e preserva PENDENTE com soma zero", () => {
  const resolved = model.normalizeContractorRow({ id: "237", fields: { state: "ATIVO" } }, [
    { name: "state", displayName: "STATUS" }, { name: "global", displayName: "VALORGLOBALESTIMADO" },
  ]);
  assert.equal(resolved.globalEstimatedValue, null);
  assert.equal(resolved.globalEstimatedValueKnownBlank, true);
  assert.equal(model.formatReportMoney(resolved.globalEstimatedValue), "PENDENTE");
  assert.equal(model.contractorReport([resolved]).metrics.activeGlobalValue, 0);
  const directBlank = model.normalizeContractorRow({ id: "238", fields: { STATUS: "ATIVO", VALORGLOBALESTIMADO: null } });
  assert.equal(directBlank.globalEstimatedValueKnownBlank, true);
  assert.equal(model.contractorReport([directBlank]).metrics.activeGlobalValue, 0);
});

test("quantidade e frete sem mapeamento não coalescem como colunas resolvidas vazias", () => {
  const schema = [
    { name: "unit", displayName: "VALOR UNITÁRIO" }, { name: "freight", displayName: "FRETE" },
    { name: "field_999", displayName: "QUANTIDADE DESCONHECIDA" },
  ];
  assert.equal(model.normalizeLaunchRow({ id: "1", fields: { unit: 10, freight: 3, field_999: 2 } }, schema).total, null);
  assert.equal(model.normalizeLaunchRow({ id: "2", fields: { VALORUNITARIO: 10, FRETE: 3 } }).total, null);
  assert.equal(model.normalizeLaunchRow({ id: "3", fields: { VALORUNITARIO: 10, QUANTIDADE: 2 } }).total, null);
  const semanticBlank = model.normalizeLaunchRow({ id: "4", fields: { unit: 10, freight: 3 } }, [
    ...schema, { name: "qty", displayName: "QUANTIDADE" },
  ]);
  assert.equal(semanticBlank.total, 3);
  const legacyBlank = model.normalizeLaunchRow({ id: "5", fields: { unit: 10, freight: 3 } }, [
    ...schema, { name: "field_8", displayName: "field_8" },
  ]);
  assert.equal(legacyBlank.total, 3);
  assert.equal(model.normalizeLaunchRow({ id: "6", fields: { VALORUNITARIO: 10, field_8: null, FRETE: 3 } }).total, 3);
});

test("soma global e multiplicação de lançamento usam aritmética decimal exata", () => {
  const rows = ["0,10", "R$ 0,20"].map((amount, i) => model.normalizeContractorRow(contractor(i + 1, { field_11: amount }), columns));
  assert.equal(model.contractorReport(rows).metrics.activeGlobalValue, 0.3);
  assert.equal(model.normalizeLaunchRow({ id: "1", fields: { VALORUNITARIO: "0,1", QUANTIDADE: 3, FRETE: "0,2" } }).total, 0.5);
  for (const [raw, expected] of [["R$ 1.234,56", 1234.56], ["1,234.56", 1234.56], ["1234.56", 1234.56], ["-2,50", -2.5], [0, 0]]) {
    assert.equal(model.normalizeContractorRow(contractor(1, { field_11: raw }), columns).globalEstimatedValue, expected);
  }
});

test("prefixo R$ confirma agrupamento brasileiro sem reinterpretar decimais de máquina", () => {
  for (const [raw, expected] of [
    ["R$1.234", 1234], ["R$ 1.234.567", 1234567], ["R$1.234,56", 1234.56],
    ["R$1.234.567,89", 1234567.89], ["R$ -1.234", -1234], ["R$0,10", 0.1],
    ["1.234", 1.234], [1.234, 1.234], ["1234.56", 1234.56],
  ]) {
    const row = model.normalizeContractorRow(contractor(1, { field_11: raw }), columns);
    assert.equal(row.globalEstimatedValue, expected, String(raw));
    assert.equal(model.contractorReport([row]).metrics.activeGlobalValue, expected, String(raw));
  }
  for (const raw of ["R$1.23", "R$1,234.56", "R$1.23.456", "R$1.234.56"]) {
    const row = model.normalizeContractorRow(contractor(1, { field_11: raw }), columns);
    assert.equal(row.globalEstimatedValue, null, raw);
    assert.equal(model.contractorReport([row]).metrics.activeGlobalValue, null, raw);
  }
  assert.equal(model.normalizeLaunchRow({ id: "1", fields: { VALORUNITARIO: "R$1.234,56", QUANTIDADE: 1, FRETE: "R$0,44" } }).total, 1235);
});

test("quantidade e frete vazios coalescem a zero mas não ocultam entrada não vazia inválida", () => {
  for (const fields of [{ VALORUNITARIO: 10, QUANTIDADE: "erro" }, { VALORUNITARIO: 10, QUANTIDADE: 2, FRETE: "erro" }]) {
    assert.equal(model.normalizeLaunchRow({ id: "1", fields }).total, null);
  }
  assert.equal(model.normalizeLaunchRow({ id: "1", fields: { VALORUNITARIO: 10, QUANTIDADE: null, FRETE: 2 } }).total, 2);
  assert.equal(model.normalizeLaunchRow({ id: "1", fields: { VALORUNITARIO: 0, QUANTIDADE: 2, FRETE: 3 } }).total, 3);
  assert.equal(model.normalizeLaunchRow({ id: "1", fields: { VALORUNITARIO: 1e308, QUANTIDADE: 2, FRETE: 0 } }).total, null);
});

test("ordena datas ISO e brasileiras cronologicamente, colocando ausências e inválidas no fim", () => {
  const dates = ["31/01/2026", "2026-02-01", "01/02/2026", "", "inválida", "31/02/2026"];
  const rows = dates.map((date, i) => model.normalizeContractorRow(contractor(i + 1, { field_6: date }), columns));
  assert.deepEqual(model.contractorReport(rows).rows.map(row => row.id), ["3", "2", "1", "6", "5", "4"]);
  assert.deepEqual(rows.map(row => row.id), ["1", "2", "3", "4", "5", "6"]);
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
