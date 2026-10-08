import test from "node:test";
import assert from "node:assert/strict";

const api = await import("../src/chat/supplier-workforce-report-model.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const today = "2026-10-07";
const supplier = (id = 1, changes = {}) => ({ id: String(id), name: "Ana", branch: "A", property: "Casa",
  profession: "PEDREIRO", status: "ATIVO", contractor: true, paymentMethod: "DIÁRIA", dailyValue: 100,
  dailyValueBlank: false, stage: "122", activity: "Alvenaria", measurement: "0,5 m²", ...changes });
const presence = (id = 1, changes = {}) => ({ id: String(id), date: "2026-10-07", branch: "A", property: "Obra",
  supplier: "Ana", stage: "122", presence: "PRESENTE", ...changes });
const snapshot = (suppliers = [supplier()], presences = [presence()], changes = {}) => ({ complete: true,
  suppliers, presences, warnings: [], ...changes });
const build = (data, filters = {}) => {
  assert.equal(typeof api.buildSupplierWorkforceReport, "function", "workforce report model must be implemented");
  return api.buildSupplierWorkforceReport(data, filters, today);
};
const rows = report => report.branches.flatMap(branch => branch.properties.flatMap(property =>
  property.professions.flatMap(profession => profession.suppliers)));

// Break: adopting the payments report's month-start default hides earlier workforce history.
test("defaults keep start blank, end today and registry status ATIVO", () => {
  assert.equal(typeof api.defaultSupplierWorkforceFilters, "function", "workforce defaults must be implemented");
  assert.deepEqual(api.defaultSupplierWorkforceFilters(today), { startDate: "", endDate: today,
    branch: "", property: "", supplier: "", supplierStatus: "ATIVO", stage: "" });
  const report = build(snapshot([supplier()], [presence(1, { date: "2026-08-10" })]));
  assert.equal(rows(report)[0].firstDate, "2026-08-10");
  assert.equal(report.filters.startDate, "");
  assert.equal(report.filters.endDate, today);
});

// Break: including a boundary's neighbor or excluding either date boundary alters attendance.
test("inclusive date bounds constrain the full frequency base and require a matching presence", () => {
  const report = build(snapshot([supplier(), supplier(2, { name: "Bia" })], [
    presence(1, { date: "2026-09-06" }), presence(2, { date: "2026-09-07", presence: "AUSENTE" }),
    presence(3, { date: "2026-09-08", presence: "PENDENTE" }), presence(4),
    presence(5, { date: "2026-10-08" }), presence(6, { supplier: "Bia", date: "2026-09-06" }),
  ]), { startDate: "2026-09-07", endDate: today });
  assert.deepEqual(rows(report).map(row => row.name), ["Ana"]);
  assert.equal(rows(report)[0].firstDate, "2026-09-07");
  assert.equal(rows(report)[0].lastPresentDate, today);
  assert.equal(rows(report)[0].activeDays, 30);
  assert.deepEqual(rows(report)[0].frequency30, { present: 1, total: 3, percent: 33.3 });
  assert.deepEqual(rows(report)[0].frequencyHistory, { present: 1, total: 3, percent: 33.3 });
});

// Break: imposing registry property/stage or matching-presence requirements without dates contradicts PowerFx.
test("without dates property and stage filter frequencies but keep unmatched registry suppliers", () => {
  const report = build(snapshot([supplier(), supplier(2, { name: "Bia", property: "Other" })], [presence()]),
    { startDate: "", endDate: "", property: "Missing", stage: "999" });
  assert.deepEqual(rows(report).map(row => row.name), ["Ana", "Bia"]);
  for (const row of rows(report)) {
    assert.equal(row.firstDate, "");
    assert.equal(row.activeDays, null);
    assert.deepEqual(row.frequencyHistory, { present: 0, total: 0, percent: 0 });
  }
  assert.ok(report.warnings.some(message => /sem.*data/i.test(message) && /imóvel|etapa/i.test(message)));
});

test("presence property and stage select history while grouping uses registry branch property profession", () => {
  const report = build(snapshot([supplier()], [presence(), presence(2, { property: "Other" }),
    presence(3, { stage: "999" }), presence(4, { branch: "B" })]), { property: "Obra", stage: "122", branch: "A" });
  assert.equal(report.branches[0].branch, "A");
  assert.equal(report.branches[0].properties[0].property, "Casa");
  assert.equal(report.branches[0].properties[0].professions[0].profession, "PEDREIRO");
  assert.deepEqual(rows(report)[0].frequencyHistory, { present: 1, total: 1, percent: 100 });
});

test("only SIM contractors and matching registry status branch supplier qualify", () => {
  const suppliers = [supplier(), supplier(2, { name: "Bia", contractor: "SIM", status: "INATIVO" }),
    supplier(3, { name: "Caio", contractor: "NÃO" }), supplier(4, { name: "Dora", branch: "B" })];
  const data = snapshot(suppliers, []);
  assert.deepEqual(rows(build(data, { endDate: "", branch: "A" })).map(row => row.name), ["Ana"]);
  assert.deepEqual(rows(build(data, { endDate: "", supplierStatus: "inativo", supplier: "bia" })).map(row => row.name), ["Bia"]);
  assert.equal(rows(build(data, { endDate: "", supplierStatus: "", branch: "A" })).length, 2);
});

// Break: using only PRESENTE to find firstDate or stopping inactive tenure at today misstates tenure.
test("first date includes absences, inactive tenure stops at last PRESENTE and no present stays unknown", () => {
  const report = build(snapshot([supplier(1, { status: "INATIVO" }), supplier(2, { name: "Bia", status: "INATIVO" })], [
    presence(1, { date: "2026-09-06", presence: "AUSENTE" }),
    presence(2, { date: "2026-09-08" }), presence(3, { date: "2026-10-01", presence: "PENDENTE" }),
    presence(4, { supplier: "Bia", date: "2026-09-06", presence: "AUSENTE" }),
  ]), { supplierStatus: "INATIVO" });
  const [ana, bia] = rows(report);
  assert.equal(ana.firstDate, "2026-09-06");
  assert.equal(ana.lastPresentDate, "2026-09-08");
  assert.equal(ana.activeDays, 2);
  assert.equal(bia.lastPresentDate, "");
  assert.equal(bia.activeDays, null);
});

test("30-day cutoff includes today-minus-30 and all statuses, with no implicit upper date bound", () => {
  const report = build(snapshot([supplier()], [presence(1, { date: "2026-09-06" }),
    presence(2, { date: "2026-09-07", presence: "AUSENTE" }), presence(3, { presence: "PENDENTE" }),
    presence(4, { date: "2026-10-08" })]), { endDate: "" });
  assert.equal(rows(report)[0].activeDays, 31);
  assert.deepEqual(rows(report)[0].frequency30, { present: 1, total: 3, percent: 33.3 });
  assert.deepEqual(rows(report)[0].frequencyHistory, { present: 2, total: 4, percent: 50 });
});

test("blank and other scalar presence statuses count in frequency denominators", () => {
  const row = rows(build(snapshot([supplier()], [presence(), presence(2, { presence: "JUSTIFICADO" }),
    presence(3, { presence: "" })])))[0];
  assert.deepEqual(row.frequency30, { present: 1, total: 3, percent: 33.3 });
  assert.deepEqual(row.frequencyHistory, { present: 1, total: 3, percent: 33.3 });
});

// Break: FirstN(2000), or counting unique days instead of rows, truncates the literal denominator.
test("history counts all rows beyond 2000 including multiple occurrences on one day", () => {
  const history = Array.from({ length: 2101 }, (_, i) => presence(i + 1, { presence: i < 2100 ? "PRESENTE" : "AUSENTE" }));
  const row = rows(build(snapshot([supplier()], history)))[0];
  assert.deepEqual(row.frequencyHistory, { present: 2100, total: 2101, percent: 100 });
  assert.equal(row.frequency30.total, 2101);
});

test("property and profession summaries use exact decimal daily sums and payment category counts", () => {
  const suppliers = [supplier(1, { dailyValue: 0.1 }), supplier(2, { name: "Bia", dailyValue: 0.2 }),
    supplier(3, { name: "Caio", paymentMethod: "MEDIÇÃO", dailyValue: null, dailyValueBlank: true, measurement: "" }),
    supplier(4, { name: "Dora", paymentMethod: "VALOR GLOBAL", dailyValue: null, dailyValueBlank: true })];
  const report = build(snapshot(suppliers, []), { endDate: "" });
  const expected = { count: 4, dailyCount: 2, measurementCount: 1, globalCount: 1, dailyTotal: 0.3 };
  assert.deepEqual(report.branches[0].properties[0].summary, expected);
  assert.deepEqual(report.branches[0].properties[0].professions[0].summary, expected);
  assert.equal(rows(report).find(row => row.name === "Caio").measurement, "");
});

test("explicit blank daily values coalesce to zero with warning, malformed or unknown values poison totals", () => {
  const blank = build(snapshot([supplier(1, { dailyValue: null, dailyValueBlank: true })], []), { endDate: "" });
  assert.equal(blank.branches[0].properties[0].summary.dailyTotal, 0);
  assert.equal(rows(blank)[0].dailyValue, null);
  assert.ok(blank.warnings.some(message => /diári/i.test(message) && /preencher|branco/i.test(message)));
  for (const dailyValue of [null, NaN, Infinity, "junk 20", Number.MAX_SAFE_INTEGER + 1]) {
    const report = build(snapshot([supplier(1, { dailyValue, dailyValueBlank: false })], []), { endDate: "" });
    assert.equal(report.branches[0].properties[0].summary.dailyTotal, null);
    assert.equal(report.branches[0].properties[0].professions[0].summary.dailyTotal, null);
    assert.ok(report.warnings.some(message => /valor|diári/i.test(message)));
  }
});

test("groups sort in Portuguese and supplier payment order has stable numeric ID ties", () => {
  const suppliers = [supplier(10, { name: "Dez" }), supplier(2, { name: "Dois" }),
    supplier(4, { name: "Medição", paymentMethod: "MEDIÇÃO" }),
    supplier(6, { name: "Z", branch: "Z", property: "Z", profession: "Z" }),
    supplier(7, { name: "A", property: "A", profession: "Z" }),
    supplier(8, { name: "B", property: "A", profession: "A" })];
  const report = build(snapshot(suppliers, []), { endDate: "" });
  assert.deepEqual(report.branches.map(branch => branch.branch), ["A", "Z"]);
  assert.deepEqual(report.branches[0].properties.map(property => property.property), ["A", "Casa"]);
  assert.deepEqual(report.branches[0].properties[0].professions.map(profession => profession.profession), ["A", "Z"]);
  assert.deepEqual(report.branches[0].properties[1].professions[0].suppliers.map(row => row.id), ["2", "10", "4"]);
  assert.deepEqual(rows(build(snapshot(suppliers.reverse(), []), { endDate: "" })).map(row => row.id), rows(report).map(row => row.id));
});

test("incomplete snapshots, invalid dates, duplicate IDs and ambiguous identities fail closed before filtering", () => {
  for (const changes of [{ complete: false }, { partial: true }, { error: "denied" }, { aborted: true },
    { truncated: true }, { presences: null }]) assert.throws(() => build(snapshot(undefined, undefined, changes)), /completo|snapshot/i);
  for (const filters of [{ startDate: "2026-02-30" }, { endDate: "oops" }, { startDate: "2026-10-08", endDate: today }]) {
    assert.throws(() => build(snapshot(), filters), /data|período/i);
  }
  assert.throws(() => build(snapshot([supplier()], [presence(1, { date: "2026-02-30" })])), /data|registro/i);
  assert.throws(() => build(snapshot([supplier(), supplier()], []), { endDate: "" }), /duplicad/i);
  assert.throws(() => build(snapshot([supplier()], [presence(), presence()])), /duplicad/i);
  assert.throws(() => build(snapshot([supplier(), supplier(2, { name: "ana", branch: "B", status: "INATIVO" })], []),
    { endDate: "", branch: "A" }), /ambígu|identidade/i);
});

test("orphan presence identities are warned and cannot invent registry groups or affect known frequencies", () => {
  const report = build(snapshot([supplier()], [presence(), presence(2, { supplier: "Unknown" })]));
  assert.equal(rows(report).length, 1);
  assert.deepEqual(rows(report)[0].frequencyHistory, { present: 1, total: 1, percent: 100 });
  assert.ok(report.warnings.some(message => /Unknown/.test(message) && /cadastro|identidade/i.test(message)));
});

test("legacy payment and unrelated financial fields have no effect on the workforce report", () => {
  const expected = build(snapshot());
  const actual = build(snapshot([supplier()], [presence(1, { paymentId: "3362, 3361", dailyValue: "bad", status: "??", entry1: "bad" })],
    { launches: [{ id: "invalid", total: NaN }] }));
  assert.deepEqual(actual, expected);
});
