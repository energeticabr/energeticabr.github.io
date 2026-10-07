import test from "node:test";
import assert from "node:assert/strict";

const model = await import("../src/chat/delegated-deadline-report-model.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
function normalize(snapshot) {
  assert.equal(typeof model.normalizeDelegatedDeadlineSnapshot, "function", "normalizeDelegatedDeadlineSnapshot must be implemented");
  return model.normalizeDelegatedDeadlineSnapshot(snapshot);
}
function overview(snapshot, filters = {}, today = "2026-10-07") {
  assert.equal(typeof model.buildDelegatedDeadlineOverview, "function", "buildDelegatedDeadlineOverview must be implemented");
  return model.buildDelegatedDeadlineOverview(snapshot, filters, today);
}
const task = (id, values = {}) => ({ id, createdDate: "2026-10-01", dueDate: "2026-10-07", description: "Revisar projeto",
  association: "Engenharia", responsible: "ANA", status: "ATIVIDADE CRIADA", priority: "", difficulty: "MÉDIA", ...values });
const ids = result => result.groups.flatMap(group => group.responsibles.flatMap(person => person.tasks.map(row => row.id)));

test("normalizes the calendar and exact labels into an immutable independent snapshot", () => {
  const source = { tasks: [task("0042", { createdDate: "2026-10-01T23:30:00-03:00", dueDate: "07/10/2026",
    description: " <img src=x onerror='alert(1)'> & \"projeto\" ", association: " Engenharia ", responsible: "  josé ",
    status: " concluído ", priority: " atividade prioritária ", difficulty: " Alta " })] };
  const result = normalize(source);
  assert.deepEqual(result, { tasks: [{ id: 42, createdDate: "2026-10-01", dueDate: "2026-10-07",
    description: "<img src=x onerror='alert(1)'> & \"projeto\"", association: "Engenharia", responsible: "JOSÉ",
    status: "CONCLUÍDO", priority: "ATIVIDADE PRIORITÁRIA", difficulty: "Alta", createdSort: Date.UTC(2026, 9, 2, 2, 30) }] });
  for (const value of [result, result.tasks, result.tasks[0]]) assert.ok(Object.isFrozen(value));
  assert.throws(() => { result.tasks[0].status = "CANCELADO"; }, TypeError);
  source.tasks[0].description = "changed";
  assert.equal(result.tasks[0].description, "<img src=x onerror='alert(1)'> & \"projeto\"");
});

test("blank dates are null, blank responsible has its source fallback, and 1900 is a real deadline", () => {
  const result = normalize({ tasks: [task(1, { createdDate: " ", dueDate: null, description: null, association: "",
    responsible: null, status: "", priority: null, difficulty: undefined }), task(2, { dueDate: "1900-01-01", status: "CANCELADO" })] });
  assert.deepEqual(result.tasks[0], { id: 1, createdDate: null, dueDate: null, description: "", association: "",
    responsible: "SEM RESPONSÁVEL", status: "", priority: "", difficulty: "" });
  assert.equal(result.tasks[1].dueDate, "1900-01-01");
  assert.equal(result.tasks[1].status, "CANCELADO");
  const old = overview({ tasks: [result.tasks[1]] }, { statuses: [] }).groups[0];
  assert.equal(old.dueDate, "1900-01-01"); assert.equal(old.daysToDue, -46300);
});

test("rejects malformed or incomplete snapshots before filters can hide their rows", () => {
  for (const bad of [null, [], {}, { tasks: {} }, { tasks: Array(1) },
    ...["partial", "incomplete", "error", "truncated", "aborted", "hasMore"].map(flag => ({ tasks: [], [flag]: true })),
    { tasks: [], complete: false }, { tasks: [], nextLink: "next" }]) {
    assert.throws(() => normalize(bad), /snapshot|registro|incomplet/i);
  }
  for (const field of Object.keys(task(1))) {
    const row = task(1); delete row[field];
    assert.throws(() => normalize({ tasks: [row] }), /campo|registro|incomplet/i);
  }
  assert.throws(() => overview({ tasks: [task(1), task(2, { dueDate: "2026-02-30", status: "CANCELADO" })] }), /data/i);
});

test("rejects invalid IDs, duplicate normalized IDs and malformed scalar fields", () => {
  for (const id of [0, -1, 1.5, "1e2", "", true, null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => normalize({ tasks: [task(id)] }), /ID/i);
  }
  assert.throws(() => normalize({ tasks: [task(1), task("01")] }), /duplic/i);
  for (const field of ["description", "association", "responsible", "status", "priority", "difficulty"]) {
    for (const value of [{ Value: "A" }, [], true, Infinity]) {
      assert.throws(() => normalize({ tasks: [task(1, { [field]: value })] }), /campo/i);
    }
  }
});

test("rejects impossible dates and accepts leap days without converting calendar timezone", () => {
  for (const date of ["2026-02-29", "2026-02-30", "31/04/2026", "1900-02-29", "2026-13-01", "2026-10-07T24:00:00Z",
    "2026-10-07T10:60:00Z", "2026-10-07junk", "07-10-2026", 0, new Date()]) {
    for (const field of ["createdDate", "dueDate"]) assert.throws(() => normalize({ tasks: [task(1, { [field]: date })] }), /data/i);
  }
  assert.equal(normalize({ tasks: [task(1, { dueDate: "2024-02-29T00:30:00+14:00" })] }).tasks[0].dueDate, "2024-02-29");
  for (const today of [undefined, "2026-02-30", "07/10/2026", "2026-10-07T00:00:00Z"]) {
    assert.throws(() => model.buildDelegatedDeadlineOverview({ tasks: [] }, {}, today), /data|ISO/i);
  }
});

test("global metrics include unknown and blank statuses while default detail shows only pending", () => {
  const source = { tasks: [task(1, { status: " atividade criada " }), task(2, { status: "em atendimento" }),
    task(3, { status: " concluído " }), task(4, { status: "CANCELADO" }), task(5, { status: "" }), task(6, { status: "CONCLUIDO" })] };
  const result = overview(source);
  assert.deepEqual(result.metrics, { total: 6, pending: 2, completed: 1 });
  assert.deepEqual(ids(result), [1, 2]);
  assert.equal(result.filteredCount, 2); assert.equal(result.displayedCount, 2); assert.equal(result.limited, false);
  assert.equal(overview(source, { statuses: [] }).displayedCount, 6);
  assert.deepEqual(ids(overview(source, { statuses: [" concluído "] })), [3]);
});

test("filter options use the complete base even if no detail matches", () => {
  const source = { tasks: [task(1), task(2, { association: "Comercial", difficulty: "ALTA", priority: "ATIVIDADE PRIORITÁRIA", status: "CONCLUÍDO" }),
    task(3, { association: "", difficulty: "", priority: "ATIVIDADE EMERGENCIAL", status: "CANCELADO" })] };
  const result = overview(source, { description: "missing" });
  assert.deepEqual(result.filterOptions, { associations: ["Comercial", "Engenharia"], difficulties: ["ALTA", "MÉDIA"],
    priorities: ["ATIVIDADE EMERGENCIAL", "ATIVIDADE PRIORITÁRIA"], statuses: ["ATIVIDADE CRIADA", "CANCELADO", "CONCLUÍDO"] });
  assert.deepEqual(result.metrics, { total: 3, pending: 1, completed: 1 });
  assert.deepEqual(result.groups, []); assert.equal(result.filteredCount, 0);
});

test("combines description search and exact filters without folding source accents", () => {
  const source = { tasks: [task(1, { description: "AÇÃO no pátio", priority: "ATIVIDADE PRIORITÁRIA" }),
    task(2, { description: "Ação no pátio", association: "Engenharia civil", priority: "ATIVIDADE PRIORITÁRIA" }),
    task(3, { description: "Revisão", priority: "ATIVIDADE PRIORITÁRIA" }), task(4, { description: "Ação no pátio" })] };
  assert.deepEqual(ids(overview(source, { description: " ação ", association: " engenharia ", difficulty: " média ", priority: " atividade prioritária " })), [1]);
  assert.deepEqual(ids(overview(source, { description: "acao" })), []);
  assert.deepEqual(ids(overview(source, { difficulty: "MEDIA" })), []);
  for (const filters of [null, [], { statuses: null }, { statuses: "CONCLUÍDO" }, { statuses: [""] }, { statuses: Array(1) },
    { association: {} }, { description: [] }, { difficulty: true }, { priority: Infinity }]) {
    assert.throws(() => overview(source, filters), /filtro|status|campo/i);
  }
});

test("detail filters before newest-created sorting and the 2000 limit while totals stay global", () => {
  const source = { tasks: Array.from({ length: 2105 }, (_, i) => task(i + 1, {
    createdDate: i < 5 ? "2026-09-01" : "2026-10-01", description: i === 0 ? "unique older task" : "routine",
  })) };
  source.tasks.push(task(2106, { status: "CONCLUÍDO" }), task(2107, { status: "CANCELADO" }));
  const result = overview(source);
  assert.deepEqual(result.metrics, { total: 2107, pending: 2105, completed: 1 });
  assert.equal(result.filteredCount, 2105); assert.equal(result.displayedCount, 2000); assert.equal(result.limited, true);
  assert.equal(ids(result).length, 2000); assert.equal(ids(result).includes(1), false); assert.equal(ids(result)[0], 6);
  const filtered = overview(source, { description: "unique" });
  assert.deepEqual(ids(filtered), [1]); assert.equal(filtered.filteredCount, 1); assert.equal(filtered.limited, false);
  assert.deepEqual(filtered.metrics, result.metrics);
  assert.equal(overview({ tasks: source.tasks.slice(5, 2005) }).limited, false);
});

test("groups dates ascending with null last and responsible ascending with newest tasks first", () => {
  const source = { tasks: [task(1, { dueDate: null }), task(2, { dueDate: "2026-10-08", responsible: "Bia" }),
    task(3, { dueDate: "2026-10-06", responsible: "ZÉ" }), task(4, { dueDate: "2026-10-08", responsible: " ana ", createdDate: "2026-10-02" }),
    task(5, { dueDate: "2026-10-08", responsible: "ANA", createdDate: "2026-10-05T23:00:00-03:00" }),
    task(6, { dueDate: "2026-10-08", responsible: "ANA", createdDate: null })] };
  const original = structuredClone(source);
  const result = overview(source);
  assert.deepEqual(result.groups.map(group => group.dueDate), ["2026-10-06", "2026-10-08", null]);
  assert.deepEqual(result.groups[1].responsibles.map(person => person.responsible), ["ANA", "BIA"]);
  assert.deepEqual(result.groups[1].responsibles[0].tasks.map(row => row.id), [5, 4, 6]);
  assert.equal(result.groups[1].total, 4); assert.equal(result.groups[1].pending, 4);
  assert.deepEqual(source, original);
});

test("same-day ordering preserves the original datetime instant through repeated normalization", () => {
  const snapshot = normalize({ tasks: [task(1, { createdDate: "2026-10-07T08:00:00Z" }),
    task(2, { createdDate: "2026-10-07T10:00:00Z" }), task(3, { createdDate: "2026-10-07T09:30:00-03:00" }),
    task(4, { createdDate: "2026-10-07" }), task(5, { createdDate: "2026-10-07T11:00:00" })] });
  const again = normalize(snapshot);
  assert.equal(again.tasks[2].createdSort, Date.UTC(2026, 9, 7, 12, 30));
  assert.ok(again.tasks.every(row => row.createdDate === "2026-10-07"));
  assert.deepEqual(ids(overview(again)), [3, 5, 2, 1, 4]);
  assert.deepEqual(again, snapshot);
});

test("FirstN cutoff keeps newer same-day timestamps even when they arrive last in the full base", () => {
  const source = { tasks: Array.from({ length: 2000 }, (_, i) => task(i + 1, { createdDate: "2026-10-07T08:00:00Z" })) };
  source.tasks.push(task(2001, { createdDate: "2026-10-07T18:00:00Z" }));
  const snapshot = normalize(source);
  const result = overview(snapshot);
  const shown = ids(result);
  assert.equal(shown[0], 2001); assert.equal(shown.includes(2000), false);
  assert.equal(result.filteredCount, 2001); assert.equal(result.displayedCount, 2000); assert.equal(result.limited, true);
  assert.deepEqual(result.metrics, { total: 2001, pending: 2001, completed: 0 });
});

test("invalid optional createdSort values reject rather than corrupt ordering", () => {
  for (const createdSort of [null, "2026-10-07T12:00:00Z", NaN, Infinity, {}, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => normalize({ tasks: [task(1, { createdSort })] }), /data|ordena|campo/i);
  }
  assert.throws(() => normalize({ tasks: [task(1, { createdDate: null, createdSort: Date.UTC(2026, 9, 7) })] }), /data|ordena|campo/i);
});

test("deadline labels and colors follow pending status and calendar days from the source formula", () => {
  const cases = [
    [null, "ATIVIDADE CRIADA", null, "SEM PRAZO DEFINIDO", "#ECEFF1", "#607D8B"],
    ["2026-10-05", "ATIVIDADE CRIADA", -2, "2 DIAS EM ATRASO", "#FFCDD2", "#C62828"],
    ["2026-10-06", "EM ATENDIMENTO", -1, "1 DIA EM ATRASO", "#FFCDD2", "#C62828"],
    ["2026-10-06", "CONCLUÍDO", -1, "TODAS AS ATIVIDADES CONCLUÍDAS", "#C8E6C9", "#2E7D32"],
    ["2026-10-06", "CANCELADO", -1, "TODAS AS ATIVIDADES CONCLUÍDAS", "#C8E6C9", "#2E7D32"],
    ["2026-10-07", "CONCLUÍDO", 0, "VENCE HOJE", "#FFE0B2", "#EF6C00"],
    ["2026-10-08", "ATIVIDADE CRIADA", 1, "1 DIA PARA O PRAZO", "#C8E6C9", "#2E7D32"],
    ["2026-10-09", "ATIVIDADE CRIADA", 2, "2 DIAS PARA O PRAZO", "#C8E6C9", "#2E7D32"],
  ];
  for (const [dueDate, status, daysToDue, dueLabel, color, borderColor] of cases) {
    const group = overview({ tasks: [task(1, { dueDate, status })] }, { statuses: [] }).groups[0];
    assert.deepEqual({ dueDate: group.dueDate, daysToDue: group.daysToDue, dueLabel: group.dueLabel, color: group.color, borderColor: group.borderColor },
      { dueDate, daysToDue, dueLabel, color, borderColor });
  }
  const source = { tasks: [task(1, { dueDate: "2026-10-06" }), task(2, { dueDate: "2026-10-06", status: "CONCLUÍDO" })] };
  assert.equal(overview(source, { statuses: [] }).groups[0].color, "#FFCDD2");
  assert.equal(overview(source, { statuses: ["CONCLUÍDO"] }).groups[0].color, "#C8E6C9");
  assert.equal(overview(source, { statuses: ["CONCLUÍDO"] }).metrics.pending, 1);
});

test("responsible cells consider only unfinished priorities and rows let completed override priority", () => {
  const source = { tasks: [task(1, { responsible: "ANA", status: "CONCLUÍDO", priority: "ATIVIDADE EMERGENCIAL" }),
    task(2, { responsible: "BIA", status: "CONCLUÍDO", priority: "ATIVIDADE EMERGENCIAL" }), task(3, { responsible: "BIA" }),
    task(4, { responsible: "CAIO", priority: "ATIVIDADE PRIORITÁRIA" }), task(5, { responsible: "CAIO", priority: "ATIVIDADE EMERGENCIAL", status: "CANCELADO" }),
    task(6, { responsible: "DANI", priority: "ATIVIDADE PRIORITÁRIA" }), task(7, { responsible: "DANI", status: "CONCLUÍDO", priority: "ATIVIDADE EMERGENCIAL" }),
    task(8, { responsible: "" })] };
  const result = overview(source, { statuses: [] });
  const persons = result.groups[0].responsibles;
  assert.deepEqual(persons.map(person => [person.responsible, person.color]), [
    ["ANA", "#C8E6C9"], ["BIA", "#F5F5F5"], ["CAIO", "#FFCDD2"], ["DANI", "#FFE0B2"], ["SEM RESPONSÁVEL", "#F5F5F5"],
  ]);
  assert.deepEqual(persons.flatMap(person => person.tasks.map(row => [row.id, row.rowColor])), [
    [1, "#C8E6C9"], [2, "#C8E6C9"], [3, "#FFFFFF"], [4, "#FFE0B2"], [5, "#FFCDD2"], [6, "#FFE0B2"], [7, "#C8E6C9"], [8, "#FFFFFF"],
  ]);
});

test("overview deeply freezes every exposed collection and preserves literal escaped-looking strings", () => {
  const result = overview({ tasks: [task(1, { description: "<script>x</script>&amp;", responsible: "<b>ana</b>" })] });
  function frozen(value) {
    if (!value || typeof value !== "object") return;
    assert.ok(Object.isFrozen(value));
    for (const nested of Object.values(value)) frozen(nested);
  }
  frozen(result);
  assert.equal(result.groups[0].responsibles[0].tasks[0].description, "<script>x</script>&amp;");
  assert.equal(result.groups[0].responsibles[0].responsible, "<B>ANA</B>");
  assert.deepEqual(overview({ tasks: [] }).metrics, { total: 0, pending: 0, completed: 0 });
});
