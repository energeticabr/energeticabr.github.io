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
    async listAttachments(id, options) { assert.deepEqual(options, { refresh: true }); calls.push(["listAttachments", id]); return [{ fileName: "nota.pdf", mimeType: "application/pdf", size: 2048 }]; },
    async downloadAttachment(id, name) { calls.push(["downloadAttachment", id, name]); return new Blob(["pdf"], { type: "application/pdf" }); },
    ...overrides.data,
  };
  const { data: dataOverrides = {}, ...galleryOverrides } = overrides;
  const gallery = module.createPaymentProgrammingGallery({ document, data: { ...data, ...dataOverrides },
    now: () => new Date("2026-09-23T12:00:00-03:00"), ...galleryOverrides });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  return { dom, document, gallery, data, calls, root: () => document.querySelector(".pg-overlay") };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test("G28 coloca o carregamento acima do conteúdo e libera controles após a resposta", async t => {
  const request = deferred();
  const ctx = await setup(t, { data: { loadSnapshot: () => request.promise } });
  const opening = ctx.gallery.open();
  const layer = ctx.root().querySelector(".pg-loading-layer");
  assert.ok(layer, "carregamento precisa de uma camada própria fora da ordenação");
  assert.equal(layer.hidden, false);
  assert.ok(layer.querySelector(".app-loading__mascot"));
  assert.ok(layer.querySelector(".app-loading__spinner"));
  assert.equal(ctx.root().querySelector(".pg-list-toolbar .app-loading"), null);
  assert.equal(ctx.root().querySelector(".og-content").inert, true);
  assert.equal(ctx.root().querySelector(".og-content").getAttribute("aria-hidden"), "true");
  assert.equal(ctx.root().querySelector('[name="sort"]').disabled, true);
  assert.equal(button(ctx.root(), "Voltar").disabled, false);
  assert.equal(button(ctx.root(), "Início").disabled, false);
  request.resolve({ rows: [] });
  await opening;
  assert.equal(layer.hidden, true);
  assert.equal(ctx.root().querySelector(".og-content").inert, false);
  assert.equal(ctx.root().querySelector(".og-content").hasAttribute("aria-hidden"), false);
  assert.equal(ctx.root().querySelector('[name="sort"]').disabled, false);
  assert.equal(ctx.root().getAttribute("aria-busy"), "false");
});

test("G28 mantém os cartões ao fundo da atualização e remove a camada mesmo em falha", async t => {
  const request = deferred();
  let refreshing = false;
  const ctx = await setup(t, { data: { loadSnapshot: async () => refreshing ? request.promise : { rows: [
    { id: "300", hasAttachments: false, fields: { ID: 300, FORNECEDOR: "VIVO", STATUS: "PAGAMENTO PREVISTO" } },
  ] } } });
  await ctx.gallery.open();
  refreshing = true;
  const reload = ctx.gallery.reload();
  assert.equal(ctx.root().querySelectorAll(".pg-card").length, 1, "refresh não apaga dados ao fundo");
  assert.equal(ctx.root().querySelector(".pg-loading-layer").hidden, false);
  request.reject(new Error("sem conexão"));
  await reload;
  assert.equal(ctx.root().querySelector(".pg-loading-layer").hidden, true);
  assert.equal(ctx.root().querySelector(".og-content").inert, false);
  assert.equal(button(ctx.root(), "Tentar novamente").disabled, false);
});

