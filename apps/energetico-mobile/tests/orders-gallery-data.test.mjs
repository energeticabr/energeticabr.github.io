import test from "node:test";
import assert from "node:assert/strict";
import { createOrdersGalleryData, OrdersGalleryDataError } from "../src/chat/orders-gallery-data.js";

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
