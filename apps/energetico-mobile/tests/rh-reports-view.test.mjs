import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createRhReportsView } from "../src/ui/rh-reports-view.js";

const supplier = { id: "1", name: "Ana", contractor: true, branch: "CENTRO", property: "OBRA A", profession: "PEDREIRO", status: "ATIVO", paymentMethod: "DIÁRIA", dailyValue: 120 };
const presence = { id: "7", supplier: "Ana", date: "2026-10-01", branch: "CENTRO", property: "OBRA A", profession: "PEDREIRO", presence: "PRESENTE", status: "PENDENTE PGTO", dailyValue: 120, activity: "Alvenaria" };
const snapshot = { suppliers: [supplier], presences: [presence] };
function setup(t, loadSnapshot = async () => snapshot) {
  const dom = new JSDOM("<main></main>", { url: "https://example.test" });
  const view = createRhReportsView({ document: dom.window.document, data: { loadSnapshot } });
  t.after(() => { view.destroy(); dom.window.close(); });
  return { dom, view, root: view.element };
}

test("abre relatórios 3, 4 e 5 sob demanda em cartões sem tabelas", async t => {
  const { view, root } = setup(t);
  assert.equal(root.tagName, "SECTION"); assert.equal(root.hidden, true);
  await view.open(3); assert.match(root.textContent, /FORNECEDORES/); assert.match(root.textContent, /OBRA A/);
  await view.open(4); assert.match(root.textContent, /PRESENÇAS E AUSÊNCIAS/); assert.match(root.textContent, /PEDREIRO/);
  await view.open(5); assert.match(root.textContent, /PAGAMENTOS PENDENTES/); assert.match(root.textContent, /120,00/);
  assert.equal(root.querySelector("table"), null);
});

test("filtros recalculam o relatório 5 e valores do SharePoint aparecem como texto", async t => {
  const { view, root, dom } = setup(t, async () => ({ suppliers: [{ ...supplier, name: "<img src=x onerror=alert(1)>" }], presences: [{ ...presence, supplier: "<img src=x onerror=alert(1)>" }] }));
  await view.open(5);
  assert.equal(root.querySelector("img"), null);
  assert.match(root.textContent, /<img src=x/);
  const filter = root.querySelector('[name="branch"]'); filter.value = "OUTRA";
  filter.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(root.querySelectorAll(".rh-reports-supplier").length, 0);
});

test("fechar aborta carregamento e resposta tardia não aparece", async t => {
  let resolver; let signal;
  const { view, root } = setup(t, (_number, options) => { signal = options.signal; return new Promise(resolve => { resolver = resolve; }); });
  const loading = view.open(3); view.close();
  assert.equal(signal.aborted, true); assert.equal(root.hidden, true);
  resolver(snapshot); await loading;
  assert.equal(root.querySelectorAll(".rh-reports-supplier").length, 0);
});

test("erro de consulta remove métricas anteriores e oferece nova tentativa", async t => {
  let calls = 0;
  const { view, root } = setup(t, async () => { if (++calls === 2) throw new Error("Falha 503"); return snapshot; });
  await view.open(3); assert.match(root.textContent, /OBRA A/);
  await view.open(3);
  assert.equal(root.querySelectorAll(".rh-reports-supplier").length, 0);
  assert.match(root.querySelector('[role="alert"]').textContent, /Falha 503/);
  root.querySelector(".rh-reports-retry").click();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(root.textContent, /OBRA A/);
});
