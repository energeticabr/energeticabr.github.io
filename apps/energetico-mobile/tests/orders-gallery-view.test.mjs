import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

async function setup(t, overrides = {}) {
  const module = await import("../src/ui/orders-gallery-view.js").catch(error => {
    if (error.code === "ERR_MODULE_NOT_FOUND" && error.message.includes("orders-gallery-view.js")) return {};
    throw error;
  });
  assert.equal(typeof module.createOrdersGallery, "function", "createOrdersGallery must be implemented");
  const dom = new JSDOM('<button id="origin">Pedidos</button><main id="chat"></main>', { url: "https://example.test" });
  const document = dom.window.document;
  const calls = [];
  const rows = overrides.rows || [
    { id: "319", hasAttachments: true, fields: { ID: "319", FILIAL: "004 - EDIFÍCIO XAVANTE", FORNECEDOR: "IMPERMATEX", FORMAPGTO: "CAIXA", VALORTOTAL: 650, STATUS: "PENDENTE AUDITORIA", "NOTA FISCAL": "PENDENTE", OBS: "Pedido <img src=x onerror=alert(1)>", Criado: "2026-09-20T02:00:00Z", Modificado: "2026-09-21T17:00:00Z" } },
    { id: "320", hasAttachments: false, fields: { ID: "320", FILIAL: "004 - EDIFÍCIO XAVANTE", FORNECEDOR: "COFER", FORMAPGTO: "ENERGÉTICA - CAIXA", VALORTOTAL: 765.6, STATUS: "PAGO", "NOTA FISCAL": "NF-55", Criado: "2026-09-21T17:12:00Z", "Criado por": "Bernardo Notini", Modificado: "2026-09-21T17:12:00Z", "Modificado por": "Bernardo Notini" } },
    { id: "318", hasAttachments: true, fields: { ID: "318", FILIAL: "001 - CENTRAL", FORNECEDOR: "RAFAEL", FORMAPGTO: "CAIXA", VALORTOTAL: 100, STATUS: "PENDENTE", "NOTA FISCAL": "NF-10", Criado: "2026-09-19T10:00:00Z", Modificado: "2026-09-20T10:00:00Z" } },
  ];
  const data = {
    async loadSnapshot(options) { calls.push(["snapshot", options]); return { listName: "NOTASPENDENTES", rows }; },
    async listAttachments(id) { calls.push(["listAttachments", id]); return [{ fileName: "pedido.pdf", mimeType: "application/pdf", size: 2048 }, { fileName: "foto.jpg", mimeType: "image/jpeg", size: 4096 }]; },
    async downloadAttachment(id, fileName) { calls.push(["downloadAttachment", id, fileName]); return new Blob([fileName], { type: fileName.endsWith(".pdf") ? "application/pdf" : "image/jpeg" }); },
    ...overrides.data,
  };
  const gallery = module.createOrdersGallery({ document, data, ...overrides });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  return { dom, document, gallery, data, calls, root: () => document.querySelector(".og-overlay") };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
function button(root, text) {
  const found = [...root.querySelectorAll("button")].find(node => node.textContent.trim() === text && !node.closest("[hidden]"));
  assert.ok(found, `visible button: ${text}`);
  return found;
}
function setInput(ctx, name, value) {
  const field = ctx.root().querySelector(`[name="${name}"]`);
  assert.ok(field, `field ${name} exists`);
  field.value = value;
  field.dispatchEvent(new ctx.dom.window.Event("input", { bubbles: true }));
  field.dispatchEvent(new ctx.dom.window.Event("change", { bubbles: true }));
}

test("orders gallery opens read-only, sorts by descending ID and offers Screen10 filters and page sizes", async t => {
  const ctx = await setup(t);
  await ctx.gallery.open();
  assert.equal(ctx.root().getAttribute("role"), "dialog");
  assert.match(ctx.root().querySelector("h1").textContent, /Galeria Pedidos/i);
  assert.deepEqual([...ctx.root().querySelectorAll(".og-card")].map(card => card.dataset.itemId), ["320", "319", "318"]);
  for (const name of ["search", "branch", "supplier", "status", "total", "id", "paymentForm", "invoice", "sort", "pageSize"]) {
    assert.ok(ctx.root().querySelector(`[name="${name}"]`), `Screen10/admin filter ${name}`);
  }
  assert.deepEqual([...ctx.root().querySelector('[name="pageSize"]').options].map(option => option.value), ["10", "20", "50", "100"]);
  assert.match(ctx.root().querySelector(".og-metrics").textContent, /3/);
  assert.equal(ctx.root().querySelectorAll('[data-action="edit"], [data-action="delete"]').length, 0);
});

test("Screen10 filters refine rows and page navigation applies selected page size", async t => {
  const ctx = await setup(t);
  await ctx.gallery.open();
  setInput(ctx, "supplier", "COFER");
  setInput(ctx, "pageSize", "10");
  button(ctx.root(), "Aplicar filtros").click();
  await settle();
  assert.deepEqual([...ctx.root().querySelectorAll(".og-card")].map(card => card.dataset.itemId), ["320"]);
  assert.match(ctx.root().querySelector(".og-list-status").textContent, /1 pedido/i);
  setInput(ctx, "supplier", "");
  setInput(ctx, "pageSize", "10");
  button(ctx.root(), "Aplicar filtros").click();
  await settle();
  assert.equal(ctx.root().querySelector('[name="sort"]').value, "id-desc");
  assert.equal(button(ctx.root(), "Próxima página").disabled, true);
});

test("page size and navigation paginate the complete local SharePoint snapshot", async t => {
  const rows = Array.from({ length: 22 }, (_, index) => ({ id: String(500 - index), fields: { ID: String(500 - index), FORNECEDOR: `Fornecedor ${index}` } }));
  const ctx = await setup(t, { rows });
  await ctx.gallery.open();
  assert.equal(ctx.root().querySelectorAll(".og-card").length, 10);
  button(ctx.root(), "Próxima página").click();
  assert.equal(ctx.root().querySelectorAll(".og-card").length, 10);
  setInput(ctx, "pageSize", "20");
  button(ctx.root(), "Aplicar filtros").click();
  assert.equal(ctx.root().querySelectorAll(".og-card").length, 20);
  assert.match(ctx.root().querySelector(".og-page-label").textContent, /Página 1 de 2/);
});

test("Screen10 dates render as dd/mm/yyyy and untrusted SharePoint values stay text", async t => {
  const ctx = await setup(t);
  await ctx.gallery.open();
  assert.match(ctx.root().querySelector(".og-cards").textContent, /20\/09\/2026|19\/09\/2026/);
  const cardPairs = [...ctx.root().querySelectorAll('.og-card[data-item-id="320"] .og-card-field')]
    .map(pair => [pair.querySelector("dt").textContent, pair.querySelector("dd").textContent]);
  assert.ok(cardPairs.some(([label, value]) => label === "CRIADO POR" && value === "Bernardo Notini"));
  assert.ok(cardPairs.some(([label, value]) => label === "MODIFICADO POR" && value === "Bernardo Notini"));
  assert.doesNotMatch(ctx.root().querySelector(".og-cards").textContent, /2026-09-20T02:00:00Z/);
  assert.match(ctx.root().querySelector(".og-cards").textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(ctx.root().querySelector(".og-cards img, .og-cards [onerror]"), null);
});

test("details open in a modal table with Screen10 fields and safely formatted values", async t => {
  const ctx = await setup(t);
  await ctx.gallery.open();
  button(ctx.root(), "Detalhes").click();
  await settle();
  const panel = ctx.root().querySelector(".og-detail");
  assert.equal(panel.getAttribute("role"), "dialog");
  assert.ok(panel.querySelector("table.og-data-table"));
  for (const name of ["ID", "FILIAL", "FORNECEDOR", "FORMAPGTO", "VALORTOTAL", "STATUS", "NOTA FISCAL"]) assert.match(panel.textContent, new RegExp(name));
  assert.doesNotMatch(panel.innerHTML, /<img|onerror=/i);
  button(panel, "Fechar detalhes").click();
  assert.equal(panel.hidden, true);
});

test("SharePoint attachments open as a navigable collection in the shared viewer", async t => {
  const opened = [];
  const ctx = await setup(t, { openMediaCollection: async items => { opened.push(items); } });
  await ctx.gallery.open();
  ctx.root().querySelector('.og-card[data-item-id="319"] [data-action="attachments"]').click();
  await settle();
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0].map(item => item.fileName), ["pedido.pdf", "foto.jpg"]);
  assert.equal((await opened[0][0].source).type, "application/pdf");
  assert.deepEqual(ctx.calls.filter(([name]) => name === "downloadAttachment").map(call => call.slice(1)), [["319", "pedido.pdf"], ["319", "foto.jpg"]]);
});

