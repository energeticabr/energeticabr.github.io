import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

async function setup(t, overrides = {}) {
  const module = await import("../src/ui/payment-programming-gallery-view.js");
  assert.equal(typeof module.createPaymentProgrammingGallery, "function", "createPaymentProgrammingGallery must be implemented");
  const dom = new JSDOM("<main id=app></main>", { url: "https://example.test" });
  const document = dom.window.document;
  const rows = overrides.rows || [
    { id: "306", hasAttachments: true, fields: {
      ID: 306, FORNECEDOR: "DIBRITA", OBS: "Compra de brita", "DATA PREVISTO PGTO": "2026-09-23T03:00:00Z",
      "DATA PGTO EFETUADO": "", STATUS: "PAGAMENTO PREVISTO", "VALOR TOTAL": 120, QTD: 10,
      DESCRICAOPGTO: "BRITA (10 M3 DE BRITA)", APROVACAO: "PENDENTE", FILIAL: "004 - EDIFÍCIO XAVANTE",
      IMOVEL: "TODOS", IDPEDIDO: "", IDLANCAMENTOS: "", IDRECORRENCIA: "10 M3 DE BRITA", PGTOAGENDADO: "PENDENTE",
    } },
    { id: "310", hasAttachments: false, fields: {
      ID: 310, FORNECEDOR: "ML COMERCIO", OBS: "Compra de cimento", "DATA PREVISTO PGTO": "2026-09-24T03:00:00Z",
      "DATA PGTO EFETUADO": "2026-09-24T13:00:00Z", STATUS: "PAGO", "VALOR TOTAL": 1710, QTD: 30,
      DESCRICAOPGTO: "CIMENTO", APROVACAO: "APROVADO", FILIAL: "004 - EDIFÍCIO XAVANTE", IMOVEL: "OBRA A",
      IDPEDIDO: "320", IDLANCAMENTOS: "3429", IDRECORRENCIA: "", PGTOAGENDADO: "PAGO",
      DATAPGTOAGENDADO: "2026-09-23T03:00:00Z", DATAEXECUCAOAGENDAMENTO: "2026-09-24T03:00:00Z",
      Criado: "2026-09-22T01:00:00Z", Modificado: "2026-09-22T01:00:00Z",
    } },
  ];
  const calls = [];
  const data = {
    async loadSnapshot(options) { calls.push(["snapshot", options]); return { listName: "PROVISÃO PGTOS", rows }; },
    async listAttachments(id) { calls.push(["listAttachments", id]); return [{ fileName: "nota.pdf", mimeType: "application/pdf", size: 2048 }]; },
    async downloadAttachment(id, name) { calls.push(["downloadAttachment", id, name]); return new Blob(["pdf"], { type: "application/pdf" }); },
    ...overrides.data,
  };
  const gallery = module.createPaymentProgrammingGallery({ document, data, now: () => new Date("2026-09-23T12:00:00-03:00"), ...overrides });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  return { dom, document, gallery, data, calls, root: () => document.querySelector(".pg-overlay") };
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

test("G28 abre galeria somente de consulta com filtros, valores e datas em formato brasileiro", async t => {
  const ctx = await setup(t);
  await ctx.gallery.open();

  assert.equal(ctx.root().getAttribute("role"), "dialog");
  assert.match(ctx.root().querySelector("h1").textContent, /GALERIA PROGRAMAÇÃO DE PAGAMENTOS/i);
  for (const name of ["search", "recurrenceId", "type", "product", "supplier", "status", "branch", "property"]) {
    assert.ok(ctx.root().querySelector(`[name="${name}"]`), `G28 filter ${name}`);
  }
  assert.deepEqual([...ctx.root().querySelectorAll(".pg-card")].map(card => card.dataset.itemId), ["306", "310"]);
  assert.match(ctx.root().querySelector(".pg-cards").textContent, /23\/09\/2026/);
  assert.match(ctx.root().querySelector(".pg-cards").textContent, /24\/09\/2026/);
  assert.match(ctx.root().querySelector(".pg-cards").textContent, /DIBRITA/);
  assert.match(ctx.root().querySelector(".pg-cards").textContent, /1\.200,00/);
  assert.match(ctx.root().querySelector(".pg-cards").textContent, /PAGAMENTO PREVISTO/);
  assert.match(ctx.root().querySelector(".pg-cards").textContent, /VENCE HOJE/);
  assert.match(ctx.root().querySelector('.pg-card[data-item-id="306"]').textContent, /PGTO NÃO AGENDADO/);
  assert.match(ctx.root().querySelector('.pg-card[data-item-id="310"]').textContent, /AGENDAMENTO\s*PGTO PAGO/);
  assert.match(ctx.root().querySelector('.pg-card[data-item-id="310"]').textContent, /PAGO EM 24\/09\/2026/);
  assert.equal(ctx.root().querySelectorAll('[data-action="edit"], [data-action="delete"]').length, 0);
});

test("filtros de recorrência, tipo, produto, fornecedor, status, filial e imóvel combinam localmente", async t => {
  const ctx = await setup(t);
  await ctx.gallery.open();
  ctx.root().querySelector('[name="search"]').value = "compra de brita";
  choose(ctx, "recurrenceId", "10 M3 DE BRITA");
  choose(ctx, "type", "NÃO AGENDADO");
  choose(ctx, "product", "BRITA (10 M3 DE BRITA)");
  choose(ctx, "supplier", "DIBRITA");
  choose(ctx, "status", "PAGAMENTO PREVISTO");
  choose(ctx, "branch", "004 - EDIFÍCIO XAVANTE");
  choose(ctx, "property", "TODOS");
  button(ctx.root(), "Aplicar filtros").click();
  await settle();

  assert.deepEqual([...ctx.root().querySelectorAll(".pg-card")].map(card => card.dataset.itemId), ["306"]);
  assert.match(ctx.root().querySelector(".pg-list-status").textContent, /1 pagamento/i);
});

test("detalhes G28 apresentam os campos numa tabela segura e anexos usam o visualizador compartilhado", async t => {
  const rows = [{ id: "306", hasAttachments: true, fields: {
    ID: 306, FORNECEDOR: "DIBRITA", OBS: "texto <img src=x onerror=alert(1)>", "DATA PREVISTO PGTO": "2026-09-23T03:00:00Z",
    "DATA PGTO EFETUADO": "", STATUS: "PAGAMENTO PREVISTO", "VALOR TOTAL": "1.200,50", QTD: 10,
    DESCRICAOPGTO: "BRITA", APROVACAO: "PENDENTE", FILIAL: "004 - EDIFÍCIO XAVANTE", IMOVEL: "TODOS",
    IDPEDIDO: "", IDLANCAMENTOS: "", IDRECORRENCIA: "REC-10", PGTOAGENDADO: false, Criado: "2026-09-20T03:00:00Z",
  } }];
  const opened = [];
  const ctx = await setup(t, { rows, openMediaCollection: async items => opened.push(items) });
  await ctx.gallery.open();
  button(ctx.root(), "Detalhes").click();
  const detail = ctx.root().querySelector(".pg-detail");
  assert.equal(detail.getAttribute("role"), "dialog");
  assert.ok(detail.querySelector("table"));
  assert.match(detail.textContent, /23\/09\/2026/);
  assert.match(detail.textContent, /texto <img src=x onerror=alert\(1\)>/);
  assert.equal(detail.querySelector("img, [onerror]"), null);
  assert.match(detail.textContent, /R\$\s?12\.005,00/);
  button(detail, "Fechar detalhes").click();

  ctx.root().querySelector('.pg-card[data-item-id="306"] [data-action="attachments"]').click();
  await settle();
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0].map(item => item.fileName), ["nota.pdf"]);
  assert.equal((await opened[0][0].source).type, "application/pdf");
});

