import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const module = await import("../src/chat/commercial-milestones-model.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const build = (...args) => {
  assert.equal(typeof module.buildCommercialMilestones, "function", "buildCommercialMilestones must be implemented");
  return module.buildCommercialMilestones(...args);
};
const milestone = (id, extra = {}) => ({ id: String(id), branch: "A", property: "Casa", contractId: "10", buyer: "Ana",
  type: "ESCRITURA", description: "Providenciar escritura", startDate: "2026-10-01", dueDate: "2026-10-06",
  status: "ATIVIDADE INICIADA", ...extra });
const property = (id, extra = {}) => ({ id: String(id), branch: "A", property: "Casa", visualStatus: "ATIVO", ...extra });
const snapshot = (milestones = [], properties = [property(1)]) => ({ complete: true, properties, milestones });
const rows = result => result.branches.flatMap(branch => branch.rows);
const ids = result => rows(result).map(row => row.id);
const today = "2026-10-05";

test("empty complete source returns the fixed public report shape", () => {
  assert.deepEqual(build(snapshot([], []), {}, today), { detail: false, branches: [],
    filterOptions: { branch: [], contractId: [], buyer: [], property: [], visualStatus: [] } });
});

test("summary is one newest start per branch/property irrespective of contract or buyer", () => {
  const result = build(snapshot([milestone(1), milestone(2, { startDate: "2026-10-03", buyer: "Bia", contractId: "20" }),
    milestone(3, { branch: "B", startDate: "2026-09-01" }), milestone(4, { property: "Apartamento" })]), {}, today);
  assert.equal(result.detail, false);
  assert.deepEqual(result.branches.map(b => [b.name, b.count, b.rows.map(r => r.id)]), [["A", 2, ["4", "2"]], ["B", 1, ["3"]]]);
  assert.ok(rows(result).every(row => row.isLatest));
});

test("equal summary start picks the first source row rather than highest ID", () => {
  assert.deepEqual(ids(build(snapshot([milestone(2), milestone(90), milestone(1)]), {}, today)), ["2"]);
});

test("blank starts use 1900 only for ordering and retain unknown dates and durations", () => {
  const result = build(snapshot([milestone(1, { startDate: "", dueDate: "", branch: "", property: "", buyer: "", contractId: "" }),
    milestone(2, { startDate: "1899-12-31", branch: "", property: "" })], []), {}, today);
  assert.equal(result.branches[0].name, "SEM FILIAL");
  const row = rows(result)[0];
  assert.equal(row.id, "1"); assert.equal(row.startDate, ""); assert.equal(row.dueDate, "");
  assert.equal(row.daysInProgress, null); assert.equal(row.daysToDue, null);
  assert.equal(row.branchLabel, "SEM FILIAL"); assert.equal(row.propertyLabel, "SEM IMÓVEL");
  assert.equal(row.buyerLabel, "N/A"); assert.equal(row.contractLabel, "CONTRATO NÃO APONTADO");
  assert.equal(row.visualStatus, "SEM STATUS");
});

test("first property NAME lookup ignores branch and preserves duplicate-name input order", () => {
  const source = snapshot([milestone(1)], [property(1, { branch: "B", visualStatus: "INATIVO" }), property(2)]);
  assert.equal(rows(build(source, {}, today))[0].visualStatus, "INATIVO");
  assert.equal(rows(build(snapshot(source.milestones, source.properties.toReversed()), {}, today))[0].visualStatus, "ATIVO");
  assert.deepEqual(ids(build(source, { visualStatus: "ativo" }, today)), []);
  assert.deepEqual(ids(build(source, { visualStatus: "inativo" }, today)), ["1"]);
});

test("blank first property status falls back without searching later matches", () => {
  assert.equal(rows(build(snapshot([milestone(1)], [property(1, { visualStatus: "" }), property(2)]), {}, today))[0].visualStatus, "SEM STATUS");
  assert.equal(rows(build(snapshot([milestone(1, { property: "" })], [property(1, { property: "", visualStatus: "ATIVO" })]), {}, today))[0].visualStatus, "ATIVO");
});

