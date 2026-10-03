import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const { createSpendingReportsView } = await import("../src/ui/spending-reports-view.js").catch(() => ({}));
const settle = () => new Promise(resolve => setImmediate(resolve));
const row = (id, changes = {}) => ({ id: String(id), date: "2026-09-12", paymentDate: "2026-09-25", supplier: "Fornecedor muito longo Alfa",
  product: "Cimento", branch: "Filial A", disbursement: "SIM", order: "42", stage: "Fundação", account: "Obra",
  description: "Entrega", unit: 20, quantity: 2, freight: 5, total: 45, ...changes });

function setup(t, data) {
  assert.equal(typeof createSpendingReportsView, "function");
  const dom = new JSDOM("<main></main>");
  const view = createSpendingReportsView({ document: dom.window.document, data });
  t.after(() => { view.destroy(); dom.window.close(); });
  return { dom, view, root: view.element };
}

test("abre 9 com cartões gerenciais e 10 com cartões por data e fornecedor", async t => {
  const calls = [];
  const { view, root } = setup(t, { async loadSnapshot({ reportNumber }) { calls.push(reportNumber); return { launches: [row(1)], productTypes: [{ product: "Cimento", expenseType: "Material" }] }; } });
  assert.equal(root.tagName, "SECTION");
  await view.open(9);
  assert.match(root.textContent, /RESUMO GERENCIAL DE GASTOS/);
  assert.match(root.textContent, /PERCENTUAL POR TIPO DE DESPESA/);
  assert.equal(root.querySelectorAll("table").length, 0);
  await view.open(10);
  assert.match(root.textContent, /DATA PGTO/);
  assert.match(root.textContent, /Fornecedor muito longo Alfa/);
  assert.deepEqual(calls, [9, 10]);
});

test("valor incompleto aparece explicitamente sem total definitivo", async t => {
  const { view, root } = setup(t, { async loadSnapshot() { return { launches: [row(1), row(2, { unit: null, total: null })], productTypes: [] }; } });
  await view.open(10);
  assert.match(root.querySelector('[data-metric="total"]').textContent, /INCOMPLETO/);
  assert.doesNotMatch(root.querySelector('[data-metric="total"]').textContent, /45,00/);
});

test("fechar aborta carregamento, limpa números e ignora resposta tardia", async t => {
  let resolve; let signal;
  const { view, root } = setup(t, { loadSnapshot({ signal: activeSignal }) { signal = activeSignal; return new Promise(done => { resolve = done; }); } });
  const opening = view.open(9); await settle(); view.close();
  assert.equal(signal.aborted, true);
  resolve({ launches: [row(1)], productTypes: [] }); await opening;
  assert.equal(root.hidden, true);
  assert.equal(root.querySelector('[data-metric="total"]')?.textContent ?? "", "");
});

test("erro de consulta remove dados antigos e permite tentar novamente sem HTML de origem", async t => {
  let calls = 0;
  const { view, root } = setup(t, { async loadSnapshot() { if (++calls === 2) throw new Error("Falha 503");
    return { launches: [row(1, { product: '<img src=x onerror="alert(1)">' })], productTypes: [] }; } });
  await view.open(9);
  assert.equal(root.querySelector("img"), null);
  assert.match(root.textContent, /<img src=x/);
  root.querySelector(".sr-refresh").click(); await settle();
  assert.match(root.querySelector("[role=alert]").textContent, /Falha 503/);
  assert.equal(root.querySelector('[data-metric="total"]').textContent, "—");
  root.querySelector(".sr-retry").click(); await settle();
  assert.match(root.querySelector('[data-metric="total"]').textContent, /45,00/);
});
