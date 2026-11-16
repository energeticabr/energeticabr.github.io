import test from "node:test";
import assert from "node:assert/strict";

const model = await import("../src/chat/attendance-summary-model.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const build = (...args) => {
  assert.equal(typeof model.buildAttendanceSummary, "function", "buildAttendanceSummary must be implemented");
  return model.buildAttendanceSummary(...args);
};
const row = (id, overrides = {}) => ({ id: String(id), date: "2026-10-03", branch: "B",
  supplier: "Ana", profession: "PEDREIRO", presence: "PRESENTE", status: "PENDENTE PGTO",
  paymentId: "", dailyValue: 10, ...overrides });
const snapshot = (presences, suppliers = [{ id: "1", name: "Ana", status: "ATIVO" }]) =>
  ({ complete: true, presences, suppliers });
const open = { startDate: "", endDate: "", status: "TODOS" };

test("attendance counts ignore payment status, daily values and payment links", () => {
  const result = build(snapshot([
    row(1, { dailyValue: 0.1 }), row(2, { dailyValue: 0.2, status: " pago ", paymentId: "91" }),
    row(3, { presence: "PENDENTE", dailyValue: 20 }),
    row(4, { presence: "PENDENTE", dailyValue: 30, status: "PAGO" }),
    row(5, { supplier: "Bia", profession: "PINTOR", presence: "AUSENTE", dailyValue: 999 }),
    row(6, { presence: "OUTRO", dailyValue: 999 }),
  ]), open);
  assert.deepEqual(result.summary, { pending: 2, present: 2, absent: 1 });
  assert.deepEqual(result.rows.map(item => item.id), ["5", "4", "3", "2", "1"]);  assert.deepEqual(result.days, [{ date: "2026-10-03", weekday: "Sábado", weekend: true,
    branches: [{ branch: "B", pending: [{ name: "Ana", count: 2 }],
      present: [{ name: "Ana", count: 2 }], absent: [{ name: "Bia", count: 1 }],
      professions: [{ name: "PEDREIRO", emoji: "🧱", count: 1 }] }] }]);
});

test("supplier registry defaults to active and conflicts or unknown status never grant eligibility", () => {
  const suppliers = [{ name: "Ana", status: " ativo " }, { name: "ANA", status: "ATIVO" },
    { name: "Bia", status: "INATIVO" }, { name: "Cris", status: "ATIVO" },
    { name: " CRIS ", status: "INATIVO" }, { name: "Dora", status: "" },
    { name: "Eva", status: "ATIVO" }, { name: "Eva", status: "NOVO" }];
  const source = snapshot(["Ana", "Bia", "Cris", "Dora", "Eva", "Unknown"].map((supplier, i) => row(i + 1, { supplier })), suppliers);
  const dates = { startDate: "", endDate: "" };
  assert.deepEqual(build(source, dates).rows.map(item => item.supplier), ["Ana"]);
  assert.deepEqual(build(source, { ...dates, status: "INATIVO" }).rows.map(item => item.supplier), ["Bia"]);
  assert.equal(build(source, { ...dates, status: "TODOS" }).rows.length, 6);
  assert.equal(build(source, { ...dates, status: "DESCONHECIDO" }).rows.length, 4);
});

test("UI supplierStatus filters override the RH status alias, including cleared status", () => {
  const source = snapshot([row(1), row(2, { supplier: "Bia" })],
    [{ name: "Ana", status: "ATIVO" }, { name: "Bia", status: "INATIVO" }]);
  assert.deepEqual(build(source, { ...open, status: "ATIVO", supplierStatus: "INATIVO" }).rows.map(item => item.supplier), ["Bia"]);
  assert.equal(build(source, { ...open, status: "ATIVO", supplierStatus: "" }).rows.length, 2);
});

