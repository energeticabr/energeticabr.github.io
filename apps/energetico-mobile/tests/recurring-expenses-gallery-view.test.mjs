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
    async listAttachments(id, options) { assert.deepEqual(options, { refresh: true }); calls.push(["listAttachments", id]); return [{ fileName: "conta.pdf", mimeType: "application/pdf", size: 1024 }]; },
    async downloadAttachment(id, name) { calls.push(["downloadAttachment", id, name]); return new Blob(["pdf"], { type: "application/pdf" }); },
    ...overrides.data,
  };
  const { data: dataOverrides = {}, ...galleryOverrides } = overrides;
  const gallery = module.createRecurringExpensesGallery({
    document: dom.window.document,
    data: { ...data, ...dataOverrides },
    now: () => new Date("2026-09-23T12:00:00-03:00"),
    ...galleryOverrides,
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
  assert.equal(ctx.root().querySelector(".re-filter-panel")?.hidden, true, "filtros de despesas recorrentes começam recolhidos");
  assert.match(ctx.root().querySelector("h1").textContent, /GALERIA DESPESAS RECORRENTES/i);
  for (const name of ["search", "id", "property", "branch", "supplier", "product", "responsible", "paymentMethod", "status", "recurrence"]) {
    assert.ok(ctx.root().querySelector(`[name="${name}"]`), `G19 filter ${name}`);
  }
  assert.deepEqual([...ctx.root().querySelectorAll(".re-card")].map(card => card.dataset.itemId), ["33"]);
  assert.equal(ctx.root().querySelectorAll('.re-card [data-action="details"]').length, 0, "recurring-expense data opens from its edit pencil");
  assert.equal(ctx.root().querySelectorAll('.re-card [data-gallery-action="edit"]').length, 1);
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

test("G19 segue a composição nova: busca, filtro, ordenação e cartões por produto", async t => {
  const ctx = await setup(t, { rows: [{ id: "35", hasAttachments: false, fields: {
    ID: 35, EQUIPAMENTO: "SEGURO DE VIDA COLETIVO",
    DESCRICAOPGTO: "SEGURO PARA 7 TRABALHADORES CONFORME CCT",
    FORNECEDOR: "ZURICH SEGUROS", IMOVEL: "TODOS", FILIAL: "004 - EDIFÍCIO XAVANTE",
    "VALOR MENSAL": "121,78", RECORRENCIA: "Month", "RESPONSAVEL LOCACAO": "BERNARDO",
    DATAINICIO: "2026-10-03T03:00:00Z", DATAFIM: "2026-10-11T03:00:00Z", STATUS: "ATIVO",
    Criado: "2026-10-03T03:24:00Z", "Criado por": "Usuário não identificado",
  } }] });
  await ctx.gallery.open();
  const root = ctx.root();
  assert.ok(root.querySelector(".re-search-bar [name=search]"), "pesquisa aparece acima dos cartões");
  assert.match(root.querySelector(".re-search-bar input").placeholder, /Pesquisar em todos os campos/);
  assert.equal(root.querySelector(".re-filter-button").getAttribute("aria-expanded"), "false");
  assert.ok(root.querySelector(".re-list-toolbar [name=sort]"), "ordenação permanece visível");
  assert.ok(root.querySelector(".re-sort-field .sfs-trigger"), "seletor visual de ordenação recebe o estilo da G19");
  const card = root.querySelector(".re-card");
  assert.equal(card.querySelector(".re-card-heading h2").textContent, "SEGURO DE VIDA COLETIVO");
  assert.equal(card.querySelector(".re-card-description dd").textContent, "SEGURO PARA 7 TRABALHADORES CONFORME CCT");
  assert.ok(card.querySelector(".re-card-heading .re-status"), "status fica junto ao título");
  assert.equal(card.querySelector(".re-value-band .re-card-field--value dd").textContent, "R$ 121,78");
  assert.equal(card.querySelector(".re-value-band .re-card-field--recurrence dd").textContent, "Mensal");
  assert.equal(card.querySelector(".re-date-row .re-card-field--start dd").textContent, "03/10/2026");
  assert.equal(card.querySelector(".re-date-row .re-card-field--next dd").textContent, "11/10/2026");
  assert.match(card.querySelector(".re-metadata").textContent, /Adicionado por: Usuário não identificado/);
  assert.equal(card.querySelector('[data-gallery-action="edit"]').textContent, "✏️");
  assert.equal(card.querySelector("[data-action=details]"), null);
});

test("filtro compacto mostra quantidade ativa e mantém a combinação local", async t => {
  const ctx = await setup(t, { rows: [
    { id: "35", hasAttachments: false, fields: { ID: 35, STATUS: "ATIVO", EQUIPAMENTO: "SEGURO", DATAINICIO: "2026-10-03" } },
    { id: "34", hasAttachments: false, fields: { ID: 34, STATUS: "INATIVO", EQUIPAMENTO: "IPTU", DATAINICIO: "2026-09-01" } },
  ] });
  await ctx.gallery.open();
  const root = ctx.root();
  const toggle = root.querySelector(".re-filter-button");
  toggle.click();
  assert.equal(root.querySelector(".re-filter-panel").hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  choose(ctx, "status", "ATIVO");
  await settle();
  assert.equal(root.querySelector(".re-filter-count").textContent, "1");
  assert.deepEqual([...root.querySelectorAll(".re-card")].map(card => card.dataset.itemId), ["35"]);
  toggle.click();
  assert.equal(root.querySelector(".re-filter-panel").hidden, true);
  assert.equal(root.querySelector(".re-filter-count").textContent, "1", "indicador continua visível após fechar filtros");
});

test("G19 ordena pela data de início mais recente e permite inverter a ordem", async t => {
  const ctx = await setup(t, { rows: [
    { id: "35", hasAttachments: false, fields: { ID: 35, EQUIPAMENTO: "ANTIGO", DATAINICIO: "2026-09-01" } },
    { id: "34", hasAttachments: false, fields: { ID: 34, EQUIPAMENTO: "NOVO", DATAINICIO: "2026-10-03" } },
  ] });
  await ctx.gallery.open();
  assert.deepEqual([...ctx.root().querySelectorAll(".re-card")].map(card => card.dataset.itemId), ["34", "35"]);
  choose(ctx, "sort", "start-date-asc");
  await settle();
  assert.deepEqual([...ctx.root().querySelectorAll(".re-card")].map(card => card.dataset.itemId), ["35", "34"]);
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
  await settle();

  assert.deepEqual([...ctx.root().querySelectorAll(".re-card")].map(card => card.dataset.itemId), ["33"]);
  assert.equal(ctx.calls.filter(([name]) => name === "snapshot").length, 1);
  assert.match(ctx.root().querySelector(".re-list-status").textContent, /1 despesa recorrente/i);
  assert.equal([...ctx.root().querySelectorAll("button")].some(node => node.textContent.trim() === "Aplicar filtros"), false);
});

test("dados da despesa abrem pelo lápis e anexos no visualizador compartilhado", async t => {
  const rows = [{ id: "33", hasAttachments: true, fields: {
    ID: 33, DESCRICAOPGTO: "TARIFA <img src=x onerror=alert(1)>", "VALOR MENSAL": "144,92", RECORRENCIA: "Month",
    DATAINICIO: "2026-07-27T03:00:00Z", STATUS: "ATIVO", Criado: "2026-07-27T19:07:00Z",
  } }];
  const opened = [];
  const ctx = await setup(t, { rows, openMediaCollection: async items => opened.push(items), data: {
    async loadEditor(id) {
      return {
        entity: { id: "despesas", title: "Despesa" },
        item: { id, fields: { DESCRICAOPGTO: rows[0].fields.DESCRICAOPGTO } },
        columns: [{ name: "DESCRICAOPGTO", label: "Descrição", control: "textarea", editable: true }],
        contract: { hasForm: true },
      };
    },
  } });
  await ctx.gallery.open();
  ctx.root().querySelector('.re-card[data-item-id="33"] [data-gallery-action="edit"]').click();
  for (let attempt = 0; attempt < 20 && !ctx.root().querySelector('[data-dynamic-form]'); attempt++) await settle();
  assert.equal(ctx.root().querySelector('[data-dynamic-form] [name="DESCRICAOPGTO"]').value,
    "TARIFA <img src=x onerror=alert(1)>");
  assert.equal(ctx.root().querySelector("[onerror]"), null);
  assert.equal(ctx.root().querySelector('[data-action="details"]'), null);
  ctx.root().querySelector('[data-form-cancel]').click();

  ctx.root().querySelector('.re-card[data-item-id="33"] [data-action="attachments"]').click();
  await settle();
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0].map(item => item.fileName), ["conta.pdf"]);
  assert.equal((await opened[0][0].source).type, "application/pdf");
  assert.deepEqual(ctx.calls.slice(-2), [["listAttachments", "33"], ["downloadAttachment", "33", "conta.pdf"]]);
});

test("G19 mostra anexos à esquerda do conteúdo quando há arquivo", async t => {
  const ctx = await setup(t);
  await ctx.gallery.open();
  await settle();
  const card = ctx.root().querySelector('.re-card[data-item-id="33"]');
  const rail = card.querySelector(".og-card-attachment-rail");
  assert.ok(rail);
  assert.equal(card.firstElementChild, rail, "trilho de anexos precede o conteúdo do cartão");
  assert.ok(card.classList.contains("og-card--with-attachments"));
  assert.equal(rail.querySelector(".og-card-attachment-icon").textContent, "📎");
  assert.equal(rail.querySelector(".og-card-attachment-label").textContent, "ANEXOS");
  assert.equal(rail.querySelector(".og-card-attachment-count").textContent, "1 anexo");
});

test("G19 não reserva coluna de anexos quando a consulta confirma lista vazia", async t => {
  const ctx = await setup(t, { data: { async listAttachments() { return []; } } });
  await ctx.gallery.open();
  await settle();
  const card = ctx.root().querySelector('.re-card[data-item-id="33"]');
  assert.equal(card.querySelector('[data-action="attachments"]'), null);
  assert.equal(card.classList.contains("og-card--with-attachments"), false);
  assert.equal(card.firstElementChild, card.querySelector(".og-card-main"));
});

test("G19 cria o botão lateral quando descobre anexo em registro sem indicação inicial", async t => {
  let finishLookup;
  const ctx = await setup(t, {
    rows: [{ id: "40", fields: { ID: 40, EQUIPAMENTO: "ENERGIA", STATUS: "ATIVO" } }],
    data: { listAttachments: () => new Promise(resolve => { finishLookup = resolve; }) },
  });
  await ctx.gallery.open();
  const card = ctx.root().querySelector('.re-card[data-item-id="40"]');
  assert.equal(card.querySelector('[data-action="attachments"]'), null);
  assert.equal(card.classList.contains("og-card--with-attachments"), false);
  finishLookup([{ fileName: "conta.pdf", mimeType: "application/pdf", size: 1024 }]);
  await settle();
  assert.equal(card.firstElementChild.dataset.action, "attachments");
  assert.equal(card.querySelector('.og-card-attachment-count').textContent, "1 anexo");
  assert.ok(card.classList.contains("og-card--with-attachments"));
});

test("G19 permite repetir a consulta que falhou antes de confirmar anexos", async t => {
  let attempts = 0;
  const ctx = await setup(t, {
    rows: [{ id: "40", fields: { ID: 40, EQUIPAMENTO: "ENERGIA", STATUS: "ATIVO" } }],
    data: { async listAttachments() {
      attempts += 1;
      if (attempts === 1) throw new Error("Falha temporária");
      return [{ fileName: "conta.pdf", mimeType: "application/pdf", size: 1024 }];
    } },
  });
  await ctx.gallery.open();
  await settle();
  const card = ctx.root().querySelector('.re-card[data-item-id="40"]');
  assert.equal(card.querySelector('[data-action="attachments"]'), null);
  assert.ok(card.querySelector('[data-action="retry-attachments"]'), "falha inicial oferece nova consulta");
  choose(ctx, "sort", "id-asc");
  await settle();
  const retry = ctx.root().querySelector('.re-card[data-item-id="40"] [data-action="retry-attachments"]');
  assert.ok(retry, "falha sem indicação de anexo oferece nova consulta");
  retry.click();
  await settle();
  assert.equal(attempts, 2);
  const refreshedCard = ctx.root().querySelector('.re-card[data-item-id="40"]');
  assert.equal(refreshedCard.querySelector('[data-action="retry-attachments"]'), null);
  assert.equal(refreshedCard.firstElementChild.dataset.action, "attachments");
  assert.equal(refreshedCard.querySelector('.og-card-attachment-count').textContent, "1 anexo");
});

test("G19 mantém desabilitado o botão lateral inserido durante outra abertura", async t => {
  let finishSecond;
  let finishViewer;
  const ctx = await setup(t, {
    rows: [
      { id: "35", hasAttachments: true, fields: { ID: 35, EQUIPAMENTO: "SEGURO" } },
      { id: "34", fields: { ID: 34, EQUIPAMENTO: "CONTABILIDADE" } },
    ],
    data: { listAttachments: id => id === "35"
      ? Promise.resolve([{ fileName: "seguro.pdf", mimeType: "application/pdf" }])
      : new Promise(resolve => { finishSecond = resolve; }) },
    openMediaCollection: () => new Promise(resolve => { finishViewer = resolve; }),
  });
  await ctx.gallery.open();
  await settle();
  ctx.root().querySelector('.re-card[data-item-id="35"] [data-action="attachments"]').click();
  await settle();
  assert.equal(ctx.root().getAttribute("aria-busy"), "true");
  finishSecond([{ fileName: "conta.pdf", mimeType: "application/pdf" }]);
  await settle();
  const newButton = ctx.root().querySelector('.re-card[data-item-id="34"] [data-action="attachments"]');
  assert.ok(newButton);
  assert.equal(newButton.disabled, true);
  finishViewer();
  await settle();
  assert.equal(newButton.disabled, false);
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
  assert.match(styles, /\.re-card\.gallery-record-card:nth-child\(even\)\s*\{\s*background:\s*#fff/s);
  assert.match(styles, /\.re-card-heading\s*\{[^}]*min-height:\s*90px/s, "cabeçalho reserva espaço para editar e excluir sem cobrir fornecedor");
  assert.match(styles, /\.re-sort-field \.sfs-trigger\s*\{[^}]*border-radius:\s*10px/s, "seletor de ordenação é estilizado no controle visível");
});
