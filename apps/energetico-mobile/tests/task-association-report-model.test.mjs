import test from "node:test";
import assert from "node:assert/strict";

const model = await import("../src/chat/task-association-report-model.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const today = "2026-10-06";
const task = (id = 1, extra = {}) => ({ id, createdDate: "2026-10-01", dueDate: "2026-10-07", description: "Revisar projeto",
  association: "ENGENHARIA", status: "ATIVIDADE CRIADA", priority: "NORMAL", difficulty: "MÉDIA", supplier: "José", ...extra });
function normalize(snapshot) {
  assert.equal(typeof model.normalizeTaskAssociationSnapshot, "function", "normalizeTaskAssociationSnapshot must be implemented");
  return model.normalizeTaskAssociationSnapshot(snapshot);
}
function overview(tasks, filters = {}, date = today) {
  assert.equal(typeof model.buildTaskAssociationOverview, "function", "buildTaskAssociationOverview must be implemented");
  return model.buildTaskAssociationOverview({ tasks }, filters, date);
}
const rows = result => result.groups.flatMap(group => group.tasks);
function frozenTree(value) {
  if (!value || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value));
  Object.values(value).forEach(frozenTree);
}

test("normalizes the exact snapshot contract, source calendar days and blanks without mutation", () => {
  const input = { tasks: [task(" 001 ", { createdDate: "01/10/2026", dueDate: "2026-10-07T23:30:00-03:00",
    description: " Revisar projeto ", association: " engenharia ", status: " em atendimento ", supplier: null })] };
  const before = structuredClone(input);
  const result = normalize(input);
  assert.deepEqual(result, { tasks: [task(1, { association: "ENGENHARIA", status: "em atendimento", supplier: "" })] });
  assert.deepEqual(input, before); frozenTree(result);
  assert.equal(normalize({ tasks: [task(2, { createdDate: "1900-01-01", dueDate: "01/01/1900", association: " " })] }).tasks[0].dueDate, "1900-01-01");
  assert.equal(normalize({ tasks: [task(3, { association: null })] }).tasks[0].association, "SEM ASSOCIAÇÃO");
});

test("validates every required field and duplicate ID before filters hide invalid tasks", () => {
  for (const field of Object.keys(task())) {
    const missing = task(2); delete missing[field];
    assert.throws(() => overview([task(), missing], { id: "1" }), /campo|registro/i);
  }
  for (const bad of [null, [], task(0), task(-1), task("1.5"), task(Number.MAX_SAFE_INTEGER + 1), task(2, { supplier: {} }),
    task(2, { priority: [] }), task(2, { description: true }), task(2, { difficulty: Infinity }), task(2, { createdDate: "31/04/2026" })]) {
    assert.throws(() => overview([task(), bad], { id: "1" }), /inválid|campo|registro/i);
  }
  assert.throws(() => overview([task(1), task("01")], { id: "2" }), /duplic/i);
  for (const input of [null, [], {}, { tasks: Array(1) }, ...["partial", "truncated", "aborted", "incomplete", "error", "hasMore", "nextLink"].map(flag => ({ tasks: [], [flag]: true })), { tasks: [], complete: false }]) {
    assert.throws(() => normalize(input), /snapshot|registro/i);
  }
});

test("calendar validation rejects rollover and malformed timestamps while preserving offsets", () => {
  for (const value of ["2026-02-29", "29/02/1900", "2026-04-31", "2026-13-01", "2026-00-01", "2026-10-00", "2026-10-06T24:00:00Z", "2026-10-06T12:99:00Z", "06/10/26", 123]) {
    assert.throws(() => normalize({ tasks: [task(1, { dueDate: value })] }), /data|calendário/i);
  }
  assert.equal(normalize({ tasks: [task(1, { dueDate: "2024-02-29T00:30:00+14:00" })] }).tasks[0].dueDate, "2024-02-29");
  for (const date of [undefined, "06/10/2026", "2026-02-30", "2026-10-06T00:00:00Z"]) {
    assert.throws(() => model.buildTaskAssociationOverview({ tasks: [] }, {}, date), /data|ISO|calendário/i);
  }
});