test("vencimento ignora a data de agendamento e não marca pagamento sem vencimento como atrasado", async t => {
  const rows = [
    { id: "406", hasAttachments: false, fields: {
      ID: 406, FORNECEDOR: "VENCIMENTO FUTURO", "DATA PREVISTO PGTO": "2026-09-25T03:00:00Z",
      DATAPGTOAGENDADO: "2020-09-23T03:00:00Z", DATAEXECUCAOAGENDAMENTO: "2020-09-24T03:00:00Z",
      PGTOAGENDADO: "PAGAMENTO AGENDADO", STATUS: "PAGAMENTO PREVISTO",
    } },
    { id: "401", hasAttachments: false, fields: {
      ID: 401, FORNECEDOR: "SEM DATA DE VENCIMENTO", "DATA PREVISTO PGTO": null,
      DATAPGTOAGENDADO: "2026-09-22T03:00:00Z", PGTOAGENDADO: "PAGAMENTO AGENDADO",
      STATUS: "PAGAMENTO PREVISTO",
    } },
  ];
  const ctx = await setup(t, { rows });
  await ctx.gallery.open();
  assert.deepEqual([...ctx.root().querySelectorAll(".pg-card")].map(card => card.dataset.itemId), ["406", "401"]);
  assert.match(ctx.root().querySelector('.pg-card[data-item-id="406"]').textContent, /VENCERÁ EM 2 DIAS/);
  assert.equal(ctx.root().querySelector('.pg-card[data-item-id="401"] .pg-deadline'), null);
});

