import test from "node:test";
import assert from "node:assert/strict";
import { createOrdersGalleryData, createPendingProvisionAttachmentsData, OrdersGalleryDataError } from "../src/chat/orders-gallery-data.js";

function repositoryHarness(overrides = {}) {
  const calls = [];
  const pages = [
    { items: [
      { id: "319", fields: { FILIAL: "004 - EDIFÍCIO XAVANTE", FORNECEDOR: "IMPERMATEX", FORMAPGTO: "CAIXA", VALORTOTAL: 650, STATUS: "PENDENTE AUDITORIA", "NOTA_x0020_FISCAL": "PENDENTE", Criado: "2026-09-21T16:48:00Z", "Tem anexos": true } },
      { id: "320", fields: { FILIAL: "004 - EDIFÍCIO XAVANTE", FORNECEDOR: "COFER", FORMAPGTO: "ENERGÉTICA - CAIXA", VALORTOTAL: 765.6, STATUS: "PAGO", "NOTA FISCAL": "NF-55", Criado: "2026-09-21T17:12:00Z", DATAPGTOEFETUADO: "2026-09-22T12:00:00Z", OBS: "Pedido liberado", "OBS FISCAL": "Recebida", "Criado por": { DisplayName: "Bernardo Notini" }, "Modificado por": { DisplayName: "Bernardo Notini" }, Modificado: "2026-09-21T17:12:00Z", "Tem anexos": true } },
    ], nextLink: "cursor-2", hasMore: true },
    { items: [{ id: "318", fields: { FILIAL: "001 - CENTRAL", FORNECEDOR: "RAFAEL", STATUS: "PENDENTE AUDITORIA", "Tem anexos": false } }], nextLink: "", hasMore: false },
  ];
  const repository = {
    async resolveList(...args) {
      calls.push(["resolveList", ...args]);
      return { status: "resolved", id: "list-notas" };
    },
    async getItemsPage(...args) {
      calls.push(["getItemsPage", ...args]);
      return pages.shift();
    },
    async listAttachments(...args) {
      calls.push(["listAttachments", ...args]);
      return [
        { name: "pedido.pdf", type: "application/pdf", size: 2048, uploadedAt: "2026-09-21T17:00:00Z" },
        { name: "foto.jpg", type: "image/jpeg", size: 4096 },
      ];
    },
    async downloadAttachment(...args) {
      calls.push(["downloadAttachment", ...args]);
      return new Uint8Array([37, 80, 68, 70, 45]).buffer;
    },
    ...overrides,
  };
  return { repository, calls };
}

test("carrega a lista Screen10 autenticada, percorre páginas e normaliza os campos dos pedidos", async () => {
  const { repository, calls } = repositoryHarness();
  const signal = new AbortController().signal;
  const gallery = createOrdersGalleryData({ repository });

  const snapshot = await gallery.loadSnapshot({ signal });

  assert.equal(snapshot.listName, "NOTASPENDENTES");
  assert.equal(snapshot.rows.length, 3);
  assert.deepEqual(snapshot.rows.map(row => row.id), ["320", "319", "318"]);
  assert.equal(snapshot.rows[0].fields.FORNECEDOR, "COFER");
  assert.equal(snapshot.rows[0].fields["NOTA FISCAL"], "NF-55");
  assert.equal(snapshot.rows[0].fields.VALORTOTAL, 765.6);
  assert.equal(snapshot.rows[0].fields["Criado por"], "Bernardo Notini");
  assert.equal(snapshot.rows[0].hasAttachments, true);
  assert.equal(snapshot.rows[2].hasAttachments, false);
  assert.equal(calls.filter(([name]) => name === "getItemsPage").length, 2);
  assert.equal(calls[0][1], "personal");
  assert.deepEqual(calls[0][2], ["NOTASPENDENTES"]);
  assert.equal(calls[1][1], "personal");
  assert.equal(calls[1][2], "list-notas");
  assert.equal(calls[1][4].signal, signal);
});

