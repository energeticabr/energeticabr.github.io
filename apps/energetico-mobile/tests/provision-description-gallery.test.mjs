import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createRegistrationGalleryData } from "../src/chat/registration-gallery-data.js";
import { createRegistrationGallery } from "../src/ui/registration-gallery-view.js";
import { createChatView } from "../src/ui/chat-view.js";
import { createConversationStore } from "../src/chat/conversation-store.js";

test("descritivo provisão consulta todas as páginas e mostra vencidos antes dos futuros, deixando datas vazias no fim", async () => {
  const calls = [];
  const data = createRegistrationGalleryData({ kind: "provisionDescription", repository: {
    async resolveList(site, aliases) { calls.push([site, aliases]); return { status: "resolved", id: "parent-list" }; },
    async getColumns() { return [{ name: "DATAPREVISTOPGTO", displayName: "DATA PREVISTO PGTO", dateTime: {} }]; },
    async getItemsPage(site, list, query, options) {
      assert.equal(site, "personal"); assert.equal(list, "parent-list");
      return options.cursor ? { items: [
        { id: "9", fields: { FORNECEDOR: "B", VALORTOTAL: "1234,56", DATAPREVISTOPGTO: "2026-10-09T03:00:00Z" } },
        { id: "7", fields: { FORNECEDOR: "C", VALORTOTAL: "20" } },
      ], hasMore: false }
        : { items: [{ id: "2", fields: { FORNECEDOR: "A", VALORTOTAL: "10", DATAPREVISTOPGTO: "01/10/2026" } }], hasMore: true, nextLink: "next-page" };
    },
  } });
  const snapshot = await data.loadSnapshot();
  assert.deepEqual(calls, [["personal", ["DESCRITIVOPROVISAO"]]]);
  assert.equal(snapshot.listName, "DESCRITIVOPROVISAO");
  assert.deepEqual(snapshot.rows.map(row => row.id), ["2", "9", "7"]);
  assert.equal(snapshot.rows[1].fields["DATA PREVISTO PGTO"], "2026-10-09T03:00:00Z");
});

test("galeria descritivo provisão deixa a ordenação visível e permite alternar vencimento, ID, fornecedor e valor", async t => {
  const dom = new JSDOM("<!doctype html><body></body>");
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const gallery = createRegistrationGallery({ document: doc, kind: "provisionDescription", data: {
    async loadSnapshot() { return { rows: [
      { id: "9", fields: { FORNECEDOR: "ZETA", STATUS: "PAGAMENTO PREVISTO", VALORTOTAL: "10", DATAPREVISTOPGTO: "2026-11-12T03:00:00Z" } },
      { id: "2", fields: { FORNECEDOR: "ALFA", STATUS: "PAGAMENTO PREVISTO", VALORTOTAL: "30", DATAPREVISTOPGTO: "2026-10-01T03:00:00Z" } },
      { id: "7", fields: { FORNECEDOR: "BETA", STATUS: "PAGAMENTO PREVISTO", VALORTOTAL: "20" } },
    ] }; },
  } });
  t.after(() => gallery.destroy());
  await gallery.open();
  const root = doc.querySelector('[data-gallery-kind="provisionDescription"]');
  const sort = root.querySelector('[data-gallery-sort]');
  const ids = () => [...root.querySelectorAll('[data-registration-row]')].map(row => row.dataset.registrationRow);
  assert.ok(sort, "opção de ordenação disponível");
  assert.equal(root.querySelector('details.rg-filters').contains(sort), false, "ordenação visível mesmo com filtros fechados");
  assert.equal(sort.value, "due:asc");
  assert.deepEqual(ids(), ["2", "9", "7"]);
  for (const [value, expected] of [
    ["due:desc", ["9", "2", "7"]],
    ["ID:desc", ["9", "7", "2"]],
    ["supplier:asc", ["2", "7", "9"]],
    ["amount:desc", ["2", "7", "9"]],
  ]) {
    sort.value = value;
    sort.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    assert.deepEqual(ids(), expected, `ordem ${value}`);
  }
});

