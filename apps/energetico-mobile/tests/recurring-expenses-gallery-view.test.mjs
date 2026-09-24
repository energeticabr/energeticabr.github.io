import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

async function setup(t, overrides = {}) {
  const module = await import("../src/ui/recurring-expenses-gallery-view.js");
  assert.equal(typeof module.createRecurringExpensesGallery, "function");
  const dom = new JSDOM("<main id=app></main>", { url: "https://example.test" });
  const rows = overrides.rows || [{ id: "33", hasAttachments: true, fields: {
    ID: 33,
    DESCRICAOPGTO: "TARIFA DE ENERGIA (TODOS)",
    FORNECEDOR: { LookupValue: "CEMIG" },
    EQUIPAMENTO: "TARIFA DE ENERGIA",
    IMOVEL: "TODOS",
    FILIAL: "004 - EDIFÍCIO XAVANTE",
    "VALOR MENSAL": "144,92",
    FORMAPGTO: "ENERGÉTICA - CAIXA",
    "RESPONSAVEL LOCACAO": "BERNARDO",
    RECORRENCIA: "Month",
    DATAINICIO: "2026-07-27T03:00:00Z",
    DATAFIM: "2026-11-04T03:00:00Z",
    STATUS: "ATIVO",
    EQUIPAMENTO: "ENERGIA OBRA",
    "Tem anexos": true,
    Criado: "2026-07-27T19:07:00Z",
    "Criado por": "BERNARDO NOTINI",
    Modificado: "2026-09-03T13:00:00Z",
    "Modificado por": "BERNARDO NOTINI",
  } }];
  const calls = [];
  const data = {
    async loadSnapshot(options) { calls.push(["snapshot", options]); return { listName: "DESPESASRECORRENTES", rows }; },
    async listAttachments(id) { calls.push(["listAttachments", id]); return [{ fileName: "conta.pdf", mimeType: "application/pdf", size: 1024 }]; },
    async downloadAttachment(id, name) { calls.push(["downloadAttachment", id, name]); return new Blob(["pdf"], { type: "application/pdf" }); },
    ...overrides.data,
  };
  const gallery = module.createRecurringExpensesGallery({
    document: dom.window.document,
    data,
    now: () => new Date("2026-09-23T12:00:00-03:00"),
    ...overrides,
  });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  return { dom, gallery, data, calls, root: () => dom.window.document.querySelector(".re-overlay") };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
function button(root, label) {
  const found = [...root.querySelectorAll("button")].find(node => node.textContent.trim() === label && !node.closest("[hidden]"));
  assert.ok(found, `visible button: ${label}`);
  return found;
}
function choose(ctx, name, value) {
  const control = ctx.root().querySelector(`[name="${name}"]`);
  assert.ok(control, `filter ${name} exists`);
  control.value = value;
  control.dispatchEvent(new ctx.dom.window.Event("change", { bubbles: true }));
}

test("G19 mostra campos de despesas, recorrência em português, moeda e datas brasileiras", async t => {
  const ctx = await setup(t);
  await ctx.gallery.open();

  assert.equal(ctx.root().getAttribute("role"), "dialog");
  assert.match(ctx.root().querySelector("h1").textContent, /GALERIA DESPESAS RECORRENTES/i);
  for (const name of ["search", "id", "property", "branch", "supplier", "product", "responsible", "paymentMethod", "status", "recurrence"]) {
    assert.ok(ctx.root().querySelector(`[name="${name}"]`), `G19 filter ${name}`);
  }
  assert.deepEqual([...ctx.root().querySelectorAll(".re-card")].map(card => card.dataset.itemId), ["33"]);
  const cardText = ctx.root().querySelector(".re-card").textContent;
  assert.match(cardText, /TARIFA DE ENERGIA/);
  assert.match(cardText, /CEMIG/);
  assert.match(cardText, /Mensal/);
  assert.match(cardText, /R\$\s*144,92/);
  assert.match(cardText, /27\/07\/2026/);
  assert.match(cardText, /04\/11\/2026/);
  assert.match(cardText, /ATIVO/);
  assert.equal(ctx.root().querySelectorAll('[data-action="edit"], [data-action="delete"]').length, 0);
});

test("pesquisa e filtros G19 combinam localmente sem recarregar dados", async t => {
  const rows = [
    { id: "33", hasAttachments: false, fields: { ID: 33, FORNECEDOR: "CEMIG", EQUIPAMENTO: "ENERGIA OBRA", RECORRENCIA: "Month", STATUS: "ATIVO" } },
    { id: "30", hasAttachments: false, fields: { ID: 30, FORNECEDOR: "PREFEITURA", EQUIPAMENTO: "IPTU SALA 904", RECORRENCIA: "Year", STATUS: "ATIVO" } },
    { id: "29", hasAttachments: false, fields: { ID: 29, FORNECEDOR: "CEMIG", EQUIPAMENTO: "ENERGIA ESCRITÓRIO", RECORRENCIA: "Month", STATUS: "INATIVO" } },
  ];
  const ctx = await setup(t, { rows });
  await ctx.gallery.open();
  ctx.root().querySelector('[name="search"]').value = "energia";
  choose(ctx, "supplier", "CEMIG");
  choose(ctx, "recurrence", "Mensal");
  choose(ctx, "status", "ATIVO");
  button(ctx.root(), "Aplicar filtros").click();
  await settle();

  assert.deepEqual([...ctx.root().querySelectorAll(".re-card")].map(card => card.dataset.itemId), ["33"]);
  assert.equal(ctx.calls.filter(([name]) => name === "snapshot").length, 1);
  assert.match(ctx.root().querySelector(".re-list-status").textContent, /1 despesa recorrente/i);
});

test("detalhes escapam texto e anexos abrem no visualizador compartilhado", async t => {
  const rows = [{ id: "33", hasAttachments: true, fields: {
    ID: 33, DESCRICAOPGTO: "TARIFA <img src=x onerror=alert(1)>", "VALOR MENSAL": "144,92", RECORRENCIA: "Month",
    DATAINICIO: "2026-07-27T03:00:00Z", STATUS: "ATIVO", Criado: "2026-07-27T19:07:00Z",
  } }];
  const opened = [];
  const ctx = await setup(t, { rows, openMediaCollection: async items => opened.push(items) });
  await ctx.gallery.open();
  button(ctx.root(), "Detalhes").click();
  const detail = ctx.root().querySelector(".re-detail");
  assert.equal(detail.getAttribute("role"), "dialog");
  assert.match(detail.textContent, /27\/07\/2026/);
  assert.match(detail.textContent, /R\$\s*144,92/);
  assert.equal(detail.querySelector("img, [onerror]"), null);
  assert.match(detail.textContent, /TARIFA <img src=x onerror=alert\(1\)>/);
  button(detail, "Fechar detalhes").click();

  ctx.root().querySelector('.re-card[data-item-id="33"] [data-action="attachments"]').click();
  await settle();
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0].map(item => item.fileName), ["conta.pdf"]);
  assert.equal((await opened[0][0].source).type, "application/pdf");
  assert.deepEqual(ctx.calls.slice(-2), [["listAttachments", "33"], ["downloadAttachment", "33", "conta.pdf"]]);
});

test("pagina resultados extensos e usa um layout responsivo", async t => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    id: String(index + 1),
    hasAttachments: false,
    fields: { ID: index + 1, DESCRICAOPGTO: `DESPESA ${index + 1}`, STATUS: "ATIVO" },
  }));
  const ctx = await setup(t, { rows });
  await ctx.gallery.open();
  assert.equal(ctx.root().querySelectorAll(".re-card").length, 10);
  button(ctx.root(), "Próxima página").click();
  assert.deepEqual([...ctx.root().querySelectorAll(".re-card")].map(card => card.dataset.itemId), ["2", "1"]);
  assert.match(ctx.root().querySelector(".og-page-label").textContent, /Página 2 de 2/);

  const styles = readFileSync(new URL("../src/ui/orders-gallery.css", import.meta.url), "utf8");
  assert.match(styles, /\.re-filter-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(styles, /\.re-cards\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
});
