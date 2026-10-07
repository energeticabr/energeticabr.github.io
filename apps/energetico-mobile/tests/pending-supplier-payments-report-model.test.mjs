import test from "node:test";
import assert from "node:assert/strict";

const module = await import("../src/chat/pending-supplier-payments-report-model.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const build = (snapshot, filters = {}, today = "2026-10-07") => {
  assert.equal(typeof module.buildPendingSupplierPaymentsReport, "function", "report model must be implemented");
  return module.buildPendingSupplierPaymentsReport(snapshot, filters, today);
};
const supplier = (overrides = {}) => ({ id: "1", name: "Ana", branch: "A", status: "ATIVO", contractor: true,
  dailyValue: 100, hours: 8, paymentMethod: "DIÁRIA", paymentType: "DIÁRIA", property: "Casa", profession: "PEDREIRO",
  stage: "Etapa", activity: "Obra", measurement: "", ...overrides });
const presence = (id, overrides = {}) => ({ id: String(id), date: "2026-10-03", branch: "A", supplier: "Ana",
  profession: "PEDREIRO", property: "Casa", stage: "Etapa", presence: "PRESENTE", status: "PENDENTE PGTO",
  dailyValue: 100, activity: "Obra", motivation: "", observation: "", paymentId: "",
  entry1: "08:00", exit1: "12:00", entry2: "13:00", exit2: "17:00", ...overrides });
const launch = (id, overrides = {}) => ({ id: String(id), date: "2026-10-03", branch: "A", supplier: "Ana",
  unitValue: 100, quantity: 1, total: 100, advance: "NÃO", ...overrides });
const snapshot = (presences = [], suppliers = [supplier()], launches = []) => ({ complete: true, suppliers, presences, launches });

// Break: using general validation for the pending block inflates backlog by paid validation rows.
test("pending block separates unpaid validation from general historical validation", () => {
  const report = build(snapshot([presence(1, { date: "2026-08-01", dailyValue: 100 }),
    presence(2, { presence: "PENDENTE", dailyValue: 30 }),
    presence(3, { presence: "PENDENTE", status: "PAGO", dailyValue: 20 }),
    presence(4, { presence: "AUSENTE", dailyValue: null, status: "PENDENTE PGTO" })]));
  const row = report.pending[0];
  assert.equal(row.pendingCount, 3);
  assert.equal(row.approvedValue, 100);
  assert.equal(row.pendingValidationValue, 30);
  assert.equal(row.pendingTotalValue, 130);
  assert.equal(row.validationValue, 50);
  assert.equal(row.totalValue, 150);
  assert.equal(report.approvedTotal, 100);
  assert.equal(report.validationTotal, 30);
  assert.equal(report.total, 130);
});

// Break: applying detail period/presence filters to pending rows hides old debts.
test("default month and active filters affect detail while historical backlog remains", () => {
  const report = build(snapshot([presence(1, { date: "2026-09-01" }), presence(2),
    presence(3, { date: "2026-10-08" }), presence(4, { supplier: "Inativa" })],
  [supplier(), supplier({ id: "2", name: "Inativa", status: "INATIVO" })]), { presence: "AUSENTE" });
  assert.equal(report.pending.length, 1);
  assert.equal(report.pending[0].pendingCount, 3);
  assert.equal(report.details.length, 0);
  assert.equal(build(snapshot([presence(1, { date: "2026-09-01" }), presence(2), presence(3, { date: "2026-10-08" })])).details[0].occurrences, 1);
});

test("explicit open dates and status aliases select inclusive detail boundaries", () => {
  const data = snapshot([presence(1, { date: "2026-09-30", supplier: "Inativa" }),
    presence(2, { date: "2026-10-01", supplier: "Inativa" }), presence(3, { date: "2026-10-07", supplier: "Inativa" }),
    presence(4, { date: "2026-10-08", supplier: "Inativa" })], [supplier({ name: "Inativa", status: "INATIVO" })]);
  assert.equal(build(data, { status: "INATIVO", startDate: "01/10/2026", endDate: "07/10/2026" }).details[0].occurrences, 2);
  assert.equal(build(data, { supplierStatus: "TODOS", startDate: null, endDate: "" }).details[0].occurrences, 4);
  assert.equal(build(data, { supplierStatus: "INATIVO", branch: "B" }).pending.length, 0);
  assert.throws(() => build(data, { startDate: "2026-02-30" }), /data/i);
  assert.throws(() => build(data, { startDate: "2026-10-08", endDate: "2026-10-01" }), /período/i);
});

// Break: summing with floats produces 0.30000000000000004; blank money falsely becomes zero.
test("decimal sums preserve cents and unknown required amounts propagate null", () => {
  assert.equal(build(snapshot([presence(1, { dailyValue: 0.1 }), presence(2, { dailyValue: 0.2 })])).total, 0.3);
  for (const dailyValue of [null, undefined, "", "garbage", NaN, Infinity]) {
    const report = build(snapshot([presence(1, { dailyValue })]));
    assert.equal(report.approvedTotal, null);
    assert.equal(report.total, null);
    assert.equal(report.pending[0].timelineRows[0].valueIncomplete, true);
  }
  const blank = build(snapshot([presence(1, { dailyValue: null })])).pending[0].timelineRows[0];
  assert.equal(blank.isMeasurement, true);
  assert.equal(build(snapshot([presence(1, { dailyValue: 0 })])).total, 0);
});