test("descritivo provisão não consulta outra lista quando a lista pai está indisponível", async () => {
  const data = createRegistrationGalleryData({ kind: "provisionDescription", repository: {
    async resolveList() { return { status: "missing" }; },
    async getItemsPage() { assert.fail("lista ausente não pode ser consultada"); },
  } });
  await assert.rejects(data.loadSnapshot(), error => error.code === "registration_provisionDescription_list_missing" && /DESCRITIVOPROVISAO/.test(error.message));
});

test("galeria pai apresenta moeda e datas, permite filtrar fornecedor e voltar sem alterar registros", async t => {
  const dom = new JSDOM("<!doctype html><body></body>");
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const gallery = createRegistrationGallery({ document: doc, kind: "provisionDescription", data: {
    async loadSnapshot() { return { rows: [
      { id: "9", hasAttachments: false, fields: { FORNECEDOR: "FORNECEDOR A", FILIAL: "FILIAL A", VALORTOTAL: "1234,56", DATAPREVISTOPGTO: "2026-10-09T03:00:00Z", PGTOAGENDADO: "2026-10-08T03:00:00Z", OBS: "Duas linhas", FORMAPGTO: "CAIXA" } },
      { id: "2", hasAttachments: false, fields: { FORNECEDOR: "FORNECEDOR B", FILIAL: "FILIAL B", VALORTOTAL: "10" } },
    ] }; },
  } });
  t.after(() => gallery.destroy());
  await gallery.open();
  const root = doc.querySelector('[data-gallery-kind="provisionDescription"]');
  assert.equal(root.querySelector("h1").textContent, "GALERIA DESCRITIVO PROVISÃO");
  assert.equal(root.querySelectorAll('[role="listitem"]').length, 2);
  assert.match(root.textContent, /1\.234,56/);
  assert.match(root.textContent, /09\/10\/2026/);
  assert.match(root.textContent, /08\/10\/2026/);
  assert.match(root.textContent, /Duas linhas/);
  assert.equal(root.querySelectorAll('[data-gallery-action="edit"]').length, 2, "cada pai oferece um lápis");
  assert.equal(root.querySelector('[data-gallery-action="delete"]'), null, "exclusão do pai não foi solicitada");
  const supplier = root.querySelector('[data-filter-field="FORNECEDOR"]');
  supplier.value = "FORNECEDOR B";
  supplier.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(root.querySelectorAll('[role="listitem"]').length, 1);
  assert.match(root.querySelector('[role="listitem"]').textContent, /FORNECEDOR B/);
  root.querySelector('[data-action="registration-close"]').click();
  assert.equal(root.hidden, true);
});

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(predicate(), "a operação da galeria deve terminar");
}

