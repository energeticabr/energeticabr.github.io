import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createAuditReportsView } from "../src/ui/audit-reports-live-view.js";

function setup(t, data) {
  const dom = new JSDOM("<main></main>");
  const view = createAuditReportsView({ document: dom.window.document, data });
  dom.window.document.querySelector("main").append(view.element);
  t.after(() => { view.destroy(); dom.window.close(); });
  return { dom, view, root: view.element };
}

test("abre cada relatório com dados atuais, cartões rotulados e sem tabela larga", async t => {
  const called = [];
  const { view, root } = setup(t, { async loadReport(number) { called.push(number); if (number === 11) return { quotes: [{ id: "5", status: "ATIVA", description: "<img src=x onerror=alert(1)>" }], budgets: [] }; if (number === 12) return { rows: [{ id: "1", branch: "A", depreciationDate: "2026-10-02", estimated: 100, residual: 80, quantity: 1, percent: 10 }] }; return { rows: [{ id: "2", status: "PENDENTE", validityDate: "2026-10-05", branch: "A" }] }; } });
  assert.equal(root.tagName, "SECTION");
  await view.open(11);
  assert.match(root.textContent, /COTAÇÕES E ORÇAMENTOS/);
  assert.match(root.textContent, /<img src=x/);
  assert.equal(root.querySelector("img"), null);
  await view.open(12);
  assert.match(root.textContent, /CONTROLE DE DEPRECIAÇÃO/);
  await view.open(13);
  assert.match(root.textContent, /CONTROLE DE DOCUMENTOS/);
  assert.deepEqual(called, [11, 12, 13]);
  assert.equal(root.querySelector("table"), null);
});

test("filtrar documentos recalcula indicadores; atualizar limpa totais durante erro", async t => {
  let calls = 0;
  const { view, root, dom } = setup(t, { async loadReport() { if (++calls === 2) throw new Error("Falha 503"); return { rows: [{ id: "1", branch: "A", status: "PENDENTE" }, { id: "2", branch: "B", status: "SUBMETIDO" }] }; } });
  await view.open(13);
  const branch = root.querySelector('[name="branch"]');
  branch.value = "A"; branch.dispatchEvent(new dom.window.Event("change"));
  assert.equal(root.querySelector('[data-metric="total"]').textContent, "1");
  root.querySelector(".ar-refresh").click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(root.querySelector('[data-metric="total"]').textContent, "—");
  assert.match(root.querySelector('[role="alert"]').textContent, /Falha 503/);
});

test("close aborta carregamento e ignora resposta tardia", async t => {
  let resolveLoad; let signal;
  const { view, root } = setup(t, { loadReport(_number, options) { signal = options.signal; return new Promise(resolve => { resolveLoad = resolve; }); } });
  const opening = view.open(11);
  view.close();
  assert.equal(signal.aborted, true);
  resolveLoad({ quotes: [{ id: "99", status: "ATIVA" }], budgets: [] });
  await opening;
  assert.equal(root.hidden, true);
  assert.doesNotMatch(root.textContent, /COTAÇÃO Nº 99/);
});
