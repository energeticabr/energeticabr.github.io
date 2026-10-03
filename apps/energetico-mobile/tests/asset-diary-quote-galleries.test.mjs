import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createRegistrationGalleryData, REGISTRATION_GALLERY_MODELS } from "../src/chat/registration-gallery-data.js";
import { createRegistrationGallery } from "../src/ui/registration-gallery-view.js";

const models = [
  ["asset", "IMOBILIZADOS", "GALERIA DE IMOBILIZADO", "G22- HISTÓRICOLANCAMENTOIMOBILIZADO", "IMOBILIZADO"],
  ["assetFunction", "FUNCAOIMOBILIZADO", "GALERIA DE FUNÇÃO DO IMOBILIZADO", null, "FUNCAO"],
  ["assetProduct", "CADASTROIMOBILIZADO", "GALERIA DE PRODUTO IMOBILIZADO", "G14- HISTÓRICOIMOBILIZADO", "IMOBILIZADO"],
  ["assetGroup", "GRUPO IMOBILIZADOS", "GALERIA DE GRUPO IMOBILIZADO", "G13- HISTÓRICOGRUPOIMOBILIZADO", "GRUPOIMOBILIZADOS"],
  ["workDiary", "DIÁRIO DE OBRAS", "GALERIA DE DIÁRIO DE OBRAS", "G39- HISTÓRICO DIÁRIO DE OBRAS", "DATA"],
  ["quotes", "NOVACOTACAO", "GALERIA DE NOVA COTAÇÃO", "G19- HISTÓRICOLOCACOES_2", "DESCRICAO"],
];

function openGallery(t, kind, rows, extra = {}) {
  const dom = new JSDOM("<!doctype html><body></body>");
  const doc = dom.window.document;
  const gallery = createRegistrationGallery({ document: doc, kind,
    ...extra, data: { async loadSnapshot() { return { rows }; }, ...extra.data },
  });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  return { dom, doc, gallery };
}