function parentFixture({ tokenLabel = "Título" } = {}) {
  const columns = [
    { name: "FILIAL", text: {} }, { name: "FORNECEDOR", text: {} },
    { name: "STATUS", text: {} },
    { name: "VALORTOTAL", text: {} }, { name: "DATAPGTOEFETUADO", dateTime: {} },
    { name: "OBS", text: {} }, { name: "FORMAPGTO", text: {} },
    { name: "PGTOAGENDADO", dateTime: {} }, { name: "DATAPGTOAGENDADO", dateTime: {} },
    { name: "DATAEXECUCAOAGENDAMENTO", dateTime: {} },
    { name: "DATAPREVISTOPGTO", displayName: "DATA PREVISTO PGTO", dateTime: {} },
    { name: "ID", number: {} }, { name: "Title", displayName: tokenLabel, text: {} },
    { name: "Created", dateTime: {} }, { name: "Modified", dateTime: {} },
    { name: "Author", personOrGroup: {} }, { name: "Editor", personOrGroup: {} },
    { name: "IDPROVISAO", lookup: { listId: "child-list", columnName: "Title" } },
    { name: "EXTRA", text: {} },
  ];
  const item = { id: "9", eTag: '"parent-v7"', fields: {
    FILIAL: "FILIAL A", FORNECEDOR: "FORNECEDOR A", VALORTOTAL: "1234,56", OBS: "ORIGINAL",
    STATUS: "PAGAMENTO EFETUADO",
    FORMAPGTO: "CAIXA", DATAPGTOEFETUADO: "2026-10-08T03:00:00Z",
    PGTOAGENDADO: "2026-10-08T03:00:00Z", DATAPGTOAGENDADO: "2026-10-08T03:00:00Z",
    DATAEXECUCAOAGENDAMENTO: "2026-10-08T03:00:00Z", DATAPREVISTOPGTO: "2026-10-09T03:00:00Z",
    ID: 9, Title: "IDEMPOTENCY-TOKEN", Created: "2026-10-07T03:00:00Z",
    Modified: "2026-10-08T03:00:00Z", AuthorLookupId: 1, EditorLookupId: 2,
    IDPROVISAOLookupId: 31, EXTRA: "NÃO EDITÁVEL", Attachments: false,
  } };
  const child = { id: '101', eTag: '"child-v1"', fields: {
    DESCRITIVOPROVISAO: '9', QTD: '1', VALORTOTAL: '1234,56', FRETE: '0',
    STATUS: 'PAGAMENTO PREVISTO',
  } };
  const reads = [], writes = [];
  const catalogs = {
    'branch-list-id': { field: 'FILIAL', values: ['FILIAL A', 'FILIAL B'] },
    'supplier-list-id': { field: 'CADASTRO', values: ['FORNECEDOR A', 'FORNECEDOR B'] },
    'account-list-id': { field: 'CONTA', values: ['CAIXA', 'PIX'] },
  };
  function assertParent(site, list) { assert.equal(site, "personal"); assert.equal(list, "parent-list-id"); }
  const data = createRegistrationGalleryData({ kind: "provisionDescription", repository: Object.freeze({
    async resolveList(site, aliases) {
      assert.equal(site, "personal");
      const catalog = { FILIAIS: 'branch-list-id', FORNECEDORES: 'supplier-list-id', CADASTROCONTA: 'account-list-id' }[aliases[0]];
      return { status: "resolved", id: catalog || (aliases.includes('DESCRITIVOPROVISAO') ? "parent-list-id" : "child-list-id") };
    },
    async getColumns(site, list) { if(catalogs[list])return [{name:catalogs[list].field,text:{}}];if(list==='child-list-id')return [...columns,{name:'DESCRITIVOPROVISAO',text:{}},{name:'QTD',text:{}},{name:'FRETE',text:{}}];assertParent(site, list); return columns; },
    async getItemsPage(site, list) {
      if(catalogs[list])return {items:catalogs[list].values.map((value,index)=>({id:String(index+1),fields:{[catalogs[list].field]:value}})),hasMore:false};
      if(list==='child-list-id')return {items:[
        structuredClone(child),
        {id:'102',fields:{STATUS:'PAGAMENTO EFETUADO'}},
      ],hasMore:false};
      assertParent(site, list);
      return { items: [{ ...item, eTag: '"snapshot-v2"' }], hasMore: false };
    },
    async getItem(site, list, id, query) {
      if (list === 'child-list-id') { reads.push([site, list, id, query]); return structuredClone(child); }
      assertParent(site, list); reads.push([site, list, id, query]); return structuredClone(item);
    },
    async updateItem(site, list, id, fields, options) {
      if (list === 'child-list-id') {
        writes.push([site, list, id, fields, options]);
        child.eTag='"child-v2"'; Object.assign(child.fields,fields); return structuredClone(child);
      }
      assertParent(site, list); writes.push([site, list, id, fields, options]);
      item.eTag='"parent-v8"';Object.assign(item.fields,fields);return structuredClone(item);
    },
    async deleteItem() { assert.fail("nenhuma exclusão foi autorizada"); },
    async createItem() { assert.fail("edição não cria registros nem filhos"); },
  }) });
  return { data, reads, writes, child };
}