test("G28 mantém o novo carregamento quando uma resposta antiga chega após reabrir", async t => {
  const oldRequest = deferred(), newRequest = deferred();
  let calls = 0;
  const ctx = await setup(t, { data: { loadSnapshot: () => (++calls === 1 ? oldRequest.promise : newRequest.promise) } });
  const first = ctx.gallery.open();
  ctx.gallery.close();
  assert.equal(ctx.root().querySelector(".pg-loading-layer")?.hidden, true);
  const second = ctx.gallery.open();
  oldRequest.resolve({ rows: [] });
  await first;
  assert.equal(ctx.root().querySelector(".pg-loading-layer").hidden, false);
  assert.equal(ctx.root().querySelector(".og-content").inert, true);
  newRequest.resolve({ rows: [] });
  await second;
  assert.equal(ctx.root().querySelector(".pg-loading-layer").hidden, true);
});
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
  assert.equal(ctx.root().querySelector("details.pg-filters")?.open, false, "filtros de pagamentos começam recolhidos");
  assert.match(ctx.root().querySelector("h1").textContent, /GALERIA PROGRAMAÇÃO DE PAGAMENTOS/i);
  for (const name of ["search", "recurrenceId", "type", "product", "supplier", "status", "branch", "property"]) {
    assert.ok(ctx.root().querySelector(`[name="${name}"]`), `G28 filter ${name}`);
  }
  assert.equal(ctx.root().querySelector('[name="status"]').value, "PAGAMENTO PREVISTO");
  assert.equal(ctx.root().querySelector(".pg-filters summary").textContent, "Filtros");
  assert.ok(ctx.root().querySelector(".pg-filters summary svg"), "o filtro compacto usa o ícone de funil da referência");
  assert.equal(ctx.root().querySelector(".pg-filters [name=sort]"), null,
    "the order selector stays outside the collapsible filters");
  const order = ctx.root().querySelector(".pg-list-toolbar [name=sort]");
  assert.ok(order, "the list toolbar exposes the ordering selector");
  assert.deepEqual([...order.options].map(option => option.textContent), [
    "Todos", "Vencimento mais próximo", "Vencimento mais distante", "Maior ID", "Modificado recentemente",
  ]);
  assert.equal(order.value, "due-asc");
  assert.deepEqual([...ctx.root().querySelectorAll(".pg-card")].map(card => card.dataset.itemId), ["306"]);
  assert.equal(ctx.root().querySelectorAll('.pg-card [data-action="details"]').length, 0, "payment data opens from its edit pencil");
  assert.equal(ctx.root().querySelectorAll('.pg-card [data-gallery-action="edit"]').length, 1);
  assert.equal([...ctx.root().querySelectorAll("button")].some(node => node.textContent.trim() === "Aplicar filtros"), false);
  assert.match(ctx.root().querySelector(".pg-cards").textContent, /23\/09\/2026/);
  assert.match(ctx.root().querySelector(".pg-cards").textContent, /DIBRITA/);
  assert.match(ctx.root().querySelector(".pg-cards").textContent, /1\.200,00/);
  assert.equal(ctx.root().querySelector('.pg-card[data-item-id="306"] .pg-status'), null,
    "o status previsto não aparece duas vezes quando o prazo está visível");
  assert.match(ctx.root().querySelector(".pg-cards").textContent, /VENCE HOJE/);
  assert.match(ctx.root().querySelector('.pg-card[data-item-id="306"]').textContent, /PGTO NÃO AGENDADO/);
  choose(ctx, "status", "PAGO");
  assert.deepEqual([...ctx.root().querySelectorAll(".pg-card")].map(card => card.dataset.itemId), ["310"]);
  assert.equal(ctx.root().querySelector(".pg-list-status").textContent, "1 pagamento(s)",
    "a contagem não chama pagamentos quitados de previstos");
  assert.match(ctx.root().querySelector(".pg-cards").textContent, /24\/09\/2026/);
  assert.match(ctx.root().querySelector('.pg-card[data-item-id="310"]').textContent, /Agendamento\s*PGTO PAGO/);
  assert.match(ctx.root().querySelector('.pg-card[data-item-id="310"]').textContent, /PAGO EM 24\/09\/2026/);
  button(ctx.root(), "Limpar filtros").click();
  assert.equal(ctx.root().querySelector('[name="status"]').value, "PAGAMENTO PREVISTO");
  assert.deepEqual([...ctx.root().querySelectorAll(".pg-card")].map(card => card.dataset.itemId), ["306"]);
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
  await settle();

  assert.deepEqual([...ctx.root().querySelectorAll(".pg-card")].map(card => card.dataset.itemId), ["306"]);
  assert.match(ctx.root().querySelector(".pg-list-status").textContent, /1 pagamento/i);
});