test("no implicit ATIVO filter and visualStatus never filters milestone status", () => {
  const source = snapshot([milestone(1, { status: "ATIVIDADE FINALIZADA" }), milestone(2, { property: "Lote", status: "ATIVO" })],
    [property(1), property(2, { property: "Lote", visualStatus: "INATIVO" })]);
  assert.deepEqual(ids(build(source, {}, today)), ["1", "2"]);
  assert.deepEqual(ids(build(source, { visualStatus: "ativo" }, today)), ["1"]);
  assert.equal(rows(build(source, { visualStatus: "ativo" }, today))[0].daysToDue, 1);
});

test("only nonblank contract, buyer or property activates detail, including unmatched selections", () => {
  for (const filter of [{}, { branch: "A" }, { visualStatus: "ATIVO" }, { buyer: "  ", contractId: "", property: "" }]) {
    assert.equal(build(snapshot([milestone(1)]), filter, today).detail, false);
  }
  for (const filter of [{ contractId: "10" }, { buyer: "Ana" }, { property: "Casa" }, { buyer: "missing" }]) {
    assert.equal(build(snapshot([milestone(1)]), filter, today).detail, true);
  }
});

test("detail sorts property, buyer and contract as ptBR TEXT then start descending", () => {
  const source = snapshot([milestone(1, { contractId: "2" }), milestone(2, { contractId: "10", startDate: "2026-09-01" }),
    milestone(3, { contractId: "10", startDate: "2026-10-03" }), milestone(4, { buyer: "Bia", contractId: "1" }),
    milestone(5, { property: "Árvore" }), milestone(6, { branch: "Águas", property: "Lote" }), milestone(7, { branch: "Zeta" })]);
  const result = build(source, { visualStatus: "SEM STATUS", buyer: "Ana" }, today);
  assert.deepEqual(result.branches.map(b => b.name), ["A", "Águas"]);
  assert.deepEqual(ids(build(source, { branch: "A", buyer: "Ana" }, today)), ["5", "3", "2", "1"]);
  assert.deepEqual(ids(build(source, { branch: "A", property: "Casa" }, today)), ["3", "2", "1", "4"]);
});

test("detail latest groups property+contract within filtered branch, ignores buyer and includes ties", () => {
  const source = snapshot([milestone(1, { startDate: "2026-10-01" }), milestone(2, { buyer: "Bia", startDate: "2026-10-03" }),
    milestone(3, { buyer: "Caio", startDate: "2026-10-03" }), milestone(4, { branch: "B", startDate: "2026-10-04" }),
    milestone(5, { contractId: "20", startDate: "2026-09-01" })]);
  const result = build(source, { property: "Casa" }, today);
  assert.deepEqual(rows(result).map(r => [r.id, r.isLatest]), [["1", false], ["5", true], ["2", true], ["3", true], ["4", true]]);
  assert.equal(rows(build(source, { buyer: "Ana", branch: "A" }, today))[0].isLatest, true);
});

test("blank-start ties all qualify as latest detail and completed latest rows remain due eligible", () => {
  const result = build(snapshot([milestone(1, { startDate: "", dueDate: "2026-10-04", status: "ATIVIDADE FINALIZADA" }),
    milestone(2, { startDate: "", dueDate: "2026-10-05" })]), { property: "Casa" }, today);
  assert.deepEqual(rows(result).map(r => [r.isLatest, r.daysToDue]), [[true, -1], [true, 0]]);
});

test("dates retain source calendar across offsets and durations cross leap year without invention", () => {
  const result = build(snapshot([milestone(1, { startDate: "2024-02-28T23:30:00-03:00", dueDate: "01/03/2024" })]), {}, "2024-02-29");
  const row = rows(result)[0];
  assert.equal(row.startDate, "2024-02-28"); assert.equal(row.dueDate, "2024-03-01");
  assert.equal(row.daysInProgress, 1); assert.equal(row.daysToDue, 1);
  assert.equal(rows(build(snapshot([milestone(1, { startDate: "2026-10-07" })]), {}, today))[0].daysInProgress, -2);
});