test("lápis abre o formulário real do pai e salva só campos comprovados com o ETag carregado", async t => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const doc = dom.window.document, fixture = parentFixture();
  const gallery = createRegistrationGallery({ document: doc, kind: "provisionDescription", data: fixture.data });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  assert.equal(doc.querySelector('[data-registration-row="9"]'), null, 'o pai pago fica fora da abertura padrão');
  const statusFilter = doc.querySelector('[data-filter-field="STATUS"]');
  statusFilter.value = '';
  statusFilter.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const pencil = doc.querySelector('[data-registration-row="9"] [data-gallery-action="edit"]');
  assert.ok(pencil, "o item pai precisa oferecer o lápis");
  assert.equal(pencil.getAttribute("aria-label"), "Editar item de ID 9");
  assert.equal(doc.querySelector('[data-gallery-action="delete"]'), null);
  pencil.click();
  await waitFor(() => doc.querySelector('[data-dynamic-form]'));
  const form = doc.querySelector('[data-dynamic-form]');
  assert.deepEqual([...form.querySelectorAll('[name]')].map(control => control.name).sort(), [
    "FILIAL", "FORNECEDOR", "STATUS", "VALORTOTAL", "DATAPGTOEFETUADO", "OBS", "FORMAPGTO",
    "PGTOAGENDADO", "DATAPGTOAGENDADO", "DATAEXECUCAOAGENDAMENTO", "DATAPREVISTOPGTO",
  ].sort());
  const status = form.querySelector('[name="STATUS"]');
  assert.equal(status.tagName, 'SELECT');
  assert.equal(status.multiple, false);
  assert.equal(status.value, 'PAGAMENTO EFETUADO');
  assert.deepEqual([...status.options].map(option => option.value).filter(Boolean).sort(), ['PAGAMENTO EFETUADO', 'PAGAMENTO PREVISTO']);
  assert.equal(form.querySelector('[name="VALORTOTAL"]').type, "text");
  assert.equal(form.querySelector('[name="VALORTOTAL"]').value, "1234,56");
  assert.equal(form.querySelector('[name="PGTOAGENDADO"]').type, "datetime-local");
  assert.equal(form.querySelector('[name="PGTOAGENDADO"]').value, "2026-10-08T03:00");
  assert.equal(form.querySelector('[name="DATAPREVISTOPGTO"]').value, "2026-10-09T03:00");
  assert.match(form.querySelector('[name="DATAPREVISTOPGTO"]').closest('label').textContent, /DATA PREVISTO PGTO/);
  const draft = {
    FILIAL: "FILIAL B", FORNECEDOR: "FORNECEDOR B", VALORTOTAL: "2345,67", OBS: "ALTERADO", FORMAPGTO: "PIX",
    DATAPGTOEFETUADO: "2026-10-10T04:10", PGTOAGENDADO: "2026-10-11T05:20",
    DATAPGTOAGENDADO: "2026-10-12T06:30", DATAEXECUCAOAGENDAMENTO: "2026-10-13T07:40",
    DATAPREVISTOPGTO: "2026-10-14T08:50",
  };
  for (const [name, value] of Object.entries(draft)) {
    if (['FILIAL', 'FORNECEDOR', 'FORMAPGTO'].includes(name)) {
      const field = form.querySelector(`[data-searchable-field="${name}"]`);
      const search = field.querySelector('.searchable-select-input');
      search.value = value;
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      const option = [...field.querySelectorAll('[role="option"]')].find(item => item.textContent === value);
      assert.ok(option, `${name} must offer ${value}`);
      option.click();
    } else form.querySelector(`[name="${name}"]`).value = value;
  }
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => fixture.writes.length === 2 && !doc.querySelector('[data-gallery-record-screen]'));
  assert.ok(fixture.reads.length>=3,'baseline, conditional edit and readback are required');
  assert.ok(fixture.reads.filter(read=>read[1]==='parent-list-id').every(read=>JSON.stringify(read)===JSON.stringify(["personal", "parent-list-id", "9", "$expand=fields"])));
  assert.deepEqual(fixture.writes.filter(write=>write[1]==='parent-list-id').map(([site, list, id, values, options]) => [site, list, id, values, options.eTag]), [["personal", "parent-list-id", "9", {
    FILIAL: "FILIAL B", FORNECEDOR: "FORNECEDOR B", VALORTOTAL: "2345,67", OBS: "ALTERADO", FORMAPGTO: "PIX",
    DATAPGTOEFETUADO: "2026-10-10T04:10:00", PGTOAGENDADO: "2026-10-11T05:20:00",
    DATAPGTOAGENDADO: "2026-10-12T06:30:00", DATAEXECUCAOAGENDAMENTO: "2026-10-13T07:40:00",
    DATAPREVISTOPGTO: "2026-10-14T08:50:00",
  }, '"parent-v7"']]);
  assert.ok(fixture.writes[0][4].signal instanceof AbortSignal, "a edição mantém o cancelamento durante a gravação");
  assert.equal(fixture.child.fields.VALORTOTAL, '2345.67', 'o total editado no pai ajusta a única provisão vinculada');
  assert.equal(fixture.child.fields.FILIAL, 'FILIAL B');
  assert.equal(fixture.child.fields.FORNECEDOR, 'FORNECEDOR B');
  assert.equal(doc.querySelector('[data-gallery-action="delete"]'), null, "atualizar a galeria mantém somente edição");
});