test("lista e baixa anexos do pedido usando a API SharePoint com o ID do item", async () => {
  const { repository, calls } = repositoryHarness();
  const gallery = createOrdersGalleryData({ repository });

  const attachments = await gallery.listAttachments("320");
  const file = await gallery.downloadAttachment("320", "pedido.pdf");

  assert.deepEqual(attachments.map(({ fileName, mimeType, size }) => ({ fileName, mimeType, size })), [
    { fileName: "pedido.pdf", mimeType: "application/pdf", size: 2048 },
    { fileName: "foto.jpg", mimeType: "image/jpeg", size: 4096 },
  ]);
  assert.equal(file.type, "application/pdf");
  assert.equal(file.size, 5);
  assert.deepEqual(calls.filter(([name]) => name === "listAttachments")[0].slice(1, 4), ["personal", "list-notas", "320"]);
  assert.deepEqual(calls.filter(([name]) => name === "downloadAttachment")[0].slice(1, 5), ["personal", "list-notas", "320", "pedido.pdf"]);
});

test("atualiza somente a data prevista da provisão com o ETag atual", async () => {
  const calls = [];
  const repository = {
    async resolveList(...args) { calls.push(["resolveList", ...args]); return { status: "resolved", id: "list-provisions" }; },
    async getItemsPage() { return { items: [], hasMore: false }; },
    async getItem(...args) { calls.push(["getItem", ...args]); return { id: "306", eTag: "etag-306", fields: { FORNECEDOR: "DIBRITA" } }; },
    async getColumns(...args) { calls.push(["getColumns", ...args]); return [
      { name: "Title", displayName: "Título", readOnly: false },
      { name: "Data_x0020_Previsto_x0020_PGTO", displayName: "DATA PREVISTO PGTO", readOnly: false },
      { name: "STATUS", displayName: "STATUS", readOnly: false },
    ]; },
    async updateItem(...args) { calls.push(["updateItem", ...args]); return { id: "306" }; },
  };
  const data = createPendingProvisionAttachmentsData({ repository });

  await data.updateDueDate("306", "2026-10-07");

  const update = calls.find(([name]) => name === "updateItem");
  assert.deepEqual(update.slice(1, 4), ["personal", "list-provisions", "306"]);
  assert.deepEqual(Object.keys(update[4]), ["Data_x0020_Previsto_x0020_PGTO"]);
  assert.match(update[4].Data_x0020_Previsto_x0020_PGTO, /^2026-10-07T/);
  assert.equal(update[5].eTag, "etag-306");
});

test("recusa datas impossíveis e nunca atualiza sem ETag", async () => {
  let updates = 0;
  const repository = {
    async resolveList() { return { status: "resolved", id: "list-provisions" }; },
    async getItemsPage() { return { items: [], hasMore: false }; },
    async getItem() { return { id: "306", fields: {} }; },
    async getColumns() { return [{ name: "DATA_PREVISTO_PGTO", displayName: "Data Previsto Pgto", readOnly: false }]; },
    async updateItem() { updates += 1; },
  };
  const data = createPendingProvisionAttachmentsData({ repository });

  await assert.rejects(data.updateDueDate("306", "2026-02-29"), /data/i);
  await assert.rejects(data.updateDueDate("306", "2026-10-07"), /ETag|versão/i);
  await assert.rejects(data.updateDueDate("../306", "2026-10-07"), /ID/i);
  assert.equal(updates, 0);
});

