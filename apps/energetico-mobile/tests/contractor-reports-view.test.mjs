import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { normalizeContractorRow } from "../src/chat/contractor-report-model.js";

const module = await import("../src/ui/contractor-reports-view.js").catch(() => ({}));
const settle = () => new Promise(resolve => setImmediate(resolve));

function row(id, overrides = {}) {
  return normalizeContractorRow({ id: String(id), fields: {
    FILIAL: "004 - EDIFÍCIO XAVANTE", FORNECEDOR: "Israel", "ETAPA OBRA": "Fundações",
    ATIVIDADEEXECUTADA: "Armação", STATUS: "ATIVO", "DATA INÍCIO": "2026-08-10",
    IDCONTRATO: "214", IDESTIMATIVA: "215", VALORGLOBALESTIMADO: 3386.08,
    ...overrides,
  } });
}

function setup(t, dataOverrides = {}, presenceData) {
  assert.equal(typeof module.createContractorReportsView, "function");
  const dom = new JSDOM("<main id=app></main>", { url: "https://example.test" });
  const data = {
    async loadOverview() { return { rows: [row(237), row(238, { STATUS: "INATIVO", FORNECEDOR: "Outro", IDCONTRATO: "216" })], documentStatuses: { 214: "PENDENTE", 215: "SUBMETIDO" }, warnings: [] }; },
    async loadDetails() { return { launches: [{ id: "3486", date: "2026-10-01", supplier: "Israel", contract: "237", total: 55, paymentStatus: "PAGO", paymentTone: "success" }], measurements: [{ id: "1", supplier: "Israel", contract: "237", status: "ATIVO", statusTone: "success" }] }; },
    ...dataOverrides,
  };
  const view = module.createContractorReportsView({ document: dom.window.document, data, presenceData });
  t.after(() => { view.destroy(); dom.window.close(); });
  return { dom, view, root: () => dom.window.document.querySelector(".cr-overlay") };
}

function click(window, node) { assert.ok(node); node.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }
async function report(ctx) {
  await ctx.view.open();
  click(ctx.dom.window, ctx.root().querySelector('[data-report-id="1"]'));
  await settle(); await settle();
}

test("abre o seletor de quadrados com somente o Relatório 1 disponível e mostra a tabela de 13 colunas", async t => {
  const ctx = setup(t);
  await ctx.view.open();
  assert.equal(ctx.root().getAttribute("role"), "dialog");
  assert.equal(ctx.root().querySelector('[data-report-id="1"]').disabled, false);
  assert.ok([...ctx.root().querySelectorAll("[data-report-id]")].slice(1).every(tile => tile.disabled));
  click(ctx.dom.window, ctx.root().querySelector('[data-report-id="1"]'));
  await settle(); await settle();
  assert.match(ctx.root().textContent, /CONTROLE DE EMPREITEIROS/);
  assert.equal(ctx.root().querySelectorAll(".cr-main-table thead th").length, 13);
  assert.equal(ctx.root().querySelector('[name="status"]').value, "ATIVO");
  assert.equal(ctx.root().querySelectorAll(".cr-main-table tbody tr").length, 1);
  assert.equal(ctx.root().querySelector('.cr-main-table [data-column="supplier"]').dataset.label, "FORNECEDOR");
  assert.equal(ctx.root().querySelector('[data-metric="active"]').textContent.trim(), "1");
  assert.equal(ctx.root().querySelector('[data-metric="inactive"]').textContent.trim(), "0");
  assert.equal(ctx.root().querySelector('[data-metric="contracts"]').textContent.trim(), "1");
  assert.match(ctx.root().querySelector('[data-metric="activeGlobalValue"]').textContent, /3\.386,08/);
  const status = ctx.root().querySelector('[name="status"]');
  status.value = "";
  status.dispatchEvent(new ctx.dom.window.Event("change", { bubbles: true }));
  assert.equal(ctx.root().querySelector('[data-metric="inactive"]').textContent.trim(), "1");
  assert.equal(ctx.root().querySelectorAll(".cr-main-table tbody tr").length, 2);
});

test("combina filtros e exibe detalhe do ID selecionado sem confundir com IDCONTRATO", async t => {
  const ctx = setup(t);
  await report(ctx);
  const root = ctx.root();
  const set = (name, value) => {
    const select = root.querySelector(`[name="${name}"]`);
    assert.ok(select, name);
    select.value = value;
    select.dispatchEvent(new ctx.dom.window.Event("change", { bubbles: true }));
  };
  set("supplier", "Israel");
  set("id", "237");
  await settle(); await settle();
  assert.equal(root.querySelectorAll(".cr-main-table tbody tr").length, 1);
  assert.equal(root.querySelector('[data-metric="active"]').textContent.trim(), "1");
  assert.match(root.querySelector(".cr-detail").textContent, /CONTRATO ID 237/);
  assert.match(root.querySelector(".cr-detail").textContent, /3486/);
  assert.match(root.querySelector(".cr-detail").textContent, /R\$.*55,00/);
  assert.match(root.querySelector(".cr-detail").textContent, /MEDIÇÕES VINCULADAS/);
  assert.equal(root.querySelector('.cr-detail-table [data-label="VALOR TOTAL"]').textContent.trim().includes("55,00"), true);
  const doc = root.querySelector('tr[data-row-id="237"] [data-column="contractDocumentId"]');
  assert.match(doc.textContent, /214 \(PENDENTE\)/);
  assert.equal(doc.dataset.tone, "danger");
});