test("date and branch details descend by date, sort branches and count distinct present professionals", () => {
  const result = build(snapshot([row(1, { branch: "Z", date: "2026-10-04", status: "PAGO" }),
    row(2, { branch: "A", date: "2026-10-04", supplier: "Bia" }), row(3),
    row(4, { date: "2026-10-05" })]), open);
  assert.deepEqual(result.days.map(day => [day.date, day.weekday, day.weekend]), [
    ["2026-10-05", "Segunda", false], ["2026-10-04", "Domingo", true], ["2026-10-03", "Sábado", true]]);
  assert.deepEqual(result.days[1].branches.map(branch => branch.branch), ["A", "Z"]);
  assert.deepEqual(result.days[1].branches[1].present[0], { name: "Ana", count: 1 });
});

test("open-ended dates and combined normalized filters work; invalid and reversed dates reject", () => {
  const source = snapshot([row(1, { date: "2026-09-01" }), row(2), row(3, { date: "2026-10-05" })]);
  assert.equal(build(source, { startDate: "", endDate: "03/10/2026", status: "ATIVO", branch: " b ", supplier: "ANA", presence: " presente " }).rows.length, 2);
  assert.equal(build(source, { startDate: "2026-10-03", endDate: "" }).rows.length, 2);
  for (const filters of [{ startDate: "31/02/2026" }, { endDate: "nonsense" },
    { startDate: "2026-10-05", endDate: "2026-10-03" }]) {
    assert.throws(() => build(source, filters), /data|período/i);
  }
});

test("initial dates include today minus fourteen days through today", () => {
  const now = new Date();
  const date = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 14);
  const previous = new Date(cutoff); previous.setDate(previous.getDate() - 1);
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  assert.deepEqual(build(snapshot([row(1, { date: date(previous) }), row(2, { date: date(cutoff) }),
    row(3, { date: date(now) }), row(4, { date: date(tomorrow) })])).rows.map(item => item.id), ["3", "2"]);
});

test("partial snapshots, malformed source rows and duplicate IDs cannot display totals", () => {
  for (const source of [{}, { ...snapshot([]), complete: false }, { ...snapshot([]), error: new Error("failed") },
    { ...snapshot([]), partial: true }, { ...snapshot([]), aborted: true }, { ...snapshot([]), truncated: true },
    snapshot([row(1), row(1)]), snapshot([row(1, { date: "2026-02-31" })]),
    snapshot([row(1, { presence: null })])]) {
    assert.throws(() => build(source, open), /complet|inválid|duplicad/i);
  }
});

test("current assignments form equally colored individual cards across professions without depending on attendance", () => {
  const suppliers = [
    { id: "1", name: "Ana", status: "ATIVO", branch: "B", profession: "ARMADOR", stage: "35", activity: "ARMAÇÃO DE VIGAS" },
    { id: "2", name: "Bia", status: "ATIVO", branch: "B", profession: "PEDREIRO", stage: "35", activity: "armação de vigas " },
    { id: "3", name: "Cris", status: "ATIVO", branch: "B", profession: "PEDREIRO", stage: "35", activity: "CONCRETAGEM" },
    { id: "4", name: "Eva", status: "ATIVO", branch: "Z", profession: "PINTOR", stage: "36", activity: "CONCRETAGEM" },
    { id: "5", name: "Dora", status: "ATIVO", branch: "B", profession: "PEDREIRO", stage: "35" },
    { id: "6", name: "Comércio de materiais", status: "ATIVO", branch: "B" },
  ];
  const result = build({ ...snapshot([row(1, { status: "PAGO", paymentId: "125", dailyValue: 100 })], suppliers),
    stages: [{ id: "35", stage: "ALVENARIA", property: "TORRE A" }] },
    { ...open, branch: "B", startDate: "2026-10-04", presence: "AUSENTE" });
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.professions.map(({name, providers}) => [name, providers.map(p => p.name)]),
    [["PEDREIRO", ["Bia", "Cris", "Dora"]], ["ARMADOR", ["Ana"]]]);
  const [bia, cris, dora] = result.professions[0].providers;
  const [ana] = result.professions[1].providers;
  assert.match(ana.stageLabel, /35.*ALVENARIA.*TORRE A/);
  assert.equal(ana.assignmentHue, bia.assignmentHue);
  assert.notEqual(ana.assignmentHue, cris.assignmentHue);
  assert.equal(dora.assignmentHue, null);
});
