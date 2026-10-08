import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createRegistrationGalleryData } from "../src/chat/registration-gallery-data.js";
import { createRegistrationGallery } from "../src/ui/registration-gallery-view.js";
import { createChatView } from "../src/ui/chat-view.js";
import { createConversationStore } from "../src/chat/conversation-store.js";

test("descritivo provisão consulta todas as páginas da lista pai, mapeia datas e ordena por maior ID", async () => {
  const calls = [];
  const data = createRegistrationGalleryData({ kind: "provisionDescription", repository: {
    async resolveList(site, aliases) { calls.push([site, aliases]); return { status: "resolved", id: "parent-list" }; },
    async getColumns() { return [{ name: "DATAPREVISTOPGTO", displayName: "DATA PREVISTO PGTO", dateTime: {} }]; },
    async getItemsPage(site, list, query, options) {
      assert.equal(site, "personal"); assert.equal(list, "parent-list");
      return options.cursor ? { items: [{ id: "9", fields: { FORNECEDOR: "B", VALORTOTAL: "1234,56", DATAPREVISTOPGTO: "2026-10-09T03:00:00Z" } }], hasMore: false }
        : { items: [{ id: "2", fields: { FORNECEDOR: "A", VALORTOTAL: "10" } }], hasMore: true, nextLink: "next-page" };
    },
  } });
  const snapshot = await data.loadSnapshot();
  assert.deepEqual(calls, [["personal", ["DESCRITIVOPROVISAO"]]]);
  assert.equal(snapshot.listName, "DESCRITIVOPROVISAO");
  assert.deepEqual(snapshot.rows.map(row => row.id), ["9", "2"]);
  assert.equal(snapshot.rows[0].fields["DATA PREVISTO PGTO"], "2026-10-09T03:00:00Z");
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
    FORMAPGTO: "CAIXA", DATAPGTOEFETUADO: "2026-10-08T03:00:00Z",
    PGTOAGENDADO: "2026-10-08T03:00:00Z", DATAPGTOAGENDADO: "2026-10-08T03:00:00Z",
    DATAEXECUCAOAGENDAMENTO: "2026-10-08T03:00:00Z", DATAPREVISTOPGTO: "2026-10-09T03:00:00Z",
    ID: 9, Title: "IDEMPOTENCY-TOKEN", Created: "2026-10-07T03:00:00Z",
    Modified: "2026-10-08T03:00:00Z", AuthorLookupId: 1, EditorLookupId: 2,
    IDPROVISAOLookupId: 31, EXTRA: "NÃO EDITÁVEL", Attachments: false,
  } };
  const reads = [], writes = [];
  function assertParent(site, list) { assert.equal(site, "personal"); assert.equal(list, "parent-list-id"); }
  const data = createRegistrationGalleryData({ kind: "provisionDescription", repository: Object.freeze({
    async resolveList(site, aliases) {
      assert.equal(site, "personal"); assert.deepEqual(aliases, ["DESCRITIVOPROVISAO"]);
      return { status: "resolved", id: "parent-list-id" };
    },
    async getColumns(site, list) { assertParent(site, list); return columns; },
    async getItemsPage(site, list) {
      assertParent(site, list);
      return { items: [{ ...item, eTag: '"snapshot-v2"' }], hasMore: false };
    },
    async getItem(site, list, id, query) {
      assertParent(site, list); reads.push([site, list, id, query]); return item;
    },
    async updateItem(site, list, id, fields, options) {
      assertParent(site, list); writes.push([site, list, id, fields, options]);
      return { id, eTag: '"parent-v8"', fields: { ...item.fields, ...fields } };
    },
    async deleteItem() { assert.fail("nenhuma exclusão foi autorizada"); },
    async createItem() { assert.fail("edição não cria registros nem filhos"); },
  }) });
  return { data, reads, writes };
}

test("lápis abre o formulário real do pai e salva só campos comprovados com o ETag carregado", async t => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const doc = dom.window.document, fixture = parentFixture();
  const gallery = createRegistrationGallery({ document: doc, kind: "provisionDescription", data: fixture.data });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  const pencil = doc.querySelector('[data-registration-row="9"] [data-gallery-action="edit"]');
  assert.ok(pencil, "o item pai precisa oferecer o lápis");
  assert.equal(pencil.getAttribute("aria-label"), "Editar item de ID 9");
  assert.equal(doc.querySelector('[data-gallery-action="delete"]'), null);
  pencil.click();
  await waitFor(() => doc.querySelector('[data-dynamic-form]'));
  const form = doc.querySelector('[data-dynamic-form]');
  assert.deepEqual([...form.querySelectorAll('[name]')].map(control => control.name).sort(), [
    "FILIAL", "FORNECEDOR", "VALORTOTAL", "DATAPGTOEFETUADO", "OBS", "FORMAPGTO",
    "PGTOAGENDADO", "DATAPGTOAGENDADO", "DATAEXECUCAOAGENDAMENTO", "DATAPREVISTOPGTO",
  ].sort());
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
  for (const [name, value] of Object.entries(draft)) form.querySelector(`[name="${name}"]`).value = value;
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => fixture.writes.length === 1 && !doc.querySelector('[data-gallery-record-screen]'));
  assert.deepEqual(fixture.reads, [["personal", "parent-list-id", "9", "$expand=fields"]]);
  assert.deepEqual(fixture.writes, [["personal", "parent-list-id", "9", {
    FILIAL: "FILIAL B", FORNECEDOR: "FORNECEDOR B", VALORTOTAL: "2345,67", OBS: "ALTERADO", FORMAPGTO: "PIX",
    DATAPGTOEFETUADO: "2026-10-10T04:10:00", PGTOAGENDADO: "2026-10-11T05:20:00",
    DATAPGTOAGENDADO: "2026-10-12T06:30:00", DATAEXECUCAOAGENDAMENTO: "2026-10-13T07:40:00",
    DATAPREVISTOPGTO: "2026-10-14T08:50:00",
  }, { eTag: '"parent-v7"' }]]);
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

test("menu deduplica o atalho pai, envia a ação correta e reserva três linhas só para provisões", () => {
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
  assert.equal(pairs[0].querySelectorAll("[data-gallery-button]").length, 2);
  assert.equal(pairs[1].querySelectorAll("[data-gallery-button]").length, 3);
  assert.equal(dom.window.getComputedStyle(pairs[1].querySelector(".chat-gallery-actions")).gridTemplateRows, "repeat(3, minmax(var(--supplies-gallery-height), 1fr))");
  assert.equal(root.querySelectorAll('[data-reply-id="action_provision_description_gallery"]').length, 1);
  const events = []; view.on("select-reply", event => events.push(event.replyId));
  root.querySelector('[data-reply-id="action_provision_description_gallery"]').click();
  assert.deepEqual(events, ["action_provision_description_gallery"]);
  view.render({ ...state, activeText: "sending" });
  assert.equal(root.querySelector('[data-reply-id="action_provision_description_gallery"]').disabled, true);
  view.destroy(); dom.window.close();
});