test("upload da provisão invalida o cache de anexos e permite reler do SharePoint", async () => {
  let listed = 0;
  const calls = [];
  const repository = {
    async resolveList() { return { status: "resolved", id: "list-provisions" }; },
    async getItemsPage() { return { items: [], hasMore: false }; },
    async listAttachments(...args) { calls.push(["listAttachments", ...args]); listed += 1; return listed === 1 ? [] : [{ name: "novo.pdf", size: 12 }]; },
    async uploadAttachment(...args) { calls.push(["uploadAttachment", ...args]); return { name: "novo.pdf" }; },
  };
  const data = createPendingProvisionAttachmentsData({ repository });
  const file = new File(["conteúdo"], "novo.pdf", { type: "application/pdf" });

  assert.deepEqual(await data.listAttachments("306"), []);
  await data.uploadAttachment("306", file);
  const refreshed = await data.listAttachments("306");

  assert.equal(refreshed[0].fileName, "novo.pdf");
  assert.equal(calls.filter(([name]) => name === "listAttachments").length, 2);
  assert.deepEqual(calls.find(([name]) => name === "uploadAttachment").slice(1, 4), ["personal", "list-provisions", "306"]);
  assert.equal(calls.find(([name]) => name === "uploadAttachment")[4], file);
});

test("não inventa uma lista nem vaza erro interno quando NOTASPENDENTES não existe", async () => {
  const { repository } = repositoryHarness({
    async resolveList() { return { status: "missing", aliases: ["NOTASPENDENTES"] }; },
  });
  const gallery = createOrdersGalleryData({ repository });

  await assert.rejects(gallery.loadSnapshot(), error => {
    assert.ok(error instanceof OrdersGalleryDataError);
    assert.equal(error.code, "orders_list_missing");
    assert.match(error.message, /NOTASPENDENTES/);
    assert.doesNotMatch(error.message, /stack|token|https?:/i);
    return true;
  });
});

test("mantém presença de anexos desconhecida quando Graph não informa essa coluna", async () => {
  const { repository } = repositoryHarness({
    async getItemsPage() { return { items: [{ id: "400", fields: { FORNECEDOR: "COFER" } }], hasMore: false }; },
  });
  const gallery = createOrdersGalleryData({ repository });
  const snapshot = await gallery.loadSnapshot();
  assert.equal(snapshot.rows[0].hasAttachments, null);
});

test("usa o autor humano do item antes do campo SharePoint e não exibe a conta técnica", async () => {
  const { repository } = repositoryHarness({
    async getItemsPage() {
      return { items: [
        {
          id: "401",
          createdBy: { user: { displayName: "Bernardo Notini" } },
          lastModifiedBy: { user: { displayName: "Ana Souza" } },
          fields: { "Criado por": "SharePoint App", "Modificado por": "SharePoint App" },
        },
        {
          id: "402",
          createdBy: { application: { displayName: "SharePoint App" } },
          fields: { "Criado por": 1073741822 },
        },
      ], hasMore: false };
    },
  });
  const gallery = createOrdersGalleryData({ repository });
  const snapshot = await gallery.loadSnapshot();

  assert.equal(snapshot.rows.find(row => row.id === "401").fields["Criado por"], "Bernardo Notini");
  assert.equal(snapshot.rows.find(row => row.id === "401").fields["Modificado por"], "Ana Souza");
  assert.equal(snapshot.rows.find(row => row.id === "402").fields["Criado por"], "Usuário não identificado");
});

test("usa Graph Sites.Read.All para listar itens pela origem SharePoint configurada", async () => {
  const requestedScopes = [];
  const tokenProvider = async scopes => { requestedScopes.push(scopes); return "test-token"; };
  const fetchImpl = async url => {
    const value = String(url);
    if (value.includes("/sites/energeticaltda-my.sharepoint.com:")) return Response.json({ id: "site-personal" });
    if (value.includes("/lists?") && !value.includes("/items?")) return Response.json({ value: [{ id: "list-notas", displayName: "NOTASPENDENTES", list: { template: "genericList" } }] });
    if (value.includes("/lists/list-notas/items?")) return Response.json({ value: [{ id: "320", fields: { FORNECEDOR: "COFER" } }] });
    throw new Error(`Unexpected URL: ${value}`);
  };
  const gallery = createOrdersGalleryData({ tokenProvider, fetchImpl });

  const snapshot = await gallery.loadSnapshot();

  assert.equal(snapshot.rows[0].fields.FORNECEDOR, "COFER");
  assert.ok(requestedScopes.length > 0);
  assert.ok(requestedScopes.every(scopes => scopes.includes("Sites.Read.All")));
});