test("full DateTime chronological ordering survives normalized startDate via startOrder", () => {
  const source = snapshot([milestone(1, { startDate: "2026-10-01T08:00:00-03:00" }),
    milestone(2, { startDate: "2026-10-01T20:00:00-03:00" })]);
  assert.deepEqual(ids(build(source, {}, today)), ["2"]);
  const normalized = snapshot([milestone(1, { startOrder: Date.parse("2026-10-01T08:00:00-03:00") }),
    milestone(2, { startOrder: Date.parse("2026-10-01T20:00:00-03:00") })]);
  assert.deepEqual(ids(build(normalized, {}, today)), ["2"]);
  assert.deepEqual(rows(build(normalized, { property: "Casa" }, today)).map(r => [r.id, r.isLatest]), [["2", true], ["1", false]]);
});

test("all filters combine and normalized fallback labels can be selected", () => {
  const source = snapshot([milestone(1, { branch: "", buyer: "", contractId: "", property: "" }), milestone(2)], []);
  assert.deepEqual(ids(build(source, { branch: "SEM FILIAL", buyer: "N/A", contractId: "CONTRATO NÃO APONTADO", property: "SEM IMÓVEL", visualStatus: "sem status" }, today)), ["1"]);
  assert.deepEqual(ids(build(source, { branch: "A", buyer: "Ana", contractId: 10, property: "Casa" }, today)), ["2"]);
});

test("filter options derive from full source before filtering or summary reduction and deduplicate", () => {
  const result = build(snapshot([milestone(1), milestone(2, { buyer: "Bia", contractId: "2", branch: "B" }),
    milestone(3, { branch: "", property: "", buyer: "", contractId: "" }), milestone(4)]), { buyer: "missing" }, today);
  assert.deepEqual(result.filterOptions, { branch: ["A", "B", "SEM FILIAL"], contractId: ["10", "2", "CONTRATO NÃO APONTADO"],
    buyer: ["Ana", "Bia", "N/A"], property: ["Casa", "SEM IMÓVEL"], visualStatus: ["ATIVO", "SEM STATUS"] });
});

test("normalization is pure and preserves source text fields for renderer", () => {
  const source = snapshot([milestone(1, { branch: " A ", type: " Tipo ", description: " Texto ", status: " Final " })]);
  const copy = structuredClone(source);
  const row = rows(build(source, {}, today))[0];
  assert.equal(row.branch, "A"); assert.equal(row.type, "Tipo"); assert.equal(row.description, "Texto"); assert.equal(row.status, "Final");
  assert.deepEqual(source, copy);
});

test("partial, malformed and duplicate source rejects globally even when filters hide it", () => {
  for (const source of [null, {}, { complete: false, properties: [], milestones: [] }, { complete: true, properties: {}, milestones: [] },
    snapshot([milestone(1), milestone(1, { branch: "hidden" })]), snapshot([], [property(1), property(1)]),
    snapshot([milestone(1, { id: "01" })]), snapshot([milestone(1, { contractId: {} })]),
    snapshot([milestone(1, { dueDate: "2026-02-30" })]), snapshot([milestone(1, { startDate: "2026-13-01" })]),
    snapshot([milestone(1, { description: {} })]), snapshot([], [property(1, { visualStatus: [] })]),
    snapshot([milestone(1, { startOrder: NaN })]), snapshot([milestone(1, { startDate: "", startOrder: 123 })])]) {
    assert.throws(() => build(source, { branch: "hidden" }, today), /inválid|incomplet|duplic|data|snapshot|campo|contrato/i);
  }
  for (const field of ["id", "branch", "property", "contractId", "buyer", "type", "description", "startDate", "dueDate", "status"]) {
    const row = milestone(1); delete row[field];
    assert.throws(() => build(snapshot([row]), { buyer: "missing" }, today), /inválid|incomplet|campo|registro/i);
  }
});

