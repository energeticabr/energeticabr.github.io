import test from "node:test";
import assert from "node:assert/strict";

const module = await import("../src/chat/stage-progress-model.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const build = (...args) => {
  assert.equal(typeof module.buildStageProgress, "function", "buildStageProgress must be implemented");
  return module.buildStageProgress(...args);
};
const activity = (id, overrides = {}) => ({ id: String(id), branch: "A", stage: "Fundação",
  activity: "Concreto", property: "Casa", supplier: "João", executionDate: "2026-10-01",
  plannedDate: "2026-10-03", status: "ATIVIDADE INICIADA", ...overrides });
const launch = (id, overrides = {}) => ({ id: String(id), branch: "A", stage: "Fundação",
  startDate: "2026-09-30", endDate: "", status: "INICIADO", percent: 40, ...overrides });
const source = (activities = [activity(1)], launches = [launch(7)]) => ({ complete: true, activities, launches });

test("branch-safe latest launch uses start date then greatest ID, without implicit status defaults", () => {
  const snapshot = source([activity(2), activity(1, { executionDate: "2026-09-30" }),
    activity(3, { branch: "B", status: "ATIVIDADE FINALIZADA" })], [
    launch(7), launch(10, { status: "FINALIZADO", startDate: "2026-10-01", endDate: "2026-10-03", percent: 80 }),
    launch(12, { status: "FINALIZADO", startDate: "2026-10-01", endDate: "2026-10-04", percent: 100 }),
    launch(99, { branch: "B", startDate: "2026-10-05", percent: 90 }),
  ]);
  const report = build(snapshot, {}, "2026-10-05");
  assert.deepEqual(report.stages.map(row => [row.branch, row.status, row.percent, row.days]),
    [["B", "INICIADO", 90, 0], ["A", "FINALIZADO", 100, 3]]);
  assert.deepEqual(report.stages[1].rows.map(row => row.id), ["1", "2"]);
  assert.deepEqual(report.stages[1].launches.map(row => row.id), ["12", "10", "7"]);
  assert.equal(report.count, 3);
  assert.equal(build(snapshot, { branch: "A", launchStatus: "INICIADO" }, "2026-10-05").stages[0].days, 5);
});

test("all six explicit filters apply with accent and case folding", () => {
  const snapshot = source([activity(1), activity(2, { supplier: "Ana", status: "ATIVIDADE FINALIZADA" }),
    activity(3, { branch: "B" }), activity(4, { stage: "Pintura", activity: "Tinta" })],
  [launch(7), launch(8, { branch: "B", status: "FINALIZADO" }), launch(9, { stage: "Pintura" })]);
  const filtered = build(snapshot, { branch: "a", supplier: "JOAO", stage: "fundacao",
    launchStatus: "iniciado", activity: "concreto", status: "atividade iniciada" }, "2026-10-05");
  assert.deepEqual(filtered.stages.map(row => [row.branch, row.stage, row.rows.map(item => item.id)]),
    [["A", "Fundação", ["1"]]]);
  assert.equal(filtered.count, 1);
  assert.equal(build(snapshot, { launchStatus: "NÃO INICIADO" }).stages.length, 0);
});

test("zero-activity cards retain existing visible-branch and explicit branch/stage behavior", () => {
  const snapshot = source([activity(1)], [launch(7), launch(8, { stage: "Limpeza", startDate: "2026-10-02" }),
    launch(9, { branch: "B", stage: "Limpeza" })]);
  assert.deepEqual(build(snapshot, {}, "2026-10-05").stages.map(row => [row.stage, row.rows.length]),
    [["Limpeza", 0], ["Fundação", 1]]);
  assert.equal(build(source([], [launch(7)]), { branch: "A" }).stages[0].rows.length, 0);
  assert.equal(build(source([], [launch(7)]), { stage: "Fundação" }).stages.length, 1);
  for (const filters of [{ supplier: "João" }, { activity: "Concreto" }, { status: "ATIVIDADE INICIADA" }]) {
    assert.deepEqual(build(snapshot, filters).stages.map(row => row.stage), ["Fundação"]);
  }
});

test("valid dates normalize without timezone shifts and source rows are not mutated", () => {
  const snapshot = source([activity(1, { executionDate: "01/10/2026", plannedDate: "2026-10-03T23:00:00-03:00" })],
    [launch(7, { startDate: "2026-09-30T23:00:00-03:00" })]);
  const before = structuredClone(snapshot);
  const stage = build(snapshot, {}, "05/10/2026").stages[0];
  assert.equal(stage.startDate, "2026-09-30");
  assert.equal(stage.days, 5);
  assert.equal(stage.rows[0].executionDate, "2026-10-01");
  assert.equal(stage.rows[0].plannedDate, "2026-10-03");
  assert.deepEqual(snapshot, before);
});

test("blank dates and missing percent remain unknown; explicit percent zero remains zero", () => {
  const stage = build(source([activity(1, { executionDate: "", plannedDate: null })],
    [launch(7, { startDate: "", endDate: null, percent: undefined })]), {}, "2026-10-05").stages[0];
  assert.equal(stage.startDate, ""); assert.equal(stage.endDate, "");
  assert.equal(stage.days, null); assert.equal(stage.percent, null);
  assert.equal(stage.rows[0].plannedDate, "");
  assert.equal(build(source([], [launch(7, { percent: 0 })]), { branch: "A" }).stages[0].percent, 0);
  assert.equal(build(source([], [launch(7, { status: "FINALIZADO", endDate: "" })]),
    { branch: "A" }, "2026-10-05").stages[0].days, null);
});

test("incomplete or failed snapshots never become reports with partial counts", () => {
  for (const snapshot of [null, {}, { ...source(), complete: false }, { ...source(), activities: null },
    { ...source(), launches: {} }, ...["error", "partial", "truncated", "aborted"].map(name => ({ ...source(), [name]: true }))]) {
    assert.throws(() => build(snapshot), /snapshot|completo/i);
  }
});

test("invalid shape or duplicate IDs reject even records hidden by filters", () => {
  for (const invalid of [null, [], activity("bad"), activity(0), activity(1, { branch: {} }), activity(1, { supplier: [] }),
    activity(1, { status: undefined }), activity(1, { stage: 42 })]) {
    assert.throws(() => build(source([invalid]), { branch: "absent" }), /registro|ID/i);
  }
  assert.throws(() => build(source([activity(1), activity(1)])), /duplicad/i);
  assert.throws(() => build(source([], [launch(7), launch(7)])), /duplicad/i);
  for (const percent of [NaN, Infinity, -1, 101, "40"]) {
    assert.throws(() => build(source([], [launch(7, { percent })]), { branch: "A" }), /percent|registro/i);
  }
});

test("impossible or malformed dates cannot invent elapsed durations", () => {
  for (const date of ["2026-02-30", "31/04/2026", "garbage", "2026-10-01junk", "2026-13-01", 123,
    "2026-10-01T99:00:00Z"]) {
    assert.throws(() => build(source([], [launch(7, { startDate: date })]), { branch: "A" }), /data/i);
    assert.throws(() => build(source([activity(1, { plannedDate: date })])), /data/i);
  }
  assert.throws(() => build(source(), {}, "2026-02-30"), /data/i);
  assert.throws(() => build(source(), {}, ""), /data/i);
});

test("empty complete snapshot produces an empty report", () => {
  assert.deepEqual(build(source([], []), {}, "2026-10-05"), { stages: [], count: 0 });
});