test("G28 mostra o clipe lateral salvo ausência confirmada e abre a coleção compartilhada", async t => {
  const rows = [
    { id: "306", hasAttachments: true, fields: { ID: 306, FORNECEDOR: "COM ANEXOS", STATUS: "PAGAMENTO PREVISTO" } },
    { id: "307", hasAttachments: false, fields: { ID: 307, FORNECEDOR: "SEM ANEXOS", STATUS: "PAGAMENTO PREVISTO" } },
    { id: "308", fields: { ID: 308, FORNECEDOR: "ANEXOS DESCONHECIDOS", STATUS: "PAGAMENTO PREVISTO" } },
  ];
  const opened = [];
  const ctx = await setup(t, { rows, openMediaCollection: async items => opened.push(items) });
  await ctx.gallery.open();

  const cardWithAttachments = ctx.root().querySelector('.pg-card[data-item-id="306"]');
  const rail = cardWithAttachments.querySelector(".og-card-attachment-rail");
  assert.ok(rail, "the left attachment rail is present");
  assert.equal(rail.dataset.action, "attachments");
  assert.equal(rail.compareDocumentPosition(cardWithAttachments.querySelector(".og-card-main")) & 4, 4,
    "the attachment rail appears before the payment content");
  const emptyRail = ctx.root().querySelector('.pg-card[data-item-id="307"] .pg-attachment-rail');
  assert.equal(emptyRail, null, "pagamentos sem anexos não reservam espaço lateral");
  const unknownCard = ctx.root().querySelector('.pg-card[data-item-id="308"]');
  await settle();
  assert.ok(unknownCard.querySelector(".og-card-attachment-rail"),
    "a consulta em segundo plano revela o acesso quando encontra anexos");
  assert.ok(unknownCard.classList.contains("pg-card--attachments"));

  rail.click();
  await settle();
  unknownCard.querySelector(".og-card-attachment-rail").click();
  await settle();
  assert.deepEqual(ctx.calls.filter(call => call[0] === "listAttachments"), [["listAttachments", "306"], ["listAttachments", "308"]]);
  assert.equal(opened.length, 2);
  assert.deepEqual(opened[0].map(item => item.fileName), ["nota.pdf"]);
  assert.equal((await opened[0][0].source).type, "application/pdf");
  assert.deepEqual(opened[1].map(item => item.fileName), ["nota.pdf"]);
});

test("G28 mostra a quantidade de anexos abaixo do clipe à esquerda", async t => {
  const ctx = await setup(t);
  await ctx.gallery.open();
  await settle();
  const rail = ctx.root().querySelector('.pg-card[data-item-id="306"] .og-card-attachment-rail');
  assert.equal(rail.querySelector(".og-card-attachment-icon").textContent, "📎");
  assert.equal(rail.querySelector(".og-card-attachment-label").textContent, "ANEXOS");
  assert.equal(rail.querySelector(".og-card-attachment-count").textContent, "1 anexo");
});

test("ordenar por continua disponível fora dos filtros e reorganiza os cartões", async t => {
  const rows = [
    { id: "321", hasAttachments: false, fields: { ID: 321, FORNECEDOR: "VENCIMENTO LONGE", STATUS: "PAGAMENTO PREVISTO", "DATA PREVISTO PGTO": "2026-10-02" } },
    { id: "322", hasAttachments: false, fields: { ID: 322, FORNECEDOR: "VENCIMENTO PERTO", STATUS: "PAGAMENTO PREVISTO", "DATA PREVISTO PGTO": "2026-09-28" } },
  ];
  const ctx = await setup(t, { rows });
  await ctx.gallery.open();
  const order = ctx.root().querySelector(".pg-list-toolbar [name=sort]");
  assert.deepEqual([...ctx.root().querySelectorAll(".pg-card")].map(card => card.dataset.itemId), ["322", "321"]);
  order.value = "due-desc";
  order.dispatchEvent(new ctx.dom.window.Event("change", { bubbles: true }));
  assert.deepEqual([...ctx.root().querySelectorAll(".pg-card")].map(card => card.dataset.itemId), ["321", "322"]);
});

