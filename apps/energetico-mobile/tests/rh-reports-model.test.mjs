import test from "node:test";
import assert from "node:assert/strict";
import { buildRhReport3, buildRhReport4, buildRhReport5, normalizeRhSupplier, normalizeRhPresence, normalizeRhLaunch } from "../src/chat/rh-reports-model.js";

const supplier = (name, overrides = {}) => ({ id: name, name, contractor: true, branch: "CENTRO", property: "OBRA A", profession: "PEDREIRO", status: "ATIVO", paymentMethod: "DIÁRIA", dailyValue: 120, ...overrides });
const presence = (name, date, state, overrides = {}) => ({ id: `${name}-${date}`, supplier: name, date, branch: "CENTRO", property: "OBRA A", profession: "PEDREIRO", presence: state, status: "PENDENTE PGTO", dailyValue: 120, ...overrides });

test("normaliza nomes internos do SharePoint, valores brasileiros e data sem deslocamento de fuso", () => {
  const columns = [
    { name: "field_1", displayName: "CADASTRO" }, { name: "field_2", displayName: "VLR DIARIO" },
    { name: "field_3", displayName: "FORMA PGTO" }, { name: "field_4", displayName: "EMPREITEIRO" },
    { name: "field_5", displayName: "PROFISSAO" }, { name: "field_6", displayName: "FILIAL" },
  ];
  const row = normalizeRhSupplier({ id: "18", fields: { field_1: "João", field_2: "R$ 1.234,50", field_3: "DIÁRIA", field_4: "SIM", field_5: "PEDREIRO", field_6: "CENTRO" } }, columns);
  assert.equal(row.name, "João"); assert.equal(row.dailyValue, 1234.5); assert.equal(row.contractor, true);
  const p = normalizeRhPresence({ id: "5", fields: { DATA: "2026-10-01T00:00:00-03:00", FORNECEDOR: "João", PRESENCA: "PRESENTE", VLORDIARIO: "1.234,50" } });
  assert.equal(p.date, "2026-10-01"); assert.equal(p.dailyValue, 1234.5);
});

test("valores monetários em texto seguem separadores brasileiros e números Graph mantêm o valor", () => {
  const supplierValue = value => normalizeRhSupplier({ id: "1", fields: { CADASTRO: "Ana", "VLR DIARIO": value } }).dailyValue;
  assert.equal(supplierValue("1.234"), 1234);
  assert.equal(supplierValue("1.234,56"), 1234.56);
  assert.equal(supplierValue("1,23"), 1.23);
  assert.equal(supplierValue(1.234), 1.234);
  assert.equal(normalizeRhPresence({ id: "2", fields: { VLORDIARIO: "1.234" } }).dailyValue, 1234);
  assert.equal(normalizeRhPresence({ id: "2", fields: { VLORDIARIO: 1.234 } }).dailyValue, 1.234);
  assert.equal(normalizeRhLaunch({ id: "3", fields: { "VALOR UNITÁRIO": "1.234", QUANTIDADE: 2 } }).total, 2468);
  assert.equal(normalizeRhLaunch({ id: "3", fields: { "VALOR UNITÁRIO": 1.234, QUANTIDADE: 2 } }).total, 2.468);
});

test("relatório 3 usa Today do dispositivo em São Paulo na virada UTC", () => {
  const NativeDate = globalThis.Date;
  const fixed = new NativeDate("2026-10-02T01:00:00Z").getTime();
  class SaoPauloBoundaryDate extends NativeDate {
    constructor(...args) { if (args.length) super(...args); else super(fixed); }
    getFullYear() { return this.getTime() === fixed ? 2026 : super.getFullYear(); }
    getMonth() { return this.getTime() === fixed ? 9 : super.getMonth(); }
    getDate() { return this.getTime() === fixed ? 1 : super.getDate(); }
  }
  globalThis.Date = SaoPauloBoundaryDate;
  try {
    const result = buildRhReport3({ suppliers: [supplier("Ana")], presences: [
      presence("Ana", "2026-08-31", "PRESENTE"), presence("Ana", "2026-09-01", "PRESENTE"),
    ] });
    assert.equal(result.branches[0].properties[0].professions[0].suppliers[0].attendance.last30Present, 1);
  } finally { globalThis.Date = NativeDate; }
});

