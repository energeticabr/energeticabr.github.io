import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const { createPresencePaymentReportView } = await import("../src/ui/presence-payment-report-view.js").catch(() => ({}));
const settle = () => new Promise(resolve => setImmediate(resolve));
const presence = (id, overrides = {}) => ({ id: String(id), paymentId: "3470", date: "2026-09-21", branch: "004 - EDIFÍCIO XAVANTE", property: "TODOS", supplier: "Rafael Gontijo", stage: "ALVENARIA", activity: "EXECUÇÃO DE ALVENARIA CERÂMICA", presence: "PRESENTE", dailyValue: 150, observation: "", motivation: "", ...overrides });
const snapshot = (rows = [presence(2080)]) => ({ presences: rows, launchesById: { 3470: { id: "3470", order: "346", date: "2026-09-30", supplier: "Rafael Gontijo", branch: "004 - EDIFÍCIO XAVANTE", stage: "ALVENARIA", description: "PAGAMENTO SEMANA RAFAEL", product: "ENGENHEIRO", account: "CAIXA", total: 150 } }, supplierStatusByName: { "Rafael Gontijo": "ATIVO" }, warnings: [] });

function setup(t, overrides = {}) {
  assert.equal(typeof createPresencePaymentReportView, "function");
  const dom = new JSDOM("<main></main>", { url: "https://example.test" });
  const data = { async loadSnapshot() { return snapshot(); }, ...overrides };
  const view = createPresencePaymentReportView({ document: dom.window.document, data });
  t.after(() => { view.destroy(); dom.window.close(); });
  return { dom, view, root: view.element };
}

test("exibe indicadores, pedido e presenças com campos rotulados sem tabela horizontal", async t => {
  const ctx = setup(t);
  await ctx.view.open();
  assert.match(ctx.root.textContent, /PRESENÇAS VINCULADAS POR PEDIDO/);
  assert.match(ctx.root.querySelector('[name="endDate"]').value, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(ctx.root.querySelector('[name="startDate"]').value, "");
  assert.equal(ctx.root.querySelector('[name="status"]').value, "ATIVO");
  assert.equal(ctx.root.querySelector('[data-metric="paymentIds"]').textContent, "1");
  assert.equal(ctx.root.querySelector('[data-metric="presences"]').textContent, "1");
  assert.match(ctx.root.querySelector('[data-metric="totalDaily"]').textContent, /150,00/);
  assert.match(ctx.root.querySelector('[data-order="346"]').textContent, /PAGAMENTO SEMANA RAFAEL/);
  assert.equal(ctx.root.querySelectorAll(".pp-presence-card").length, 1);
  assert.equal(ctx.root.querySelector("table"), null);
});

test("filtros combinados atualizam todas as medidas e permitem status ATIVO", async t => {
  const ctx = setup(t, { async loadSnapshot() { return snapshot([presence(1), presence(2, { date: "2026-09-22", supplier: "Outra", dailyValue: 90 })]); } });
  await ctx.view.open();
  const set = (name, value) => { const input = ctx.root.querySelector(`[name="${name}"]`); assert.ok(input, name); input.value = value; input.dispatchEvent(new ctx.dom.window.Event("change", { bubbles: true })); };
  set("status", "ATIVO");
  assert.equal(ctx.root.querySelector('[data-metric="presences"]').textContent, "1");
  set("startDate", "2026-09-22");
  assert.equal(ctx.root.querySelector('[data-metric="presences"]').textContent, "0");
  set("status", "");
  ctx.root.querySelector(".pp-refresh").click(); await settle();
  assert.equal(ctx.root.querySelector('[name="status"]').value, "", "Atualizar preserva a escolha Todos");
});

test("destaca fornecedor divergente, ausência e status de pagamento da presença", async t => {
  const ctx = setup(t, { async loadSnapshot() { return snapshot([presence(1, { supplier: "Outra", presence: "AUSENTE", dailyValue: 0 })]); } });
  await ctx.view.open();
  const status = ctx.root.querySelector('[name="status"]'); status.value = "";
  status.dispatchEvent(new ctx.dom.window.Event("change", { bubbles: true }));
  const card = ctx.root.querySelector(".pp-presence-card");
  assert.equal(card.querySelector(".pp-badge").dataset.tone, "danger");
  assert.ok(card.querySelector(".pp-field--warning"));
  assert.equal(card.querySelector(".pp-status-field").dataset.tone, "danger");
  assert.match(card.querySelector(".pp-status-field").textContent, /DESCONHECIDO/);
});

test("valor diário ausente mostra total incompleto em vez de zero", async t => {
  const ctx = setup(t, { async loadSnapshot() { return snapshot([presence(1, { dailyValue: null })]); } });
  await ctx.view.open();
  assert.equal(ctx.root.querySelector('[data-metric="totalDaily"]').textContent, "INCOMPLETO");
  assert.match(ctx.root.querySelector(".pp-values").textContent, /INCOMPLETO/);
});

test("erro não mantém total antigo e Atualizar refaz a consulta", async t => {
  let calls = 0;
  const ctx = setup(t, { async loadSnapshot() { if (++calls === 2) throw new Error("Falha 503"); return snapshot(); } });
  await ctx.view.open();
  ctx.root.querySelector(".pp-refresh").click(); await settle();
  assert.equal(ctx.root.querySelector('[data-metric="presences"]').textContent, "—");
  assert.match(ctx.root.querySelector("[role=alert]").textContent, /Falha 503/);
  ctx.root.querySelector(".pp-retry").click(); await settle();
  assert.equal(ctx.root.querySelector('[data-metric="presences"]').textContent, "1");
});

test("fechar aborta consulta e ignora resposta tardia; SharePoint é sempre texto", async t => {
  let resolver; let signal;
  const ctx = setup(t, { loadSnapshot({ signal: provided }) { signal = provided; return new Promise(resolve => { resolver = resolve; }); } });
  const opening = ctx.view.open(); await settle();
  ctx.view.close();
  assert.equal(signal.aborted, true);
  resolver(snapshot([presence(1, { activity: '<img src=x onerror="alert(1)">' })]));
  await opening;
  assert.equal(ctx.root.querySelectorAll(".pp-presence-card").length, 0);
  const safe = setup(t, { async loadSnapshot() { return snapshot([presence(1, { activity: '<img src=x onerror="alert(1)">' })]); } });
  await safe.view.open();
  assert.equal(safe.root.querySelector("img"), null);
  assert.match(safe.root.textContent, /<img src=x/);
});