test("metrics cover the complete base over 2000 rows independently of default or explicit filters", () => {
  const base = Array.from({ length: 2105 }, (_, i) => task(i + 1, { status: i < 2100 ? " atividade criada " : i < 2103 ? " em atendimento " : " concluído " }));
  assert.deepEqual(overview(base, { id: "2105" }).metrics, { pending: 2103, completed: 2, total: 2105 });
  assert.equal(rows(overview(base)).length, 2103);
  assert.equal(rows(overview(base, { statuses: [] })).length, 2105);
  assert.equal(rows(overview(base, { statuses: ["CoNcLuÍdO"] })).length, 2);
  assert.equal(rows(overview([task(1, { status: "CONCLUIDO" })], { statuses: ["CONCLUÍDO"] })).length, 0);
});

test("description substring and all exact filters combine with AND and preserve accents", () => {
  const base = [task(1), task(2, { description: "projeto diferente", supplier: "Jose" }), task(3, { difficulty: "MÉDIA EXTRA" }),
    task(4, { priority: "NORMAL EXTRA" }), task(5, { dueDate: "2026-10-08" }), task(6, { status: "EM ATENDIMENTO" })];
  const filters = { description: "PROJ", id: "01", supplier: "JOSÉ", difficulty: "média", priority: "normal", dueDate: "07/10/2026", statuses: ["atividade criada"] };
  assert.deepEqual(rows(overview(base, filters)).map(row => row.id), [1]);
  assert.deepEqual(rows(overview(base, { supplier: "Jose" })).map(row => row.id), [2]);
  assert.equal(rows(overview(base, { description: "projetox" })).length, 0);
  assert.equal(rows(overview(base, { dueDate: "2026-10-07T23:30:00-03:00" })).length, 5);
});

test("invalid filters never silently widen the report", () => {
  for (const filters of [null, [], { statuses: "CONCLUÍDO" }, { statuses: null }, { statuses: [null] }, { statuses: [1] },
    { statuses: Array(1) }, { id: "bad" }, { dueDate: "2026-02-30" }, { supplier: {} }]) {
    assert.throws(() => overview([task()], filters), /filtro|status|campo|ID|data|calendário/i);
  }
});

test("filter options come from the whole base with numeric ascending string IDs", () => {
  const result = overview([task(10, { status: "CONCLUÍDO", supplier: "Outro" }), task(2), task(1, { supplier: "" })], { id: "2" });
  assert.deepEqual(result.filterOptions, { id: ["1", "2", "10"], supplier: ["José", "Outro"], difficulty: ["MÉDIA"], priority: ["NORMAL"], status: ["ATIVIDADE CRIADA", "CONCLUÍDO"] });
  frozenTree(result);
});

test("groups sort by emergency count then Portuguese association and rows by priority, due date and ID", () => {
  const base = [task(10, { association: "ZETA", priority: "ATIVIDADE EMERGENCIAL", dueDate: "" }),
    task(4, { association: " zeta ", priority: "atividade emergencial", dueDate: "2026-10-07" }),
    task(2, { association: "ZETA", priority: "ATIVIDADE EMERGENCIAL", dueDate: "2026-10-07" }),
    task(1, { association: "ZETA", priority: "ATIVIDADE PRIORITÁRIA", dueDate: "2026-01-01" }),
    task(3, { association: "ZETA", dueDate: "1900-01-01", status: "CONCLUÍDO" }),
    task(11, { association: "ÁREA" }), task(12, { association: "BETA" }), task(13, { association: "" })];
  const result = overview(base, { statuses: [] });
  assert.deepEqual(result.groups.map(group => group.association), ["ZETA", "ÁREA", "BETA", "SEM ASSOCIAÇÃO"]);
  assert.deepEqual(result.groups[0].tasks.map(row => row.id), [2, 4, 10, 1, 3]);
  assert.deepEqual([result.groups[0].total, result.groups[0].pending, result.groups[0].emergencyCount], [5, 4, 3]);
});