test("relatório 3 agrupa fornecedores por filial, imóvel e profissão e marca diária incompleta", () => {
  const result = buildRhReport3({ suppliers: [supplier("Ana"), supplier("Bia", { dailyValue: null }), supplier("Carlos", { contractor: false })], presences: [presence("Ana", "2026-09-30", "PRESENTE")] }, {});
  assert.equal(result.supplierCount, 2);
  assert.equal(result.branches[0].properties[0].professions[0].suppliers.length, 2);
  assert.equal(result.branches[0].properties[0].dailyTotal, null);
  assert.equal(result.branches[0].properties[0].professions[0].suppliers[0].presentCount, 1);
  assert.equal(buildRhReport3({ suppliers: [supplier("Ana"), supplier("Bia")], presences: [presence("Ana", "2026-09-30", "PRESENTE")] }, { startDate: "2026-09-01" }).supplierCount, 1);
});

test("relatório 4 contabiliza estados e separa aprovado, pago e pendente por profissão", () => {
  const rows = [
    presence("Ana", "2026-10-01", "PRESENTE", { dailyValue: 120 }),
    presence("Ana", "2026-10-02", "PRESENTE", { status: "PAGO", dailyValue: 90 }),
    presence("Bia", "2026-10-02", "PENDENTE", { dailyValue: 80 }),
    presence("Bia", "2026-10-02", "AUSENTE", { dailyValue: 0 }),
  ];
  const result = buildRhReport4({ presences: rows }, { startDate: "2026-10-01", endDate: "2026-10-02" });
  assert.deepEqual([result.metrics.present, result.metrics.pending, result.metrics.absent], [2, 1, 1]);
  assert.equal(result.metrics.presentValue, 210);
  assert.equal(result.professions[0].approvedValue, 120);
  assert.equal(result.professions[0].paidValue, 90);
  assert.equal(result.professions[0].pendingValue, 80);
  assert.equal(result.days[0].date, "2026-10-02");
  assert.equal(result.days[0].branches[0].rows.length, 3);
});

test("relatórios 4 e 5 nunca mostram soma definitiva quando falta valor diário", () => {
  const rows = [presence("Ana", "2026-10-01", "PRESENTE", { dailyValue: 120 }), presence("Ana", "2026-10-02", "PRESENTE", { dailyValue: null })];
  assert.equal(buildRhReport4({ presences: rows }, {}).metrics.presentValue, null);
  const pending = buildRhReport5({ suppliers: [supplier("Ana")], presences: rows }, {});
  assert.equal(pending.approvedTotal, null);
  assert.equal(pending.pending[0].total, null);
});

test("relatório 5 inclui só empreiteiros com pagamento pendente e separa aprovação de validação", () => {
  const rows = [
    presence("Ana", "2026-10-01", "PRESENTE", { dailyValue: 150 }),
    presence("Ana", "2026-10-02", "PENDENTE", { dailyValue: 70 }),
    presence("Ana", "2026-10-02", "PRESENTE", { status: "PAGO", dailyValue: 50 }),
    presence("Bia", "2026-10-02", "PRESENTE", { dailyValue: 200 }),
  ];
  const result = buildRhReport5({ suppliers: [supplier("Ana"), supplier("Bia", { contractor: false })], presences: rows }, {});
  assert.equal(result.pending.length, 1);
  assert.equal(result.pending[0].pendingCount, 2);
  assert.equal(result.approvedTotal, 150);
  assert.equal(result.validationTotal, 70);
  assert.equal(result.total, 220);
  assert.deepEqual(result.pending[0].pendingDates.map(row => row.date), ["2026-10-01", "2026-10-02"]);
});

test("relatório 5 mantém pendências de todas as datas e filtra só ocorrências detalhadas", () => {
  const rows = [
    presence("Ana", "2026-09-01", "PRESENTE", { dailyValue: 500 }),
    presence("Ana", "2026-10-01", "PRESENTE", { dailyValue: 120 }),
  ];
  const report = buildRhReport5({ suppliers: [supplier("Ana")], presences: rows }, { startDate: "2026-10-01", endDate: "2026-10-02" });
  assert.equal(report.approvedTotal, 620);
  assert.equal(report.pending[0].pendingCount, 2);
  assert.deepEqual(report.pending[0].pendingDates.map(row => row.date), ["2026-09-01", "2026-10-01"]);
  assert.equal(report.details[0].occurrences, 1);
  assert.deepEqual(report.details[0].presenceRows.map(row => row.date), ["2026-10-01"]);
  const noOccurrence = buildRhReport5({ suppliers: [supplier("Ana")], presences: rows }, { startDate: "2026-11-01" });
  assert.equal(noOccurrence.approvedTotal, 620);
  assert.equal(noOccurrence.details.length, 0);
});