// Break: treating a missing shift as unknown or accepting inverted populated times hides the warning.
test("hours add available shifts, default expected hours and flag populated invalid times", () => {
  const rows = build(snapshot([presence(1, { entry2: "", exit2: "" }), presence(2, { exit1: "07:00" }),
    presence(3, { entry1: "25:00" }), presence(4, { entry1: "", exit1: "12:00" }),
    presence(5, { dailyValue: 99 })], [supplier({ hours: 0 })])).pending[0].timelineRows;
  assert.deepEqual(rows.map(row => row.workedHours), [4, null, null, 4, 8]);
  assert.equal(rows[0].expectedHours, 8);
  assert.equal(rows[0].hasDiscrepancy, true);
  assert.match(rows[1].hoursWarning, /hor/i);
  assert.equal(rows[4].hasDiscrepancy, true);
});

test("blank and zero measurement equivalence does not introduce a daily amount discrepancy", () => {
  for (const [dailyValue, registered] of [[null, 0], [0, null], [null, null], [0, 0]]) {
    const row = build(snapshot([presence(1, { dailyValue })], [supplier({ dailyValue: registered })])).pending[0].timelineRows[0];
    assert.equal(row.hasDiscrepancy, false);
  }
});

// Break: off-by-one absence cutoff or filtering unpaid absences out of timeline.
test("timeline includes 14-day boundary absences and every unpaid date in ascending order", () => {
  const rows = build(snapshot([presence(1, { date: "2026-08-01" }),
    presence(2, { date: "2026-09-22", presence: "AUSENTE", status: "PAGO" }),
    presence(3, { date: "2026-09-23", presence: "AUSENTE", status: "PAGO" }),
    presence(4, { date: "2026-09-24", presence: "AUSENTE", status: "PAGO" })])).pending[0].timelineRows;
  assert.deepEqual(rows.map(row => row.id), ["1", "3", "4"]);
});

// Break: collecting links from presence-filtered rows drops formula's payments in other names.
test("distinct linked payments use all period presences even when presence-filtered, outside payment period", () => {
  const report = build(snapshot([presence(1, { paymentId: "0009", presence: "PENDENTE" }),
    presence(2, { paymentId: "9", presence: "PENDENTE" }), presence(3)], [supplier()],
  [launch(9, { supplier: "Outro", date: "2026-08-01", unitValue: 0.1, quantity: 0.2, total: 0.020000000000000004 }),
    launch(10, { date: "2026-10-03", advance: "SIM" }), launch(11, { date: "2026-09-01" })]), { presence: "PRESENTE" });
  assert.equal(report.details[0].occurrences, 1);
  assert.deepEqual(report.details[0].payments.map(row => row.id), ["10"]);
  assert.deepEqual(report.details[0].linkedElsewhere.map(row => row.id), ["9"]);
  assert.equal(report.details[0].linkedElsewhere[0].total, 0.02);
});

test("pending sorts by approved value, detail by occurrence count, without input mutation", () => {
  const data = snapshot([presence(1), presence(2, { supplier: "Bia", dailyValue: 60 }),
    presence(3, { supplier: "Bia", dailyValue: 60 })], [supplier(), supplier({ id: "2", name: "Bia" })]);
  const before = structuredClone(data);
  const result = build(data);
  assert.deepEqual(result.pending.map(row => row.name), ["Bia", "Ana"]);
  assert.deepEqual(result.details.map(row => row.occurrences), [2, 1]);
  assert.deepEqual(data, before);
});

// Break: selecting branch first lets an ambiguous name acquire another registry's historical debt.
test("distinct supplier identities with the same name fail closed before filters", () => {
  for (const overrides of [{ branch: "B" }, { dailyValue: 200 }, { paymentMethod: "MEDIÇÃO" }, { hours: 6 }, { status: "INATIVO" }]) {
    assert.throws(() => build(snapshot([presence(1)], [supplier(), supplier({ id: "2", ...overrides })]), { branch: "A" }), /fornecedor.*amb|amb.*fornecedor/i);
  }
  const equivalent = build(snapshot([presence(1)], [supplier(), supplier({ id: "2" })]));
  assert.equal(equivalent.pending.length, 1);
  assert.equal(equivalent.total, 100);
});

test("partial snapshots, duplicate ids, invalid rows and ambiguous links cannot return totals", () => {
  for (const change of [{ complete: false }, { partial: true }, { error: "failure" }, { launches: null }]) {
    assert.throws(() => build({ ...snapshot(), ...change }), /snapshot|complet/i);
  }
  for (const data of [snapshot([presence(1), presence(1)]), snapshot([presence(1, { date: "2026-02-30" })]),
    snapshot([presence(1, { presence: "??" })]), snapshot([presence(1, { paymentId: "9,10" })]),
    snapshot([], [supplier()], [launch(1), launch(1)])]) assert.throws(() => build(data), /inválid|duplicad|amb/i);
});