test("association colors match all source departments and unknown fallback", () => {
  const expected = [["FINANCEIRO E TRIBUTÁRIO", "#C62828"], ["ENGENHARIA", "#1565C0"], ["SUPRIMENTOS", "#6A1B9A"],
    ["RH, QSMS E DOCUMENTAL", "#E65100"], ["PLANEJAMENTO", "#2E7D32"], ["COMERCIAL E MARKETING", "#9E9D24"],
    ["DEMANDAS PESSOAIS", "#4E342E"], ["ETAPA OBRA E MEDIÇÃO DE CONTRATOS", "#00838F"], ["ESTOQUE / INVENTÁRIO", "#4527A0"],
    ["REBOCO E REPAROS SUPERFÍCIE", "#AD1457"], ["LOCAÇÃO E GABARITO OBRA", "#283593"], ["TI E ANÁLISE DE DADOS", "#0277BD"], ["COMPLIANCE", "#880E4F"], ["SEM ASSOCIAÇÃO", "#455A64"]];
  for (const [association, color] of expected) assert.equal(overview([task(1, { association })]).groups[0].color, color);
});

test("derived dates, labels, row colors and priority colors follow source precedence", () => {
  const cases = [
    ["2026-10-05", "ATIVIDADE CRIADA", "ATIVIDADE EMERGENCIAL", -1, "1 DIA VENCIDA", "#C62828", "#FFCDD2", "#B71C1C", 1],
    ["2026-10-04", "EM ATENDIMENTO", "ATIVIDADE PRIORITÁRIA", -2, "2 DIAS VENCIDA", "#C62828", "#FFE0B2", "#E65100", 2],
    [today, "ATIVIDADE CRIADA", "NORMAL", 0, "VENCE HOJE", "#EF6C00", "#FFFFFF", "#000000", 3],
    ["2026-10-07", "ATIVIDADE CRIADA", "NORMAL", 1, "FALTAM 1 DIA", "#2E7D32", "#FFFFFF", "#000000", 3],
    ["2026-10-08", "ATIVIDADE CRIADA", "NORMAL", 2, "FALTAM 2 DIAS", "#2E7D32", "#FFFFFF", "#000000", 3],
    ["", "ATIVIDADE CRIADA", "NORMAL", null, "SEM DATA FATAL", "#607D8B", "#FFFFFF", "#000000", 3],
    ["2026-10-05", " concluído ", "atividade emergencial", -1, "1 DIA VENCIDA", "#2E7D32", "#C8E6C9", "#B71C1C", 1],
    ["", "CONCLUÍDO", "ATIVIDADE PRIORITÁRIA", null, "SEM DATA FATAL", "#2E7D32", "#C8E6C9", "#E65100", 2],
  ];
  for (const [dueDate, status, priority, daysToDue, dueLabel, dueColor, rowColor, priorityColor, priorityRank] of cases) {
    const row = rows(overview([task(1, { dueDate, status, priority })], { statuses: [] }))[0];
    assert.deepEqual([row.createdDays, row.daysToDue, row.dueLabel, row.dueColor, row.rowColor, row.priorityColor, row.priorityRank, row.completed],
      [5, daysToDue, dueLabel, dueColor, rowColor, priorityColor, priorityRank, status.trim().toUpperCase() === "CONCLUÍDO"]);
  }
  assert.equal(rows(overview([task(1, { createdDate: "", dueDate: "1900-01-01" })]))[0].createdDays, null);
  assert.ok(rows(overview([task(1, { dueDate: "1900-01-01" })]))[0].daysToDue < -40000);
  assert.equal(rows(overview([task(1, { createdDate: "2026-10-07" })]))[0].createdDays, -1);
});

test("overview leaves source and filters untouched and supports a fully frozen empty result", () => {
  const base = [task(2), task(1)]; const filters = { statuses: [] }; const before = structuredClone({ base, filters });
  frozenTree(overview(base, filters)); assert.deepEqual({ base, filters }, before);
  const empty = overview([]);
  assert.deepEqual(empty, { metrics: { pending: 0, completed: 0, total: 0 }, filterOptions: { id: [], supplier: [], difficulty: [], priority: [], status: [] }, groups: [] });
  frozenTree(empty);
});