test("invalid dates including malformed time and non-calendar today reject explicitly", () => {
  for (const date of ["2023-02-29", "31/04/2026", "2026-10-01T24:00:00Z", "2026-10-01T12:60:00Z", "junk", 1, {}, true]) {
    assert.throws(() => build(snapshot([milestone(1, { startDate: date })]), {}, today), /data|inválid/i);
  }
  for (const date of [undefined, "", "2026-02-30", "2026-10-05T12:00:00Z", "05/10/2026"]) {
    assert.throws(() => build(snapshot(), {}, date), /hoje|data|inválid/i);
  }
  for (const filters of [null, [], { buyer: {} }, { branch: false }]) assert.throws(() => build(snapshot(), filters, today), /filtro|inválid/i);
});

test("explicit incomplete flags and array-shaped snapshots cannot claim completeness", () => {
  for (const source of [{ ...snapshot(), incomplete: true }, { ...snapshot(), partial: true },
    { ...snapshot(), truncated: true }, Object.assign([], snapshot())]) {
    assert.throws(() => build(source, {}, today), /incomplet|snapshot|inválid/i);
  }
});

test("source calendar dates and timezone-free chronology are independent of device timezone", () => {
  const moduleUrl = new URL("../src/chat/commercial-milestones-model.js", import.meta.url).href;
  const code = `import { buildCommercialMilestones } from ${JSON.stringify(moduleUrl)};
    const source = ${JSON.stringify(snapshot([milestone(1, { startDate: "2026-10-01T23:30:00", dueDate: "2026-10-05T00:30:00+14:00" })]))};
    console.log(JSON.stringify(buildCommercialMilestones(source, {}, '2026-10-05').branches[0].rows[0]));`;
  for (const timezone of ["UTC", "America/Sao_Paulo", "Pacific/Kiritimati", "America/Los_Angeles"]) {
    const row = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval", code], { encoding: "utf8", env: { ...process.env, TZ: timezone } }));
    assert.equal(row.startDate, "2026-10-01"); assert.equal(row.dueDate, "2026-10-05");
    assert.equal(row.daysInProgress, 4); assert.equal(row.daysToDue, 0); assert.equal(row.startOrder, 1790897400000);
  }
});

test("equal instants with different offsets retain first summary row and qualify both detail ties", () => {
  const source = snapshot([milestone(1, { startDate: "2026-10-01T23:30:00-03:00" }),
    milestone(99, { startDate: "2026-10-02T02:30:00Z" })]);
  assert.deepEqual(ids(build(source, {}, today)), ["1"]);
  assert.deepEqual(rows(build(source, { property: "Casa" }, today)).map(row => row.isLatest), [true, true]);
});

test("text contract IDs preserve leading zeros and arbitrary codes in rows, filters and options", () => {
  for (const contractId of ["0010", "0", "-1", "ABC-2026/001", "10.5", "9007199254740993", "Contrato especial"]) {
    const result = build(snapshot([milestone(1, { contractId })]), { contractId }, today);
    assert.equal(result.detail, true); assert.deepEqual(ids(result), ["1"]);
    assert.equal(rows(result)[0].contractId, contractId); assert.equal(rows(result)[0].contractLabel, contractId);
    assert.deepEqual(result.filterOptions.contractId, [contractId]);
  }
  for (const contractId of [false, {}, [], NaN, Infinity]) {
    assert.throws(() => build(snapshot([milestone(1, { contractId })]), { buyer: "hidden" }, today), /inválid|contrato|campo/i);
  }
});

test("leading-zero contract texts remain distinct latest groups and sort as text", () => {
  const source = snapshot([milestone(1, { contractId: "0010", startDate: "2026-10-01" }),
    milestone(2, { contractId: "10", startDate: "2026-10-03" }), milestone(3, { contractId: "ABC/1", startDate: "2026-10-02" })]);
  const result = build(source, { property: "Casa" }, today);
  assert.deepEqual(rows(result).map(row => [row.contractId, row.isLatest]), [["0010", true], ["10", true], ["ABC/1", true]]);
  assert.deepEqual(ids(build(source, { contractId: "0010" }, today)), ["1"]);
});