test("datas de criação e modificação mostram o dia local de São Paulo", async t => {
  const rows = [{ id: "500", hasAttachments: false, fields: {
    ID: 500, FORNECEDOR: "FORNECEDOR", STATUS: "PAGAMENTO PREVISTO",
    Criado: "2026-09-22T01:00:00Z", Modificado: "2026-09-22T01:00:00Z",
  } }];
  const ctx = await setup(t, { rows });
  await ctx.gallery.open();
  button(ctx.root(), "Detalhes").click();
  assert.match(ctx.root().querySelector(".pg-detail").textContent, /21\/09\/2026/);
});

test("PGTOAGENDADO=PAGO não é classificado como agendado e filtra como PAGO", async t => {
  const rows = [
    { id: "777", hasAttachments: false, fields: {
      ID: 777, FORNECEDOR: "PAGO", STATUS: "PAGAMENTO EFETUADO", PGTOAGENDADO: "PAGO",
      "DATA PGTO EFETUADO": "2026-09-23T03:00:00Z", DATAPGTOAGENDADO: "2026-09-22T03:00:00Z",
      DATAEXECUCAOAGENDAMENTO: "2026-09-23T03:00:00Z",
    } },
    { id: "778", hasAttachments: false, fields: {
      ID: 778, FORNECEDOR: "AGENDADO", STATUS: "PAGAMENTO PREVISTO", PGTOAGENDADO: "PAGAMENTO AGENDADO",
      DATAPGTOAGENDADO: "2026-09-24T03:00:00Z", DATAEXECUCAOAGENDAMENTO: "2026-09-25T03:00:00Z",
    } },
  ];
  const ctx = await setup(t, { rows });
  await ctx.gallery.open();
  const scheduleField = [...ctx.root().querySelectorAll('.pg-card[data-item-id="777"] .pg-card-field')]
    .find(pair => pair.querySelector("dt")?.textContent === "AGENDAMENTO");
  assert.equal(scheduleField.querySelector("dd").textContent, "PGTO PAGO");

  choose(ctx, "type", "PAGO");
  button(ctx.root(), "Aplicar filtros").click();
  assert.deepEqual([...ctx.root().querySelectorAll(".pg-card")].map(card => card.dataset.itemId), ["777"]);
});

test("paginação permite percorrer uma lista G28 maior que a página", async t => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    id: String(400 + index),
    hasAttachments: false,
    fields: { ID: 400 + index, FORNECEDOR: `FORNECEDOR ${index}`, STATUS: "PAGAMENTO PREVISTO", "DATA PREVISTO PGTO": `2026-10-${String(index + 1).padStart(2, "0")}` },
  }));
  const ctx = await setup(t, { rows });
  await ctx.gallery.open();
  assert.equal(ctx.root().querySelectorAll(".pg-card").length, 10);
  button(ctx.root(), "Próxima página").click();
  assert.deepEqual([...ctx.root().querySelectorAll(".pg-card")].map(card => card.dataset.itemId), ["410", "411"]);
  assert.match(ctx.root().querySelector(".og-page-label").textContent, /Página 2 de 2/);
});

test("falha da lista SharePoint fica visível com opção de tentar novamente", async t => {
  let loads = 0;
  const ctx = await setup(t, { data: {
    async loadSnapshot() {
      loads++;
      if (loads === 1) throw new Error("A lista PROVISÃO PGTOS não está disponível nesta conta SharePoint.");
      return { rows: [] };
    },
  } });
  await ctx.gallery.open();
  assert.equal(ctx.root().querySelector(".pg-notice").getAttribute("role"), "alert");
  assert.match(ctx.root().querySelector(".pg-notice").textContent, /não está disponível/i);
  assert.match(ctx.root().querySelector(".pg-list-status").textContent, /Não foi possível carregar/i);
  button(ctx.root(), "Tentar novamente").click();
  await settle();
  assert.equal(loads, 2);
  assert.match(ctx.root().querySelector(".pg-list-status").textContent, /Nenhum pagamento/i);
});

test("layout G28 mantém filtros em duas colunas no celular e lista os pagamentos em cartões largos", () => {
  const styles = readFileSync(new URL("../src/ui/orders-gallery.css", import.meta.url), "utf8");
  assert.match(styles, /\.pg-filter-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(styles, /\.pg-cards\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(styles, /\.pg-card-fields\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(styles, /\.pg-deadline--today[^}]*color:/s);
  assert.match(styles, /\.pg-deadline--overdue[^}]*color:/s);
});
