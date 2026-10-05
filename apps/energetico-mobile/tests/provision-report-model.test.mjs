import test from "node:test";
import assert from "node:assert/strict";

// Keep missing exports as assertion failures during the initial RED run.
const model = await import("../src/chat/provision-report-model.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND" && error.message.includes("provision-report-model.js")) return {};
  throw error;
});

const provision = (id, changes = {}) => ({
  id: String(id), recurrenceId: "7", branch: "Filial A", supplier: "Alfa", product: "Internet",
  observation: "", property: "Sala 1", dueDate: "2026-10-05", paidDate: "", schedule: "PENDENTE",
  scheduledDate: "", executionDate: "", status: "PAGAMENTO PREVISTO", total: 10, ...changes,
});
const recurrence = (id, changes = {}) => ({
  id: String(id), branch: "Filial A", supplier: "Alfa", product: "Internet", property: "Sala 1",
  status: "ATIVO", startDate: "2025-03-12", modified: "2026-10-01T12:30:00.000Z", ...changes,
});
const build = (provisions = [], recurrences = [], filters = {}, today = "2026-10-05") => {
  assert.equal(typeof model.buildProvisionReport, "function");
  return model.buildProvisionReport({ provisions, recurrences }, filters, today);
};

test("discovers SharePoint aliases and keeps scheduling and execution dates separate", () => {
  assert.equal(typeof model.normalizeProvisionReportRow, "function");
  const columns = [
    { name: "field_1", displayName: "FILIAL" }, { name: "field_2", displayName: "FORNECEDOR" },
    { name: "field_3", displayName: "VALOR TOTAL" }, { name: "field_4", displayName: "QTD" },
    { name: "field_5", displayName: "PGTOAGENDADO" },
    { name: "field_6", displayName: "DATA EXECUÇÃO AGENDAMENTO" },
  ];
  const result = model.normalizeProvisionReportRow({ id: "41", fields: {
    IDRECORRENCIA: " 7 ", field_1: { Value: "Filial A" }, field_2: { LookupValue: "Alfa" },
    PRODUTO: ["Internet"], OBS: "<em>urgente & mensal</em>", IM_x00d3_VEL: "Sala 1",
    DATA_x0020_PREVISTO_x0020_PGTO: "05/10/2026", DATAPGTOEFETUADO: "2026-10-06T03:00:00Z",
    DATAPGTOAGENDADO: "2026-10-02", field_6: "2026-10-05T03:00:00Z", field_5: true,
    STATUS: { Value: "PAGAMENTO EFETUADO" }, field_3: "R$ 1.234,50", field_4: "2", FRETE: "5,25",
  } }, columns);
  assert.deepEqual(result, {
    id: "41", recurrenceId: "7", branch: "Filial A", supplier: "Alfa", product: "Internet",
    observation: "<em>urgente & mensal</em>", property: "Sala 1", dueDate: "2026-10-05",
    paidDate: "2026-10-06", schedule: "AGENDADO", scheduledDate: "2026-10-02",
    executionDate: "2026-10-05", status: "PAGAMENTO EFETUADO", total: 2474.25,
  });
  const onlyExecution = model.normalizeProvisionReportRow({ fields: { DATAEXECUCAOAGENDAMENTO: "2026-10-09", PGTOAGENDADO: false } });
  assert.equal(onlyExecution.scheduledDate, "");
  assert.equal(onlyExecution.executionDate, "2026-10-09");
  assert.equal(onlyExecution.schedule, "PENDENTE");
});