test("complete histories beyond 2000 rows are counted and summed without truncation", () => {
  const report = build(snapshot(Array.from({ length: 2105 }, (_, i) => presence(i + 1, { dailyValue: 0.1 }))));
  assert.equal(report.pending[0].pendingCount, 2105);
  assert.equal(report.pending[0].timelineRows.length, 2105);
  assert.equal(report.details[0].occurrences, 2105);
  assert.equal(report.total, 210.5);
});

// Break: an omitted contractor field silently removes a registry and returns a false zero.
test("missing contractor identity is rejected rather than silently excluding a supplier", () => {
  assert.throws(() => build(snapshot([presence(1)], [supplier({ contractor: undefined })])), /registro|cadastro|inválid/i);
});

// Break: rounding the supplier hours before comparison or accepting malformed hours as the default.
test("discrepancy compares rounded hours while malformed registered hours remain explicit", () => {
  const complete = build(snapshot([presence(1)], [supplier({ hours: 8.004 })])).pending[0].timelineRows[0];
  assert.equal(complete.hasDiscrepancy, false);
  const invalid = build(snapshot([presence(1)], [supplier({ hours: null, hoursInvalid: true })])).pending[0].timelineRows[0];
  assert.equal(invalid.expectedHours, null);
  assert.match(invalid.hoursWarning, /hor/i);
});

// Break: validating irrelevant registry blanks prevents a valid contractor report from opening.
test("ordinary suppliers with blank identity fields do not block contractor financial rows", () => {
  const report = build(snapshot([presence(1)], [supplier(),
    supplier({ id: "2", name: "Loja", contractor: false, branch: "", status: "" }),
    supplier({ id: "3", name: "Loja", contractor: false, branch: "B", status: "INATIVO" }),
    supplier({ id: "4", name: "", contractor: false, branch: "", status: "" })]));
  assert.equal(report.pending.length, 1);
  assert.equal(report.total, 100);
  assert.throws(() => build(snapshot([presence(1)], [supplier({ branch: "" })])), /inválid/i);
  assert.throws(() => build(snapshot([presence(1)], [supplier(), supplier({ id: "2", contractor: false })])), /amb/i);
});

// Break: discarding a launch with no payer name drops the only linked payment evidence.
test("unnamed launch remains linked financial evidence with an explicit incomplete payer warning", () => {
  const report = build(snapshot([presence(1, { paymentId: "9" })], [supplier()],
    [launch(9, { supplier: "", branch: "", date: "2026-08-01" }), launch(10, { supplier: "", branch: "" })]));
  assert.equal(report.total, 100);
  assert.deepEqual(report.details[0].linkedElsewhere.map(row => row.id), ["9"]);
  assert.equal(report.details[0].linkedElsewhere[0].payerIncomplete, true);
  assert.ok(report.warnings.some(message => /9/.test(message) && /fornecedor|nome/i.test(message)));
});

// Break: rendering a valid case-insensitive choice as raw text can label an absence as money.
test("detail and timeline expose canonical presence choices while retaining source text immutably", () => {
  const data = snapshot([presence(1, { presence: " ausente ", status: " pendente pgto " })]);
  const result = build(data);
  assert.equal(result.pending[0].timelineRows[0].presence, "AUSENTE");
  assert.equal(result.details[0].presenceRows[0].presence, "AUSENTE");
  assert.equal(result.details[0].presenceRows[0].status, "PENDENTE PGTO");
  assert.equal(data.presences[0].presence, " ausente ");
});

// Review regression: deleted/renamed unpaid identities cannot yield a false zero.
test("unmatched unpaid supplier identities warn and invalidate overall totals before filters", () => {
  const data=snapshot([presence(1),presence(2,{supplier:"Deleted contractor"}),
    presence(3,{supplier:"Loja"}),presence(4,{supplier:"Historic payer",status:"PAGO"})],
    [supplier(),supplier({id:"2",name:"Loja",contractor:false})]);
  for(const filters of [{},{supplier:"Ana",branch:"A"},{supplier:"None",branch:"B"}]) {
    const result=build(data,filters);
    assert.equal(result.approvedTotal,null);
    assert.equal(result.validationTotal,null);
    assert.equal(result.total,null);
    assert.equal(result.unresolvedUnpaidCount,1);
    assert.ok(result.warnings.some(w=>/Deleted contractor/.test(w)&&/cadastro|fornecedor/i.test(w)));
    assert.ok(!result.warnings.some(w=>/Loja|Historic payer/.test(w)));
  }
  const known=build(snapshot([presence(1,{supplier:"Loja"})],[supplier({name:"Loja",contractor:false})]));
  assert.equal(known.total,0); assert.equal(known.unresolvedUnpaidCount,0);
});