test("célula de texto do SharePoint é inserida como texto, sem executar HTML", async t => {
  const ctx = setup(t, { async loadOverview() { return { rows: [row(1, { FORNECEDOR: '<img src=x onerror="alert(1)">' })], documentStatuses: {}, warnings: [] }; } });
  await report(ctx);
  assert.equal(ctx.root().querySelector(".cr-main-table img"), null);
  assert.match(ctx.root().querySelector(".cr-main-table").textContent, /<img src=x/);
});

test("falha de consulta mostra erro e botão de tentar novamente que recupera a tabela", async t => {
  let attempts = 0;
  const ctx = setup(t, { async loadOverview() {
    if (++attempts === 1) throw new Error("SharePoint indisponível");
    return { rows: [row(237)], documentStatuses: {}, warnings: [] };
  } });
  await report(ctx);
  assert.match(ctx.root().querySelector("[role=alert]").textContent, /SharePoint indisponível/);
  assert.equal(ctx.root().querySelector('[data-metric="active"]').textContent.trim(), "—", "sem dados válidos não pode parecer que há zero ativos");
  assert.equal(ctx.root().querySelector('[data-metric="contracts"]').textContent.trim(), "—");
  click(ctx.dom.window, ctx.root().querySelector(".cr-retry"));
  await settle(); await settle();
  assert.equal(ctx.root().querySelectorAll(".cr-main-table tbody tr").length, 1);
});

test("reabrir o relatório e tocar Atualizar consultam dados novos sem manter totais antigos", async t => {
  let count = 0;
  const ctx = setup(t, { async loadOverview() {
    count += 1;
    return { rows: [row(237, { VALORGLOBALESTIMADO: count * 100 })], documentStatuses: {}, warnings: [] };
  } });
  await report(ctx);
  assert.match(ctx.root().querySelector('[data-metric="activeGlobalValue"]').textContent, /100,00/);
  click(ctx.dom.window, ctx.root().querySelector(".cr-refresh"));
  await settle(); await settle();
  assert.equal(count, 2);
  assert.match(ctx.root().querySelector('[data-metric="activeGlobalValue"]').textContent, /200,00/);
  ctx.view.close();
  await ctx.view.open();
  click(ctx.dom.window, ctx.root().querySelector('[data-report-id="1"]'));
  await settle(); await settle();
  assert.equal(count, 3);
  assert.match(ctx.root().querySelector('[data-metric="activeGlobalValue"]').textContent, /300,00/);
});

test("ao fechar durante a consulta, cancela a sessão e ignora uma resposta atrasada", async t => {
  let resolveOverview;
  let observedSignal;
  const ctx = setup(t, { loadOverview({ signal }) {
    observedSignal = signal;
    return new Promise(resolve => { resolveOverview = resolve; });
  } });
  await ctx.view.open();
  click(ctx.dom.window, ctx.root().querySelector('[data-report-id="1"]'));
  await settle();
  ctx.view.close();
  assert.equal(observedSignal.aborted, true);
  assert.equal(ctx.root().hidden, true);
  resolveOverview({ rows: [row(237)], documentStatuses: {}, warnings: [] });
  await settle();
  assert.equal(ctx.root().querySelectorAll(".cr-main-table tbody tr").length, 0);
});

test("quadrado 2 abre o relatório de presenças e Voltar retorna ao seletor", async t => {
  const ctx = setup(t, {}, { async loadSnapshot() { return { presences: [], launchesById: {}, supplierStatusByName: {}, warnings: [] }; } });
  await ctx.view.open();
  const tile = ctx.root().querySelector('[data-report-id="2"]');
  assert.equal(tile.disabled, false);
  click(ctx.dom.window, tile); await settle();
  assert.match(ctx.root().textContent, /PRESENÇAS VINCULADAS POR PEDIDO/);
  assert.equal(ctx.root().querySelector(".pp-report").hidden, false);
  click(ctx.dom.window, ctx.root().querySelector(".cr-header button"));
  assert.equal(ctx.root().querySelector(".cr-hub").hidden, false);
  assert.equal(ctx.root().querySelector(".pp-report").hidden, true);
});