test("multiplies price by QTD with exact decimals and defaults blank price, QTD and freight to zero", () => {
  assert.equal(typeof model.normalizeProvisionReportRow, "function");
  for (const [fields, total] of [
    [{ VALORTOTAL: "2,30", QTD: "0,05", FRETE: 0 }, 0.115],
    [{ VALORTOTAL: "100", FRETE: "2,50" }, 2.5],
    [{ VALORTOTAL: 100, QTD: "", FRETE: "" }, 0],
    [{ VALORTOTAL: 0, QTD: 3 }, 0],
    [{ VALORTOTAL: "-5,25", QTD: 2, FRETE: 1 }, -9.5],
    [{ VALORTOTAL: "1,234.50", QTD: 2 }, 2469],
    [{ VALORTOTAL: "", QTD: 2, FRETE: 5 }, 5],
    [{ QTD: 2, FRETE: 5 }, 5],
    [{ VALORTOTAL: null, QTD: 2, FRETE: 5 }, 5],
    [{}, 0],
  ]) assert.equal(model.normalizeProvisionReportRow({ fields }).total, total);
});

test("unknown prices and malformed nonblank quantities or freight cannot produce safe totals", () => {
  assert.equal(typeof model.normalizeProvisionReportRow, "function");
  for (const fields of [
    { VALORTOTAL: "não informado", QTD: 1 },
    { VALORTOTAL: 10, QTD: "inválido" }, { VALORTOTAL: 10, QTD: 1, FRETE: "?" },
    { VALORTOTAL: Infinity, QTD: 1 }, { VALORTOTAL: 1e308, QTD: 10 },
  ]) assert.equal(model.normalizeProvisionReportRow({ fields }).total, null);
  const invalidDate = model.normalizeProvisionReportRow({ fields: { DATAPGTOPREVISTO: "31/02/2026" } });
  assert.equal(invalidDate.dueDate, "");
});

test("normalizes recurrence equipment, start date and Modified timestamp without losing time", () => {
  assert.equal(typeof model.normalizeProvisionReportRecurrence, "function");
  const result = model.normalizeProvisionReportRecurrence({ id: "7", fields: {
    FILIAL: "Filial A", FORNECEDOR: { Value: "Alfa" }, EQUIPAMENTO: "Internet", PRODUTO: "não usar",
    IMOVEL: "Sala 1", STATUS: " INATIVO ", DATAINICIO: "12/03/2025", audit: "2026-10-01T09:30:45-03:00",
  } }, [{ name: "audit", displayName: "Modificado" }]);
  assert.deepEqual(result, { id: "7", branch: "Filial A", supplier: "Alfa", product: "Internet", property: "Sala 1",
    status: "INATIVO", startDate: "2025-03-12", modified: "2026-10-01T12:30:45.000Z" });
  assert.equal(model.normalizeProvisionReportRecurrence({ lastModifiedDateTime: "2026-10-02T14:25:00Z" }).modified,
    "2026-10-02T14:25:00.000Z");
  assert.equal(model.normalizeProvisionReportRecurrence({ fields: { Modified: "invalid" } }).modified, "");
});

test("base rows apply all provision filters, sort by due date and define pending by blank paid date", () => {
  const report = build([
    provision(3, { dueDate: "2026-10-10", status: "PENDENTE", total: 0.1 }),
    provision(2, { dueDate: "2026-10-01", status: "PENDENTE", paidDate: "2026-10-02", total: 100 }),
    provision(1, { dueDate: "2026-10-05", status: "PENDENTE", total: 0.2 }),
    provision(4, { branch: "Filial B", status: "PENDENTE" }),
    provision(5, { supplier: "Beta", status: "PENDENTE" }),
    provision(6, { product: "Água", status: "PENDENTE" }), provision(7),
    provision(8, { recurrenceId: "", dueDate: "", status: "PENDENTE", total: 0 }),
  ], [], { branch: " filial a ", supplier: "ALFA", product: "internet", paymentStatus: " pendente ", recurrenceStatus: "INATIVO" });
  assert.deepEqual(report.rows.map(row => row.id), ["2", "1", "3", "8"]);
  assert.equal(report.pendingCount, 3);
  assert.equal(report.pendingTotal, 0.3);
  assert.equal(report.incompleteCount, 0);
});

