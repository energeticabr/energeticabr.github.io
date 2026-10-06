import test from "node:test";
import assert from "node:assert/strict";

const model = await import("../src/chat/quotation-report-model.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
function build(snapshot) {
  assert.equal(typeof model.buildQuotationOverview, "function", "buildQuotationOverview must be implemented");
  return model.buildQuotationOverview(snapshot);
}
const quote = (id, extra = {}) => ({ id, branch: "A", stage: "Obra", description: "Materiais", status: "ATIVA", ...extra });
const budget = (id, quotationId, extra = {}) => ({ id, quotationId, branch: "A", stage: "Obra", supplier: "Fornecedor",
  finalizedDate: null, total: null, status: "", observation: "", ...extra });

test("PowerFx metrics include both gendered statuses and pending orphan budgets", () => {
  const result = build({ quotes: [quote(2, { status: " ativo " }), quote(10), quote(1, { status: "INATIVA" }),
    quote(4, { status: "inativo" }), quote(3, { status: "OUTRO" })], budgets: [
    budget(1, 2, { status: " pendente solicitação " }), budget(2, 999, { status: "PENDENTE SOLICITACAO" }),
    budget(3, "", { status: "PENDENTE SOLICITAÇÃO" }), budget(4, 2, { status: "AGUARDANDO ORÇAMENTO" })] });
  assert.deepEqual(result.metrics, { active: 2, inactive: 2, total: 5, pending: 3 });
  assert.deepEqual(result.quotes.map(row => row.id), [10, 4, 3, 2, 1]);
  assert.equal(result.quotes.find(row => row.id === 2).budgetCount, 2);
});

test("numeric linking groups branch then stage and sorts each group's budget IDs descending", () => {
  const source = { quotes: [quote("002"), quote(10)], budgets: [
    budget("9", "02", { branch: "B", stage: "Z", supplier: " Alpha " }),
    budget("10", 2, { branch: "", stage: "", supplier: "Alpha" }),
    budget("100", "2.0", { branch: "B", stage: "A", supplier: "Beta" }),
    budget("20", 2, { branch: "B", stage: "Z", supplier: " " }),
    budget("21", 2, { branch: "", stage: "A", supplier: "Beta" }),
    budget("22", 2, { branch: "A", stage: "Z", supplier: "Alpha" })] };
  const before = structuredClone(source);
  const result = build(source);
  assert.deepEqual(source, before);
  assert.equal(result.quotes[0].budgetCount, 0);
  assert.deepEqual(result.quotes[0].groups, []);
  const detail = result.quotes[1];
  assert.equal(detail.supplierCount, 2); assert.equal(detail.budgetCount, 6);
  assert.deepEqual(detail.groups.map(group => [group.quotationId, group.branch, group.stage, group.budgets.map(row => row.id)]),
    [[2, "", "", [10]], [2, "", "A", [21]], [2, "A", "Z", [22]], [2, "B", "A", [100]], [2, "B", "Z", [20, 9]]]);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(detail)); assert.ok(Object.isFrozen(detail.groups[0].budgets[0]));
});

test("blank fields stay blank and calendar dates and currency normalize without UTC day shifts", () => {
  const result = build({ quotes: [quote(1, { branch: null, stage: " ", description: "linha 1\nlinha 2", status: null })], budgets: [
    budget(1, 1, { supplier: null, finalizedDate: "2026-10-06T23:30:00-03:00", total: "R$ 1.234,50" }),
    budget(2, 1, { finalizedDate: "29/02/2024", total: "0" }),
    budget(3, 1, { finalizedDate: " ", total: "" }), budget(4, 1, { total: "12.50" }),
    budget(5, 1, { total: -12.5 })] });
  const detail = result.quotes[0];
  assert.equal(detail.branch, ""); assert.equal(detail.stage, ""); assert.equal(detail.status, "");
  assert.equal(detail.description, "linha 1\nlinha 2");
  assert.deepEqual(detail.groups[0].budgets.map(row => [row.id, row.finalizedDate, row.total]),
    [[5, null, -12.5], [4, null, 12.5], [3, null, null], [2, "2024-02-29", 0], [1, "2026-10-06", 1234.5]]);
});

test("no FirstN caps hide quotes or budgets", () => {
  const result = build({ quotes: Array.from({ length: 201 }, (_, i) => quote(i + 1)),
    budgets: Array.from({ length: 2501 }, (_, i) => budget(i + 1, 1, { status: "PENDENTE SOLICITAÇÃO" })) });
  assert.equal(result.quotes.length, 201); assert.equal(result.metrics.pending, 2501);
  assert.equal(result.quotes[200].budgetCount, 2501); assert.equal(result.quotes[200].groups[0].budgets.length, 2501);
});

test("only confirmed empty arrays produce zero indicators", () => {
  assert.deepEqual(build({ quotes: [], budgets: [] }), { metrics: { active: 0, inactive: 0, total: 0, pending: 0 }, quotes: [] });
  for (const source of [undefined, {}, [], { quotes: [] }, { quotes: [], budgets: null },
    ...["error", "partial", "incomplete", "truncated", "aborted"].map(flag => ({ quotes: [], budgets: [], [flag]: true })),
    { quotes: [], budgets: [], complete: false }]) assert.throws(() => build(source), /snapshot|incomplet/i);
});

test("malformed rows and numeric duplicate IDs reject even in unlinked budgets", () => {
  for (const id of [0, -1, "1x", "1e2", 1.5, true, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => build({ quotes: [quote(id)], budgets: [] }), /ID|referência/i);
    assert.throws(() => build({ quotes: [], budgets: [budget(id, 999)] }), /ID|referência/i);
  }
  for (const quotationId of [0, "abc", true, {}, 1.2]) assert.throws(() => build({ quotes: [], budgets: [budget(1, quotationId)] }), /ID|referência/i);
  assert.throws(() => build({ quotes: [quote(1), quote("01")], budgets: [] }), /duplic/i);
  assert.throws(() => build({ quotes: [], budgets: [budget(1, 999), budget("01", 999)] }), /duplic/i);
  for (const row of [null, [], { id: 1 }, quote(1, { branch: {} })]) assert.throws(() => build({ quotes: [row], budgets: [] }), /registro|campo/i);
  const missing = budget(1, 1); delete missing.observation;
  assert.throws(() => build({ quotes: [], budgets: [missing] }), /campo|registro/i);
});

test("invalid money and impossible dates fail explicitly rather than becoming zero or blank", () => {
  for (const total of ["ISENTO", "12abc", "R$", "1 2", "1,23,4", true, Infinity, NaN, {}]) {
    assert.throws(() => build({ quotes: [], budgets: [budget(1, 999, { total })] }), /valor|monetário/i);
  }
  for (const finalizedDate of ["2026-02-29", "2024-02-30", "31/04/2026", "2026-10-06T25:00:00Z", "ontem", true, 0]) {
    assert.throws(() => build({ quotes: [], budgets: [budget(1, 999, { finalizedDate })] }), /data|calendário/i);
  }
});