test("orders with attachments show a full-height attachment rail on the left, beside the order details", async t => {
  const ctx = await setup(t);
  await ctx.gallery.open();
  const card = ctx.root().querySelector('.og-card[data-item-id="319"]');
  const rail = card.querySelector(".og-card-attachment-rail");
  const main = card.querySelector(".og-card-main");
  assert.ok(rail, "attachment control occupies a dedicated left rail");
  assert.ok(card.classList.contains("og-card--with-attachments"), "attached orders activate the side-by-side layout");
  assert.ok(main, "order information remains grouped in the right-hand content area");
  assert.ok(rail.compareDocumentPosition(main) & ctx.dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(rail.dataset.action, "attachments");
  assert.ok(main.querySelector(".og-card-heading"));
  assert.ok(main.querySelector(".og-card-fields"));
  assert.ok(main.querySelector('[data-action="details"]'));
  const withoutAttachments = ctx.root().querySelector('.og-card[data-item-id="320"]');
  assert.equal(withoutAttachments.querySelector(".og-card-attachment-rail"), null,
    "orders without attachments keep the full-width card layout");
  assert.equal(withoutAttachments.classList.contains("og-card--with-attachments"), false);
});

test("offers attachment access when the Graph list payload does not expose attachment presence", async t => {
  const ctx = await setup(t, { rows: [{ id: "500", fields: { ID: "500", FORNECEDOR: "COFER" } }] });
  await ctx.gallery.open();
  assert.ok(ctx.root().querySelector('.og-card[data-item-id="500"] [data-action="attachments"]'));
  assert.match(ctx.root().querySelector(".og-metrics").textContent, /—/);
});

test("load failures expose a retry, and close invalidates pending snapshots", async t => {
  let attempts = 0;
  const ctx = await setup(t, { data: { async loadSnapshot() { if (!attempts++) throw new Error("Sem conexão"); return { rows: [] }; } } });
  await ctx.gallery.open();
  assert.match(ctx.root().textContent, /Sem conexão/);
  button(ctx.root(), "Tentar novamente").click();
  await settle();
  assert.match(ctx.root().textContent, /Nenhum pedido/);
  ctx.gallery.close();
  assert.equal(ctx.root().hidden, true);
});