test("default and ATIVO annual filters keep inactive recurrences with unpaid links anywhere in snapshot", () => {
  const provisions = [
    provision(1, { paidDate: "2026-10-02", status: "PAGO" }),
    provision(2, { recurrenceId: "8", paidDate: "2026-10-02", status: "PAGO" }),
    provision(3, { recurrenceId: "8", branch: "Filial B", supplier: "Beta", product: "Água" }),
    provision(4, { recurrenceId: "9", paidDate: "2026-10-02", status: "PAGO" }),
    provision(5, { recurrenceId: "missing" }), provision(6, { recurrenceId: "" }),
  ];
  const recurrences = [recurrence(7), recurrence(8, { status: " inativo " }), recurrence(9, { status: "INATIVO" })];
  for (const recurrenceStatus of ["", "ATIVO"]) {
    const report = build(provisions, recurrences, { branch: "Filial A", supplier: "Alfa", product: "Internet", paymentStatus: "NÃO EXISTE", recurrenceStatus });
    assert.equal(report.rows.length, 0);
    assert.deepEqual(report.annual.map(group => group.recurrenceId), ["7", "8"]);
    assert.equal(report.annualCount, 2);
    assert.equal(report.annual[0].inactivePending, false);
    assert.equal(report.annual[1].inactivePending, true);
    assert.deepEqual(report.annual[1].months[9].paid.map(row => row.id), ["2"]);
  }
  const inactive = build(provisions, recurrences, { branch: "Filial A", recurrenceStatus: " inativo " });
  assert.deepEqual(inactive.annual.map(group => group.recurrenceId), ["8", "9"]);
  assert.equal(inactive.annual[1].inactivePending, false);
});

test("annual grouping uses recurrence ID plus supplier plus property and counts distinct IDs", () => {
  const report = build([
    provision(1, { dueDate: "2026-09-20" }),
    provision(2, { supplier: "Beta", dueDate: "2026-08-10" }),
    provision(3, { property: "Sala 2", dueDate: "2026-07-15" }),
    provision(4, { recurrenceId: "8", dueDate: "2026-01-01", paidDate: "2026-02-03" }),
    provision(5, { dueDate: "2026-01-01", paidDate: "2026-02-03" }),
  ], [recurrence(7), recurrence(8)]);
  assert.deepEqual(report.annual.map(({ recurrenceId, supplier, property }) => [recurrenceId, supplier, property]), [
    ["7", "Alfa", "Sala 2"], ["7", "Beta", "Sala 1"], ["7", "Alfa", "Sala 1"], ["8", "Alfa", "Sala 1"],
  ]);
  assert.equal(report.annualCount, 2);
  assert.equal(report.annual[2].paidTotal, 10);
});