test("editor do pai rejeita campos de identidade, auditoria e relacionamento fora da whitelist", async () => {
  const fixture = parentFixture();
  const context = await fixture.data.loadEditor("9");
  for (const name of ["ID", "Title", "Created", "Modified", "AuthorLookupId", "EditorLookupId", "IDPROVISAOLookupId", "EXTRA"]) {
    await assert.rejects(fixture.data.saveEditor(context, { OBS: "ALTERADO", [name]: "INVÁLIDO" }), /não é editável/);
  }
  assert.deepEqual(fixture.writes, []);
});

test("editor do pai não permite sobrescrever Title mesmo com rótulo igual a um campo permitido", async () => {
  const fixture = parentFixture({ tokenLabel: "FILIAL" });
  const context = await fixture.data.loadEditor("9");
  await assert.rejects(fixture.data.saveEditor(context, { Title: "ALTERADO" }), /não é editável/);
  assert.deepEqual(fixture.writes, []);
});

test("menu deduplica o atalho pai e reserva três galerias para lançamentos e quatro para provisões", () => {
  const dom = new JSDOM('<!doctype html><body><main id="app"></main></body>');
  const doc = dom.window.document, root = doc.querySelector("#app");
  const view = createChatView(root);
  const store = createConversationStore();
  const state = { ...store.getState(), sessionStatus: "authenticated", account: { homeAccountId: "a", name: "Bernardo" }, messages: [{
    id: "menu", role: "assistant", type: "poll", question: "📦 SUPRIMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?", options: [
      { id: "new_document", reply: "new_document", label: "LANÇAMENTOS" },
      { id: "payment", reply: "payment", label: "PROVISÃO DE PAGAMENTO" },
      { id: "action_provision_description_gallery", reply: "action_provision_description_gallery", label: "ATALHO ANTIGO" },
    ],
  }] };
  view.render(state);
  const style = doc.createElement("style"); style.textContent = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8").replace(/^@import[^;]+;/gm, ""); doc.head.append(style);
  const pairs = [...root.querySelectorAll(".chat-supplies-pair")];
  assert.equal(pairs[0].querySelectorAll("[data-gallery-button]").length, 3);
  assert.equal(dom.window.getComputedStyle(pairs[0].querySelector(".chat-gallery-actions")).gridTemplateRows, "repeat(3, minmax(var(--supplies-gallery-height), 1fr))");
  assert.equal(pairs[1].querySelectorAll("[data-gallery-button]").length, 4);
  assert.equal(dom.window.getComputedStyle(pairs[1].querySelector(".chat-gallery-actions")).gridTemplateRows, "repeat(4, minmax(var(--supplies-gallery-height), 1fr))");
  assert.equal(root.querySelectorAll('[data-reply-id="action_provision_description_gallery"]').length, 1);
  const events = []; view.on("select-reply", event => events.push(event.replyId));
  root.querySelector('[data-reply-id="action_provision_description_gallery"]').click();
  assert.deepEqual(events, ["action_provision_description_gallery"]);
  view.render({ ...state, activeText: "sending" });
  assert.equal(root.querySelector('[data-reply-id="action_provision_description_gallery"]').disabled, true);
  view.destroy(); dom.window.close();
});