test("G28 segue o cartão compacto da referência sem atalho de detalhes", async t => {
  const rows = [{ id: "313", hasAttachments: false, fields: {
    ID: 313, FORNECEDOR: "ML COMERCIO CIMENTO", STATUS: "PAGAMENTO PREVISTO", "VALOR TOTAL": 1425, QTD: 50,
    "DATA PREVISTO PGTO": "2026-09-29", FILIAL: "004 - EDIFÍCIO XAVANTE", IMOVEL: "TODOS",
    PGTOAGENDADO: "PENDENTE", DESCRICAOPGTO: "Cimento entregue para a obra.", OBS: "Pagamento de cimento para a obra.",
  } }];
  const ctx = await setup(t, { rows, now: () => new Date("2026-09-27T12:00:00-03:00") });
  await ctx.gallery.open();
  const card = ctx.root().querySelector('.pg-card[data-item-id="313"]');
  assert.equal(card.querySelector(".pg-card-heading .pg-status"), null, "a situação prevista não duplica o prazo");
  assert.equal(card.querySelector(".pg-card-heading h2").textContent, "ML COMERCIO CIMENTO");
  assert.equal(card.querySelectorAll(".pg-card-grid .pg-card-field:not(.pg-summary-field--wide)").length, 6);
  assert.match(card.querySelector('.pg-card-field[data-field="FILIAL"]').textContent, /004 - EDIFÍCIO XAVANTE/);
  assert.match(card.querySelector('.pg-card-field[data-field="IMÓVEL"]').textContent, /TODOS/);
  assert.match(card.querySelector('.pg-description').textContent, /Cimento entregue/);
  assert.match(card.querySelector(".pg-observation").textContent, /Pagamento de cimento para a obra/);
  assert.match(card.querySelector(".pg-deadline").textContent, /VENCE EM 2 DIAS/);
  assert.equal(card.querySelector('[data-action="details"]'), null);
  assert.ok(card.querySelector('[data-gallery-action="edit"]'));
});

test("G28 apresenta provisão sem anexos no cartão compacto da segunda referência", async t => {
  const rows = [{ id: "300", hasAttachments: false, fields: {
    ID: 300, FORNECEDOR: "VIVO", STATUS: "PAGAMENTO PREVISTO", DESCRICAOPGTO: "SEGURO PARA 7 TRABALHADORES CONFORME CCT",
    "DATA PREVISTO PGTO": "2026-10-04", "VALOR TOTAL": 89.99, QTD: 1,
    FILIAL: "000 - ESCRITÓRIO CENTRAL", IMOVEL: "ESCRITÓRIO VILA DA SERRA", PGTOAGENDADO: "PENDENTE",
  } }];
  const ctx = await setup(t, { rows, now: () => new Date("2026-10-03T12:00:00-03:00") });
  await ctx.gallery.open();
  const card = ctx.root().querySelector('.pg-card[data-item-id="300"]');

  assert.equal(card.querySelector(".pg-attachment-rail"), null, "zero anexos não reserva uma faixa vazia");
  assert.equal(card.classList.contains("og-card--with-attachments"), false);
  assert.equal(card.querySelector(".pg-description-label").textContent, "Descrição");
  assert.equal(card.querySelector(".pg-description strong").textContent, "SEGURO PARA 7 TRABALHADORES CONFORME CCT");
  assert.deepEqual([...card.querySelectorAll(".pg-card-grid .pg-card-field")].map(field => field.dataset.field), [
    "DATA PREVISTA PGTO", "VALOR UNITÁRIO", "QTD", "FILIAL", "IMÓVEL", "AGENDAMENTO", "FRETE",
  ]);
  assert.equal(card.querySelector('.pg-card-field[data-field="DATA PREVISTA PGTO"] dt').textContent, "Data prevista pgto");
  assert.equal(card.querySelector('.pg-card-field[data-field="QTD"] dt').textContent, "Qtd.");
  assert.match(card.querySelector(".pg-card-heading .pg-deadline").textContent, /VENCE EM 1 DIA/);
  assert.equal(card.querySelector(".pg-card-heading .pg-status"), null, "o status previsto não duplica o aviso de prazo");
  assert.ok(card.querySelector('[data-gallery-action="edit"]'));
  assert.ok(card.querySelector('[data-gallery-action="delete"]'));
});