test("annual months use payment month for paid rows and due month for pending rows across years", () => {
  const report = build([
    provision(1, { dueDate: "2025-01-05", paidDate: "2025-02-07", total: 0.1 }),
    provision(2, { dueDate: "2026-01-05", paidDate: "2026-02-09", total: 0.2 }),
    provision(3, { dueDate: "2026-03-15", status: "PAGO", total: 99 }),
  ], [recurrence(7)], { paymentStatus: "PAGO" });
  const group = report.annual[0];
  assert.deepEqual(group.months.map(cell => cell.month), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(group.months[0].paid, []);
  assert.deepEqual(group.months[1].paid.map(row => row.id), ["1", "2"]);
  assert.deepEqual(group.months[2].pending.map(row => row.id), ["3"]);
  assert.equal(group.paidTotal, 0.3);
  assert.equal(group.startDate, "2025-03-12");
  assert.equal(group.months[2].startDate, "2025-03-12");
  assert.equal(group.months[1].startDate, undefined);
  assert.equal(group.months.some(cell => cell.nextDate), false);
});

test("all-paid next marker uses max due month and the exact add-month then subtract-31-days formula", () => {
  for (const [dueDate, month, nextDate] of [
    ["2026-01-31", 2, "2026-01-28"], ["2024-01-31", 2, "2024-01-29"],
    ["2026-12-15", 1, "2026-12-15"], ["2026-04-30", 5, "2026-04-29"],
  ]) {
    const report = build([
      provision(1, { dueDate: "2023-01-01", paidDate: "2026-11-01" }),
      provision(2, { dueDate, paidDate: "2026-11-02" }),
    ], [recurrence(7)]);
    assert.equal(report.annual[0].months[month - 1].nextDate, nextDate);
    assert.equal(report.annual[0].months.filter(cell => cell.nextDate).length, 1);
  }
  assert.equal(build([provision(1, { dueDate: "", paidDate: "2026-11-01" })], [recurrence(7)])
    .annual[0].months.some(cell => cell.nextDate), false);
});

test("inactive recent includes the 30-day boundary in Sao Paulo and sorts by timestamp", () => {
  const report = build([], [
    recurrence(1, { status: "INATIVO", modified: "2026-09-05T03:00:00Z" }),
    recurrence(2, { status: "INATIVO", modified: "2026-09-05T02:59:59Z" }),
    recurrence(3, { status: "INATIVO", modified: "2026-10-04T15:00:00Z" }),
    recurrence(4, { status: "INATIVO", modified: "2026-10-04T16:00:00Z" }),
    recurrence(5, { status: "INATIVO", modified: "" }),
    recurrence(6, { status: "INATIVO", modified: "invalid" }),
    recurrence(7), recurrence(8, { status: "INATIVO", product: "Água" }),
    recurrence(9, { status: "INATIVO", supplier: "Beta" }),
    recurrence(10, { status: "INATIVO", branch: "Filial B" }),
  ], { branch: "FILIAL A", supplier: "ALFA", product: "INTERNET", paymentStatus: "PAGO", recurrenceStatus: "ATIVO" });
  assert.equal(report.inactiveCount, 6);
  assert.deepEqual(report.inactiveRecent.map(row => row.id), ["4", "3", "1"]);
});

test("incomplete amounts propagate only to the sum containing them and remain countable", () => {
  const provisions = [
    provision(1, { total: null }), provision(2, { total: 5 }),
    provision(3, { total: null, paidDate: "2026-10-01" }),
    provision(4, { total: 0.1, recurrenceId: "8", paidDate: "2026-10-01" }),
    provision(5, { total: 0.2, recurrenceId: "8", paidDate: "2026-10-01" }),
    provision(6, { branch: "Filial B", total: null }),
  ];
  const report = build(provisions, [recurrence(7), recurrence(8)], { branch: "Filial A" });
  assert.equal(report.pendingCount, 2);
  assert.equal(report.pendingTotal, null);
  assert.equal(report.incompleteCount, 2);
  assert.equal(report.annual[0].paidTotal, null);
  assert.equal(report.annual[1].paidTotal, 0.3);
  const paidOnly = build([provision(1, { total: null, paidDate: "2026-10-01" })], [recurrence(7)]);
  assert.equal(paidOnly.pendingTotal, 0);
  assert.equal(paidOnly.pendingCount, 0);
});

test("report handles empty snapshots without mutating frozen input or truncating over 2000 rows", () => {
  const empty = build();
  assert.deepEqual(empty, { rows: [], pendingTotal: 0, pendingCount: 0, annual: [], annualCount: 0,
    inactiveRecent: [], inactiveCount: 0, incompleteCount: 0 });
  assert.deepEqual(model.buildProvisionReport(undefined, {}, "2026-10-05"), empty);
  const provisions = Object.freeze([Object.freeze(provision(2)), Object.freeze(provision(1, { dueDate: "2026-09-01" }))]);
  const recurrences = Object.freeze([Object.freeze(recurrence(7))]);
  assert.deepEqual(build(provisions, recurrences).rows.map(row => row.id), ["1", "2"]);
  assert.deepEqual(provisions.map(row => row.id), ["2", "1"]);
  const many = build(Array.from({ length: 2001 }, (_, index) => provision(index, { total: 1 })), [recurrence(7)]);
  assert.equal(many.pendingCount, 2001);
  assert.equal(many.pendingTotal, 2001);
  assert.equal(many.annual[0].months[9].pending.length, 2001);
});