function choose(dom, doc, field, value) {
  const input = doc.querySelector(`[data-filter-field="${field}"]`);
  assert.ok(input, `filtro ${field}`);
  input.value = value;
  input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

function ids(doc) { return [...doc.querySelectorAll("[data-registration-row]")].map(node => node.dataset.registrationRow); }

for (const [kind, list, title, screen, primary] of models) {
  test(`${kind} opens the requested gallery and resolves its PowerApps list`, async t => {
    const resolved = [];
    const data = createRegistrationGalleryData({ kind, repository: {
      async resolveList(site, aliases) { resolved.push({ site, aliases }); return { status: "resolved", id: list }; },
      async getItemsPage() { return { items: [{ id: "4", fields: { [primary]: primary === "DATA" ? "2026-09-25" : "EXEMPLO", STATUS: "ATIVO" } }], hasMore: false }; },
    } });
    const snapshot = await data.loadSnapshot();
    assert.equal(resolved[0].site, "personal");
    assert.equal(resolved[0].aliases[0], list);
    assert.equal(REGISTRATION_GALLERY_MODELS[kind].title, title);
    if (screen) assert.equal(REGISTRATION_GALLERY_MODELS[kind].screen, screen);
    const { doc, gallery } = openGallery(t, kind, snapshot.rows);
    await gallery.open();
    assert.equal(doc.querySelector("h1").textContent, title);
    assert.deepEqual(ids(doc), ["4"]);
    assert.ok(doc.querySelector('[data-gallery-action="edit"]'));
    assert.ok(doc.querySelector('[data-gallery-action="delete"]'));
  });
}

test("asset metadata maps internal columns without displaying raw names, sorts residual numerically and formats derived values", async t => {
  const data = createRegistrationGalleryData({ kind: "asset", repository: {
    async resolveList() { return { status: "resolved", id: "assets" }; },
    async getColumns() { return [{ name: "field_47", displayName: "IMOBILIZADO" }, { name: "field_48", displayName: "VALOR RESIDUAL" }]; },
    async getItemsPage() { return { items: [
      { id: "3", eTag: '"v3"', fields: { field_47: "BETONEIRA", field_48: "900", VALORESTIMADO: "1.250,50", N_x00da_MEROIMOBILIZADO: "PAT-3", DATADEPRECIA_x00c7__x00c3_O: "2026-10-05T03:00:00Z", QTD: "2,5", HTML: "INTERNAL-HTML", STATUS: "ATIVO", Attachments: true } },
      { id: "2", fields: { field_47: "ANDAIME", field_48: "1000", STATUS: "INATIVO", Attachments: false } },
    ], hasMore: false }; },
  } });
  const { doc, dom, gallery } = openGallery(t, "asset", (await data.loadSnapshot()).rows);
  await gallery.open();
  assert.deepEqual(ids(doc), ["2", "3"]);
  const card = doc.querySelector('[data-registration-row="3"]');
  assert.equal(card.querySelector(".rg-row-title").textContent, "BETONEIRA");
  assert.equal(card.querySelector('[data-field="NÚMEROIMOBILIZADO"] dd').textContent, "PAT-3");
  assert.equal(card.querySelector('[data-field="VALOR ESTIMADO"] dd').textContent.replace(/\s+/g, " "), "R$ 1.250,50");
  assert.equal(card.querySelector('[data-field="VALOR DEPRECIADO"] dd').textContent.replace(/\s+/g, " "), "R$ 350,50");
  assert.equal(card.querySelector('[data-field="DATA DEPRECIAÇÃO"] dd').textContent, "05/10/2026");
  assert.equal(card.querySelector('[data-field="QTD"] dd').textContent, "2,5");
  assert.doesNotMatch(card.textContent, /INTERNAL-HTML|field_47|field_48|DATADEPRECIA_x/);
  assert.equal(card.querySelector('[data-field="FORNECEDOR"]'), null);
  assert.ok(card.querySelector('[data-action="registration-attachments"]'));
  assert.deepEqual([...doc.querySelectorAll("[data-filter-field]")].map(node => node.dataset.filterField), ["NÚMEROIMOBILIZADO", "IMOBILIZADO", "FILIAL", "FORNECEDOR", "STATUS", "DEPRECIAR"]);
  choose(dom, doc, "STATUS", "INATIVO");
  assert.deepEqual(ids(doc), ["2"]);
});

test("asset product preserves unsorted source order and filters group and function exactly", async t => {
  const data = createRegistrationGalleryData({ kind: "assetProduct", repository: {
    async resolveList() { return { status: "resolved", id: "products" }; },
    async getItemsPage() { return { items: [
      { id: "1", fields: { IMOBILIZADO: "BETONEIRA", GRUPOIMOBILIZADO: "EQUIPAMENTO", FUNCAO: "CONCRETAGEM" } },
      { id: "9", fields: { IMOBILIZADO: "ANDAIME", GRUPOIMOBILIZADO: "EQUIPAMENTO", FUNCAO: "ACESSO" } },
    ], hasMore: false }; },
  } });
  const { dom, doc, gallery } = openGallery(t, "assetProduct", (await data.loadSnapshot()).rows);
  await gallery.open();
  assert.deepEqual(ids(doc), ["1", "9"]);
  assert.deepEqual([...doc.querySelectorAll("[data-filter-field]")].map(node => node.dataset.filterField), ["GRUPOIMOBILIZADO", "FUNCAO", "IMOBILIZADO"]);
  choose(dom, doc, "FUNCAO", "ACESSO");
  assert.deepEqual(ids(doc), ["9"]);
});

test("work diary uses encoded climate metadata, descending IDs, inclusive date bounds and stage substring", async t => {
  const { dom, doc, gallery } = openGallery(t, "workDiary", [
    { id: "4", hasAttachments: false, fields: { DATA: "2026-09-26T03:00:00Z", FILIAL: "CENTRAL", STATUS: "PENDENTE", INFORMA_x00c7__x00d5_ESCLIM_x00c: "ENSOLARADO", TIPO: "OBRA", ETAPA: "ESTRUTURA; ALVENARIA" } },
    { id: "7", hasAttachments: true, fields: { DATA: "2026-09-27", FILIAL: "CENTRAL", STATUS: "CONCLUÍDO", INFORMA_x00c7__x00d5_ESCLIM_x00c: "MUITO CHUVOSO", TIPO: "OBRA", ETAPA: "ALVENARIA" } },
    { id: "5", hasAttachments: false, fields: { DATA: "2026-09-25", FILIAL: "CENTRAL", STATUS: "CONCLUÍDO", ETAPA: "ESTRUTURA" } },
  ]);
  await gallery.open();
  assert.deepEqual(ids(doc), ["7", "5", "4"]);
  assert.match(doc.querySelector('[data-registration-row="4"] .rg-row-title').textContent, /26\/09\/2026.*sábado/i);
  const start = doc.querySelector('[data-date-bound="start"]');
  const end = doc.querySelector('[data-date-bound="end"]');
  assert.ok(start); assert.ok(end);
  start.value = "2026-09-26";
  end.value = "2026-09-27";
  end.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.deepEqual(ids(doc), ["7", "4"]);
  choose(dom, doc, "ETAPA", "ESTRUTURA");
  assert.deepEqual(ids(doc), ["4"]);
  choose(dom, doc, "INFORMAÇÕES CLIMÁTICAS", "ENSOLARADO");
  assert.deepEqual(ids(doc), ["4"]);
  choose(dom, doc, "ETAPA", "");
  choose(dom, doc, "INFORMAÇÕES CLIMÁTICAS", "");
  end.value = "2026-09-26";
  end.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.deepEqual(ids(doc), ["4"]);
  start.value = "";
  start.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.deepEqual(ids(doc), ["5", "4"]);
});

test("quote search matches description only and starts active with the actual source ID sort selection", async t => {
  const { dom, doc, gallery } = openGallery(t, "quotes", [
    { id: "9", hasAttachments: false, fields: { DESCRICAO: "Concreto armado", FORNECEDOR: "CABOS LTDA", FILIAL: "CENTRAL", ETAPA: "ESTRUTURA", STATUS: "ATIVO", Created: "2026-09-20T12:00:00Z", DATAFINALIZADO: "2026-09-24", COTACOESVINCULADAS: "12; 14", ORCAMENTOESCOLHIDO: "14" } },
    { id: "1", hasAttachments: false, fields: { DESCRICAO: "Cabos elétricos", FILIAL: "NORTE", ETAPA: "ELÉTRICA", STATUS: "ATIVO", Created: "2026-09-25T12:00:00Z" } },
    { id: "20", hasAttachments: false, fields: { DESCRICAO: "Encerrada", STATUS: "INATIVO", Created: "2026-09-26T12:00:00Z" } },
  ]);
  await gallery.open();
  assert.deepEqual(ids(doc), ["9", "1"]);
  assert.equal(doc.querySelector('[data-filter-field="STATUS"]').value, "ATIVO");
  assert.deepEqual([...doc.querySelectorAll("[data-filter-field]")].map(node => node.dataset.filterField), ["ID", "FILIAL", "ETAPA", "STATUS"]);
  const search = doc.querySelector('.rg-toolbar > .rg-field input[type="search"]');
  search.value = " cabos ";
  search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.deepEqual(ids(doc), ["1"]);
  search.value = "";
  search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  const sort = doc.querySelector('[data-gallery-sort]');
  assert.ok(sort);
  assert.equal(sort.options.length, 5);
  assert.equal(sort.value, "ID:desc");
  sort.value = "Created:desc";
  sort.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.deepEqual(ids(doc), ["1", "9"]);
  const card = doc.querySelector('[data-registration-row="9"]');
  assert.equal(card.querySelector('[data-field="DATAFINALIZADO"] dd').textContent, "24/09/2026");
  assert.equal(card.querySelector('[data-field="COTACOESVINCULADAS"] dt').textContent, "Orçamentos vinculados à cotação");
});

test("new gallery attachment actions open registered media and use record language", async t => {
  const opened = [];
  const { doc, gallery } = openGallery(t, "asset", [{ id: "8", hasAttachments: true, fields: { ITEM: "FURADEIRA" } }], {
    data: { async listAttachments() { return [{ fileName: "bem.pdf" }]; }, downloadAttachment(id, name) { return `${id}/${name}`; } },
    openMediaCollection(items) { opened.push(items); },
  });
  await gallery.open();
  const button = doc.querySelector('[data-action="registration-attachments"]');
  assert.match(button.getAttribute("aria-label"), /imobilizado 8/i);
  button.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(opened, [[{ fileName: "bem.pdf", source: "8/bem.pdf" }]]);
});

test("asset function metadata editor exposes only its proved function column and pins edit/delete versions", async () => {
  const writes = [];
  const data = createRegistrationGalleryData({ kind: "assetFunction", repository: {
    async resolveList() { return { status: "resolved", id: "functions" }; },
    async getItemsPage() { return { items: [] }; },
    async getColumns() { return [{ name: "Title", text: {} }, { name: "FUNCAO", text: {} }, { name: "SECRET", text: {} }, { name: "Created", dateTime: {} }]; },
    async getItem(_site, _list, id) { return { id, eTag: '"function-v1"', fields: { FUNCAO: "CONCRETAGEM" } }; },
    async updateItem(site, list, id, fields, options) { writes.push({ site, list, id, fields, options }); return { id, fields }; },
    async deleteItem(site, list, id, options) { writes.push({ site, list, id, options }); },
  } });
  const context = await data.loadEditor("7");
  assert.equal(context.entity.id, "funcoes-de-imobilizado");
  assert.equal(context.contract.hasForm, true);
  assert.equal(context.contract.readOnly, false);
  assert.deepEqual(context.columns.map(column => column.name), ["FUNCAO"]);
  await assert.rejects(data.saveEditor(context, { SECRET: "INJETADO" }), /campo/i);
  assert.deepEqual(writes, []);
  await data.saveEditor(context, { FUNCAO: "ACESSO" });
  assert.deepEqual(writes[0], { site: "personal", list: "functions", id: "7", fields: { FUNCAO: "ACESSO" }, options: { eTag: '"function-v1"' } });
  await data.deleteItem("7", { eTag: '"shown-v2"' });
  assert.deepEqual(writes[1].options, { eTag: '"shown-v2"' });
  await assert.rejects(data.deleteItem("7", { eTag: "*" }), /versão|ETag/i);
  assert.equal(writes.length, 2);
});

test("quotes use the registered edit form and revalidate a retained stage when its branch changes", async () => {
  const writes = [], searches = [];
  const data = createRegistrationGalleryData({ kind: "quotes", repository: {
    async resolveList() { return { status: "resolved", id: "quotes" }; },
    async getItemsPage() { return { items: [] }; },
    async getColumns() { return [{ name: "FILIAL", text: {} }, { name: "ETAPA", text: {} }, { name: "DESCRICAO", text: {} }, { name: "STATUS", text: {} }]; },
    async getItem(_site, _list, id) { return { id, eTag: '"quote-v1"', fields: { FILIAL: "A", ETAPA: "ESTRUTURA A", DESCRICAO: "CONCRETO", STATUS: "ATIVO" } }; },
    async searchPowerAppsOptions(_site, source, term, dependencies) {
      searches.push({ source, term, dependencies });
      if (source.valueField === "FILIAL") return [{ value: "B", label: "B" }];
      return [{ value: dependencies.FILIAL === "B" ? "ESTRUTURA B" : "ESTRUTURA A", label: "Estrutura" }];
    },
    async updateItem(_site, _list, _id, fields, options) { writes.push({ fields, options }); },
  } });
  const context = await data.loadEditor("5");
  assert.equal(context.contract.formVariant.formName, "Form36_1");
  const stage = context.columns.find(column => column.name === "ETAPA");
  assert.equal(stage.control, "select");
  assert.equal(stage.powerApps.closed, true);
  assert.equal(stage.powerApps.optionSources[0].kind, "dependent");
  assert.equal(stage.powerApps.optionSources[0].listName, "LANCAMENTOOBRA");
  await assert.rejects(data.saveEditor(context, { FILIAL: "B", ETAPA: "ESTRUTURA A" }), /opção/i);
  assert.equal(searches.at(-1).dependencies.FILIAL, "B");
  assert.deepEqual(writes, []);
  await data.saveEditor(context, { FILIAL: "B", ETAPA: "ESTRUTURA B" });
  assert.deepEqual(writes, [{ fields: { FILIAL: "B", ETAPA: "ESTRUTURA B" }, options: { eTag: '"quote-v1"' } }]);
});

test("new gallery snapshots reject incomplete pagination rather than showing a partial list", async () => {
  const data = createRegistrationGalleryData({ kind: "asset", repository: {
    async resolveList() { return { status: "resolved", id: "assets" }; },
    async getItemsPage() { return { items: [{ id: "5", fields: { ITEM: "BETONEIRA" } }], hasMore: true }; },
  } });
  await assert.rejects(data.loadSnapshot(), /paginação|cursor/i);
});

test("quote attachment feedback identifies a cotação", async t => {
  const { doc, gallery } = openGallery(t, "quotes", [{ id: "4", hasAttachments: true, fields: { DESCRICAO: "CONCRETO", STATUS: "ATIVO" } }], {
    data: { async listAttachments() { return []; }, downloadAttachment() {} },
  });
  await gallery.open();
  doc.querySelector('[data-action="registration-attachments"]').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(doc.querySelector('.rg-feedback').textContent, "A cotação 4 não possui anexos.");
});

test("product source ordering remains isolated when old and new snapshot pages interleave", async () => {
  const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
  const oldFirst = deferred(), newFirst = deferred(), oldNext = deferred(), newNext = deferred();
  let firstPage = 0;
  const data = createRegistrationGalleryData({ kind: "assetProduct", repository: {
    async resolveList() { return { status: "resolved", id: "products" }; },
    async getItemsPage(_site, _list, _query, options) {
      if (options.cursor === "old") return oldNext.promise;
      if (options.cursor === "new") return newNext.promise;
      return ++firstPage === 1 ? oldFirst.promise : newFirst.promise;
    },
  } });
  const page = (values, nextLink) => ({ items: values.map(id => ({ id: String(id), fields: { IMOBILIZADO: `P${id}` } })), hasMore: Boolean(nextLink), nextLink });
  const oldSnapshot = data.loadSnapshot();
  await new Promise(resolve => setImmediate(resolve));
  const newSnapshot = data.loadSnapshot();
  await new Promise(resolve => setImmediate(resolve));
  oldFirst.resolve(page([3, 4], "old"));
  await new Promise(resolve => setImmediate(resolve));
  newFirst.resolve(page([1, 2], "new"));
  await new Promise(resolve => setImmediate(resolve));
  newNext.resolve(page([3, 4]));
  const current = await newSnapshot;
  oldNext.resolve(page([1, 2]));
  const previous = await oldSnapshot;
  assert.deepEqual(current.rows.map(row => row.id), ["1", "2", "3", "4"]);
  assert.deepEqual(previous.rows.map(row => row.id), ["3", "4", "1", "2"]);
});

test("catalog stage filter waits for branch, resets its child selection, and ignores older option responses", async t => {
  const pending = new Map(), calls = [];
  const { dom, doc, gallery } = openGallery(t, "quotes", [
    { id: "2", fields: { DESCRICAO: "A", FILIAL: "A", ETAPA: "ETAPA A", STATUS: "ATIVO" }, hasAttachments: false },
    { id: "1", fields: { DESCRICAO: "B", FILIAL: "B", ETAPA: "ETAPA B", STATUS: "ATIVO" }, hasAttachments: false },
  ], { data: {
    getFilterSource(field) { return field === "ETAPA" ? { listName: "LANCAMENTOOBRA", dependsOn: ["FILIAL"], disabledUntil: ["FILIAL"] } : field === "FILIAL" ? { listName: "FILIAIS" } : null; },
    async loadFilterOptions(field, { filters }) {
      calls.push({ field, filters });
      if (field === "FILIAL") return [{ value: "A", label: "A" }, { value: "B", label: "B" }];
      return new Promise(resolve => pending.set(filters.FILIAL, resolve));
    },
  } });
  await gallery.open();
  const stage = doc.querySelector('[data-filter-field="ETAPA"]');
  assert.equal(stage.disabled, true);
  assert.equal(calls.some(call => call.field === "ETAPA"), false);
  choose(dom, doc, "FILIAL", "A");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stage.disabled, true);
  choose(dom, doc, "FILIAL", "B");
  await new Promise(resolve => setImmediate(resolve));
  pending.get("B")([{ value: "ETAPA B", label: "Etapa B cadastrada" }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stage.disabled, false);
  assert.deepEqual([...stage.options].map(option => option.value), ["", "ETAPA B"]);
  pending.get("A")([{ value: "ETAPA A", label: "Etapa A cadastrada" }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual([...stage.options].map(option => option.value), ["", "ETAPA B"]);
  choose(dom, doc, "ETAPA", "ETAPA B");
  choose(dom, doc, "FILIAL", "");
  assert.equal(stage.value, "");
  assert.equal(stage.disabled, true);
});

test("failed catalog filters show an explicit unavailable state without invented row options", async t => {
  const { doc, gallery } = openGallery(t, "asset", [{ id: "1", fields: { ITEM: "ONLY ROW ITEM", STATUS: "ATIVO" }, hasAttachments: false }], { data: {
    getFilterSource(field) { return field === "IMOBILIZADO" ? { listName: "CADASTROIMOBILIZADO" } : null; },
    async loadFilterOptions() { throw new Error("Offline"); },
  } });
  await gallery.open();
  const item = doc.querySelector('[data-filter-field="IMOBILIZADO"]');
  assert.equal(item.disabled, true);
  assert.deepEqual([...item.options].map(option => option.value), [""]);
  assert.match(doc.querySelector('.rg-feedback').textContent, /filtro.*imobilizado.*indisponível/i);
});

test("refresh retains selected catalog parents before reloading their child options", async t => {
  const { dom, doc, gallery } = openGallery(t, "quotes", [{ id: "1", fields: { DESCRICAO: "A", FILIAL: "A", ETAPA: "ETAPA A", STATUS: "ATIVO" }, hasAttachments: false }], { data: {
    getFilterSource(field) { return field === "FILIAL" ? { listName: "FILIAIS" } : field === "ETAPA" ? { listName: "LANCAMENTOOBRA", dependsOn: ["FILIAL"], disabledUntil: ["FILIAL"] } : null; },
    async loadFilterOptions(field, { filters }) {
      return field === "FILIAL" ? [{ value: "A", label: "A" }] : [{ value: `ETAPA ${filters.FILIAL}`, label: `Etapa ${filters.FILIAL}` }];
    },
  } });
  await gallery.open();
  choose(dom, doc, "FILIAL", "A");
  await new Promise(resolve => setImmediate(resolve));
  choose(dom, doc, "ETAPA", "ETAPA A");
  doc.querySelector('[data-action="registration-refresh"]').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(doc.querySelector('[data-filter-field="FILIAL"]').value, "A");
  assert.equal(doc.querySelector('[data-filter-field="ETAPA"]').value, "ETAPA A");
  assert.equal(doc.querySelector('[data-filter-field="ETAPA"]').disabled, false);
});