test("G28 mantém um status pendente específico mesmo quando o prazo é mostrado", async t => {
  const rows = [{ id: "303", hasAttachments: false, fields: {
    ID: 303, FORNECEDOR: "FORNECEDOR", STATUS: "PENDENTE APROVAÇÃO", "DATA PREVISTO PGTO": "2026-10-04",
  } }];
  const ctx = await setup(t, { rows, now: () => new Date("2026-10-03T12:00:00-03:00") });
  await ctx.gallery.open();
  choose(ctx, "status", "PENDENTE APROVAÇÃO");
  const card = ctx.root().querySelector('.pg-card[data-item-id="303"]');
  assert.match(card.querySelector(".pg-card-heading .pg-deadline").textContent, /VENCE EM 1 DIA/);
  assert.equal(card.querySelector(".pg-card-heading .pg-status")?.textContent, "PENDENTE APROVAÇÃO");
});

test("G28 separa total calculado, preço unitário e frete sem duplicar a multiplicação", async t => {
  const fixtures = [
    { id: "501", amount: 120.25, quantity: 2, freight: 5, total: "R$ 245,50", unit: "R$ 120,25", shipping: "R$ 5,00" },
    { id: "502", amount: "1.200,50", quantity: "10", freight: "50,00", total: "R$ 12.055,00", unit: "R$ 1.200,50", shipping: "R$ 50,00" },
    { id: "503", amount: 0, quantity: 1, freight: 0, total: "R$ 0,00", unit: "R$ 0,00", shipping: "R$ 0,00" },
    { id: "504", amount: 89.99, quantity: 1, total: "R$ 89,99", unit: "R$ 89,99", shipping: "R$ 0,00" },
    { id: "505", amount: null, quantity: 1, total: "—", unit: "—", shipping: "R$ 0,00" },
  ];
  const rows = fixtures.map(item => ({ id: item.id, hasAttachments: false, fields: {
    ID: Number(item.id), FORNECEDOR: "FORNECEDOR", STATUS: "PAGAMENTO PREVISTO",
    VALORTOTAL: item.amount, QTD: item.quantity, FRETE: item.freight,
  } }));
  const ctx = await setup(t, { rows });
  await ctx.gallery.open();
  const normalText = node => node?.textContent.replace(/\s+/g, " ").trim();
  for (const fixture of fixtures) {
    const card = ctx.root().querySelector(`.pg-card[data-item-id="${fixture.id}"]`);
    const total = card.querySelector(".pg-card-total");
    assert.ok(total, "total calculado deve aparecer ao lado do lápis");
    assert.equal(normalText(total.querySelector("strong")), fixture.total);
    assert.equal(normalText(card.querySelector('[data-field="VALOR UNITÁRIO"] dd')), fixture.unit);
    assert.equal(normalText(card.querySelector('[data-field="VALOR UNITÁRIO"] dt')), "Valor unitário");
    assert.equal(normalText(card.querySelector('[data-field="FRETE"] dd')), fixture.shipping);
    assert.equal(card.querySelector('[data-field="VALOR TOTAL"]'), null, "grade não confunde unitário com total");
    const edit = card.querySelector('[data-gallery-action="edit"]');
    assert.ok(total.compareDocumentPosition(edit) & ctx.dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  }
});

test("G28 esconde o clipe se a contagem consultada confirmar que não há anexos", async t => {
  const rows = [{ id: "309", fields: { ID: 309, FORNECEDOR: "SEM ANEXOS", STATUS: "PAGAMENTO PREVISTO" } }];
  const ctx = await setup(t, { rows, data: {
    async loadSnapshot() { return { rows }; },
    async listAttachments() { return []; },
    async downloadAttachment() { return new Blob(); },
  } });
  await ctx.gallery.open();
  await settle();
  const rail = ctx.root().querySelector('.pg-card[data-item-id="309"] .pg-attachment-rail');
  assert.equal(rail, null);
  const order = ctx.root().querySelector(".pg-list-toolbar [name=sort]");
  order.value = "due-desc";
  order.dispatchEvent(new ctx.dom.window.Event("change", { bubbles: true }));
  assert.equal(ctx.root().querySelector('.pg-card[data-item-id="309"] .pg-attachment-rail'), null,
    "a ordenação não recria a faixa vazia");
});

test("G28 mostra dados seguros no cartão e anexos usam o visualizador compartilhado", async t => {
  const rows = [{ id: "306", hasAttachments: true, fields: {
    ID: 306, FORNECEDOR: "DIBRITA", OBS: "texto <img src=x onerror=alert(1)>", "DATA PREVISTO PGTO": "2026-09-23T03:00:00Z",
    "DATA PGTO EFETUADO": "", STATUS: "PAGAMENTO PREVISTO", "VALOR TOTAL": "1.200,50", QTD: 10, FRETE: "50,00",
    DESCRICAOPGTO: "BRITA", APROVACAO: "PENDENTE", FILIAL: "004 - EDIFÍCIO XAVANTE", IMOVEL: "TODOS",
    IDPEDIDO: "", IDLANCAMENTOS: "", IDRECORRENCIA: "REC-10", PGTOAGENDADO: false, Criado: "2026-09-20T03:00:00Z",
  } }];
  const opened = [];
  const ctx = await setup(t, { rows, openMediaCollection: async items => opened.push(items) });
  await ctx.gallery.open();
  const card = ctx.root().querySelector('.pg-card[data-item-id="306"]');
  assert.equal(card.querySelector('[data-action="details"]'), null);
  assert.ok(card.querySelector('[data-gallery-action="edit"]'));
  assert.match(card.textContent, /23\/09\/2026/);
  assert.match(card.textContent, /texto <img src=x onerror=alert\(1\)>/);
  assert.equal(card.querySelector("img, [onerror]"), null);
  assert.match(card.textContent, /R\$\s?12\.055,00/);

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
  assert.match(ctx.root().querySelector('.pg-card[data-item-id="406"]').textContent, /VENCE EM 2 DIAS/);
  assert.equal(ctx.root().querySelector('.pg-card[data-item-id="401"] .pg-deadline'), null);
});

test("G28 abre os dados originais pelo lápis sem depender de detalhes", async t => {
  const rows = [{ id: "500", hasAttachments: false, fields: {
    ID: 500, FORNECEDOR: "FORNECEDOR", STATUS: "PAGAMENTO PREVISTO",
    Criado: "2026-09-22T01:00:00Z", Modificado: "2026-09-22T01:00:00Z",
  } }];
  const ctx = await setup(t, { rows, data: {
    async loadEditor(id) {
      return {
        entity: { id: "provisao", title: "Pagamento" },
        item: { id, fields: { FORNECEDOR: "FORNECEDOR", OBS: "Valor original" } },
        columns: [{ name: "OBS", label: "Observação", control: "textarea", editable: true }],
        contract: { hasForm: true },
      };
    },
  } });
  await ctx.gallery.open();
  ctx.root().querySelector('.pg-card[data-item-id="500"] [data-gallery-action="edit"]').click();
  for (let attempt = 0; attempt < 20 && !ctx.root().querySelector('[data-dynamic-form]'); attempt++) await settle();
  assert.equal(ctx.root().querySelector('[data-dynamic-form] [name="OBS"]').value, "Valor original");
  assert.equal(ctx.root().querySelector('[data-action="details"]'), null);
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
  choose(ctx, "status", "");
  const scheduleField = [...ctx.root().querySelectorAll('.pg-card[data-item-id="777"] .pg-card-field')]
    .find(pair => pair.dataset.field === "AGENDAMENTO");
  assert.equal(scheduleField.querySelector("dd").textContent, "PGTO PAGO");

  choose(ctx, "type", "PAGO");
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

test("layout G28 mantém filtros compactos e seis dados em grade de três colunas", () => {
  const styles = readFileSync(new URL("../src/ui/orders-gallery.css", import.meta.url), "utf8");
  assert.match(styles, /\.pg-filter-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(styles, /\.pg-cards\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(styles, /\.pg-card-fields\.pg-card-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(styles, /\.pg-overlay \.pg-card\.gallery-record-card[^}]*display:\s*block/s);
  assert.match(styles, /\.pg-description\s*\{[^}]*background:/s);
  assert.match(styles, /\.pg-list-toolbar\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s);
  assert.match(styles, /\.pg-deadline--today[^}]*color:/s);
  assert.match(styles, /\.pg-deadline--overdue[^}]*color:/s);
});
