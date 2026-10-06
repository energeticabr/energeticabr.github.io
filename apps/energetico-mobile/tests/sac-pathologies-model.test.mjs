import test from "node:test";
import assert from "node:assert/strict";

const module = await import("../src/chat/sac-pathologies-model.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
function build(snapshot, filters = {}, today = "2026-10-05") {
  assert.equal(typeof module.buildSacPathologies, "function", "buildSacPathologies must be implemented");
  return module.buildSacPathologies(snapshot, filters, today);
}
const row = (id = 1, extra = {}) => ({ id: String(id), branch: "A", property: "Casa", client: "Ana",
  type: "Infiltração", status: "ATIVO", description: "Parede úmida", startDate: "2026-10-01", endDate: "", cost: 10, ...extra });
const snapshot = rows => ({ complete: true, rows });

// Catches treating every non-active status as inactive, or imposing the UI default in the model.
test("all statuses contribute to totals but only ATIVO and INATIVO contribute to their counts", () => {
  const result = build(snapshot([row(), row(2, { status: " inativo ", cost: 20 }), row(3, { status: " ativo ", cost: null }),
    row(4, { status: "AGUARDANDO", cost: -2 }), row(5, { status: "", cost: 0 })]));
  assert.deepEqual([result.total, result.active, result.inactive, result.costTotal], [5, 2, 1, 28]);
  const byId = new Map(result.rows.map(value => [value.id, value]));
  assert.equal(byId.get("1").statusLabel, "ATIVO"); assert.equal(byId.get("1").statusTone, "green");
  assert.equal(byId.get("2").statusLabel, "INATIVO"); assert.equal(byId.get("2").statusTone, "red");
  assert.equal(byId.get("4").statusLabel, "AGUARDANDO"); assert.equal(byId.get("4").statusTone, "red");
  assert.equal(byId.get("5").statusLabel, "SEM STATUS"); assert.equal(byId.get("5").statusTone, "red");
});

test("100-row display cap never caps counters cost or filter options", () => {
  const rows = Array.from({ length: 105 }, (_, i) => row(i + 1, { cost: 0.1, status: i < 102 ? "ATIVO" : "INATIVO",
    branch: i === 0 ? "Só na linha oculta" : "A" }));
  const result = build(snapshot(rows));
  assert.equal(result.rows.length, 100); assert.equal(result.rows[0].id, "105"); assert.equal(result.rows[99].id, "6");
  assert.deepEqual([result.total, result.active, result.inactive, result.costTotal], [105, 102, 3, 10.5]);
  assert.ok(result.filterOptions.branch.includes("Só na linha oculta"));
});

// An OR, a contains match, or omission of any of the six fields changes these outputs.
test("all six filters use exact AND matching and options always come from the whole source", () => {
  const fields = ["id", "branch", "property", "client", "type", "status"];
  const values = { id: "10", branch: "A", property: "Casa", client: "Ana", type: "Infiltração", status: "ATIVO" };
  const rows = [row(10), ...fields.map((field, i) => row(20 + i, { [field]: field === "id" ? "30" : "Outro" }))];
  const source = snapshot(rows);
  assert.deepEqual(build(source, values).rows.map(value => value.id), ["10"]);
  for (const field of fields) {
    assert.equal(build(source, { ...values, [field]: field === "id" ? "99" : "Inexistente" }).total, 0, field);
    assert.equal(build(source, { [field]: values[field] }).total, field === "id" ? 1 : 6, field);
  }
  assert.equal(build(source, { ...values, id: "0010", client: " ana " }).total, 1);
  assert.equal(build(source, { client: "An" }).total, 0);
  assert.deepEqual(build(source, { status: "ATIVO" }).filterOptions, build(source).filterOptions);
  assert.deepEqual(build(source).filterOptions.id, ["10", "21", "22", "23", "24", "25", "30"]);
  assert.equal(build(source, { id: "", branch: "", status: "" }).total, 7);
});

test("date order uses calendar chronology with blank last and numeric ID descending ties", () => {
  const result = build(snapshot([row(2, { startDate: "2026-09-30" }), row(10, { startDate: "2026-09-30" }),
    row(3, { startDate: "2026-10-01" }), row(99, { startDate: "" }), row(9, { startDate: "2025-12-31" })]));
  assert.deepEqual(result.rows.map(value => value.id), ["3", "10", "2", "9", "99"]);
});

test("elapsed days include leap day and preserve future starts and end-before-start negatives", () => {
  for (const [startDate, endDate, today, want] of [["2024-02-28", "2024-03-01", "2026-10-05", 2],
    ["2026-10-01", "", "2026-10-05", 4], ["2026-10-07", "", "2026-10-05", -2],
    ["2026-10-05", "2026-10-01", "2026-10-05", -4], ["", "2026-10-01", "2026-10-05", null]]) {
    const result = build(snapshot([row(1, { startDate, endDate })]), {}, today).rows[0];
    assert.equal(result.elapsedDays, want);
    assert.equal(result.endLabel, endDate ? endDate.split("-").reverse().join("/") : "EM ANDAMENTO");
    assert.equal(result.typeLabelUpper, "INFILTRAÇÃO");
  }
  assert.equal(build(snapshot([row(1, { type: "" })])).rows[0].typeLabelUpper, "SEM TIPO");
});

test("pt-BR money blank cost and decimal addition preserve real amounts", () => {
  assert.equal(build(snapshot([row(1, { cost: "R$ 1.234,50" }), row(2, { cost: "" }),
    row(3, { cost: "-34,50" }), row(4, { cost: "0,10" }), row(5, { cost: 0.2 })])).costTotal, 1200.3);
  assert.equal(build(snapshot([])).costTotal, 0);
  for (const cost of ["ISENTO", "12abc", true, Infinity, NaN, {}, [1]]) {
    assert.throws(() => build(snapshot([row(1, { cost })]), { id: "999" }), /valor|monet|inválid/i);
  }
  assert.throws(() => build(snapshot([row(1, { cost: 1e308 }), row(2, { cost: 1e308 })])), /total|monet/i);
});

test("calendar normalization preserves source day without concealing impossible dates", () => {
  const result = build(snapshot([row(1, { startDate: "29/02/2024", endDate: "2024-03-01T23:30:00-03:00" })]));
  assert.equal(result.rows[0].startDate, "2024-02-29"); assert.equal(result.rows[0].endDate, "2024-03-01");
  for (const date of ["2026-02-29", "2026-02-30", "31/04/2026", "bad", "2026-10-01T24:00:00Z", 0]) {
    for (const field of ["startDate", "endDate"]) assert.throws(() => build(snapshot([row(1, { [field]: date })]), { id: "999" }), /data|calend/i);
  }
  for (const today of [undefined, "", "2026-02-30", "05/10/2026", "2026-10-05T00:00:00Z", 0]) {
    assert.throws(() => module.buildSacPathologies(snapshot([]), {}, today), /hoje|data/i);
  }
});

test("incomplete source metadata duplicate IDs and missing fields fail before filtering", () => {
  for (const source of [null, [], {}, { rows: [] }, { complete: false, rows: [] }, { complete: true, rows: null },
    ...["partial", "incomplete", "truncated", "aborted", "error"].map(flag => ({ complete: true, rows: [], [flag]: true }))]) {
    assert.throws(() => build(source), /snapshot|incomplet/i);
  }
  assert.throws(() => build(snapshot([row(), row()])), /duplic/i);
  for (const field of Object.keys(row())) {
    const missing = row(); delete missing[field];
    assert.throws(() => build(snapshot([missing]), { id: "999" }), /campo|registro|incomplet/i);
  }
  for (const id of ["01", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, {}]) assert.throws(() => build(snapshot([row(id)])), /ID/i);
  for (const value of [{}, true, ["ATIVO"]]) assert.throws(() => build(snapshot([row(1, { status: value })])), /campo|inválid/i);
});

test("invalid filter types cannot silently select all rows", () => {
  for (const filters of [null, [], true, { id: {} }, { id: 0 }, { id: "abc" }, { branch: 1 }, { status: false }]) {
    assert.throws(() => build(snapshot([row()]), filters), /filtro|ID/i);
  }
});

test("building a filtered report preserves the source and exposes only the consumed row fields", () => {
  const source = snapshot([row(1, { arbitrary: "not report data" }), row(2)]); const before = structuredClone(source);
  const result = build(source, { id: 1 });
  assert.deepEqual(source, before); assert.equal(result.rows[0].arbitrary, undefined);
  assert.deepEqual(result.filterOptions.id, ["1", "2"]);
});
