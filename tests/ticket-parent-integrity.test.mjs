import test from "node:test";
import assert from "node:assert/strict";

import { mapSharePointColumns, validateFormValues } from "../portal/data/column-mapper.js";
import { formMarkup } from "../portal/ui/dynamic-form.js";
import { createTicketViewPage } from "../portal/tickets/ticket-view-page.js";
import { createTicketViewService } from "../portal/tickets/ticket-view-service.js";

const ticketEntity = Object.freeze({
  id: "tickets-clientes",
  moduleId: "demandas",
  siteKey: "company",
  listNames: Object.freeze(["TICKETS CLIENTES"]),
  immutableFields: Object.freeze(["TicketCodigo", "ClienteNome"]),
  capabilities: Object.freeze({ view: true, edit: true, delete: true }),
});

const movementEntity = Object.freeze({
  id: "movimentacoes-de-ticket",
  moduleId: "demandas",
  siteKey: "company",
  listNames: Object.freeze(["TICKET MOVIMENTACOES", "TICKET MOVIMENTAÇÕES"]),
  immutableFields: Object.freeze(["TicketPai", "TicketCodigo", "ClienteNome"]),
  capabilities: Object.freeze({ view: true, edit: true, delete: true }),
});

const ticketColumns = [
  { name: "TicketCodigo", text: {} },
  { name: "ClienteNome", text: {} },
  { name: "Status", choice: { choices: ["ATIVO", "INATIVO"] } },
];

const movementColumns = [
  { name: "TicketPai", lookup: { listId: "tickets", columnName: "TicketCodigo", allowMultipleValues: false } },
  { name: "TicketCodigo", text: {} },
  { name: "ClienteNome", text: {} },
  { name: "AutorTipo", text: {} },
  { name: "AutorNome", text: {} },
  { name: "Mensagem", text: { allowMultipleLines: true } },
  { name: "StatusNovo", text: {} },
];

test("arquivamento genérico exige simultaneamente os direitos de excluir e editar", async () => {
  const module = await import("../portal/ui/item-detail.js");
  assert.equal(typeof module.getItemDetailActions, "function");
  const actions = module.getItemDetailActions(
    { ...ticketEntity, capabilities: { view: true, edit: false, delete: true }, deletionPolicy: "archive" },
    { active: true },
    (_access, _moduleId, action) => action === "delete",
  );

  assert.equal(actions.delete, false);
});

function repositoryFor(movements, calls = []) {
  return {
    async resolveList(_siteKey, aliases) {
      return { status: "resolved", id: aliases[0] === "TICKETS CLIENTES" ? "tickets" : "movements" };
    },
    async getColumns(_siteKey, listId) {
      return listId === "tickets" ? ticketColumns : movementColumns;
    },
    async getItem() {
      return {
        id: "7",
        eTag: '"ticket-1"',
        fields: { TicketCodigo: "3", ClienteNome: "CLIENTE A", Status: "ATIVO" },
      };
    },
    async getItemsPage(_siteKey, _listId, query) {
      calls.push(["getItemsPage", String(query)]);
      return { items: movements, nextLink: "", hasMore: false, batchCount: movements.length };
    },
    async listAttachments(_siteKey, _listId, itemId) {
      calls.push(["listAttachments", String(itemId)]);
      return [{ name: `${itemId}.pdf`, size: 100, type: "application/pdf" }];
    },
  };
}

test("recusa movimentação do CLIENTE B mesmo quando ela reutiliza o código do ticket do CLIENTE A", async () => {
  const calls = [];
  const repository = repositoryFor([{
    id: "91",
    fields: {
      TicketPaiLookupId: 7,
      TicketCodigo: "3",
      ClienteNome: "CLIENTE B",
      Mensagem: "NÃO PERTENCE AO CLIENTE A",
    },
  }], calls);
  const service = createTicketViewService({ repository, entities: [ticketEntity, movementEntity] });

  await assert.rejects(() => service.load("7"), /cliente diferente/i);
  assert.deepEqual(calls.filter(call => call[0] === "listAttachments"), []);
});

test("recusa movimentação ligada a outro item-pai ainda que CLIENTE A e B tenham o mesmo TicketCodigo", async () => {
  const calls = [];
  const repository = repositoryFor([{
    id: "92",
    fields: {
      TicketPaiLookupId: 8,
      TicketCodigo: "3",
      ClienteNome: "CLIENTE B",
      Mensagem: "FILHO DO TICKET 8",
    },
  }], calls);
  const service = createTicketViewService({ repository, entities: [ticketEntity, movementEntity] });

  await assert.rejects(() => service.load("7"), /item-pai diferente/i);
  const query = new URLSearchParams(calls.find(call => call[0] === "getItemsPage")?.[1]);
  assert.equal(query.get("$filter"), "fields/TicketPaiLookupId eq 7");
  assert.deepEqual(calls.filter(call => call[0] === "listAttachments"), []);
});

test("recusa TicketPai que aponta para qualquer lista diferente de TICKETS CLIENTES", async () => {
  let pageCalls = 0;
  const repository = {
    ...repositoryFor([]),
    async getColumns(_siteKey, listId) {
      if (listId === "tickets") return ticketColumns;
      return movementColumns.map(column => column.name === "TicketPai"
        ? { ...column, lookup: { ...column.lookup, listId: "clientes" } }
        : column);
    },
    async getItemsPage() {
      pageCalls += 1;
      return { items: [], nextLink: "", hasMore: false, batchCount: 0 };
    },
  };
  const service = createTicketViewService({ repository, entities: [ticketEntity, movementEntity] });

  await assert.rejects(() => service.load("7"), /não referencia a lista TICKETS CLIENTES/i);
  assert.equal(pageCalls, 0);
});

test("formulário genérico não oferece nem envia campos imutáveis de vínculo de ticket", () => {
  const descriptors = mapSharePointColumns(movementColumns, movementEntity);
  const markup = formMarkup({
    entity: movementEntity,
    columns: descriptors,
    mode: "edit",
    values: { TicketPaiLookupId: 7, TicketCodigo: "3", ClienteNome: "CLIENTE A", Mensagem: "EDITÁVEL" },
  });
  const validation = validateFormValues({
    TicketPai: "8",
    TicketCodigo: "999",
    ClienteNome: "CLIENTE B",
    Mensagem: "MENSAGEM ALTERADA",
  }, descriptors, movementEntity, { mode: "edit" });

  assert.doesNotMatch(markup, /name="TicketPai"|name="TicketCodigo"|name="ClienteNome"/);
  assert.deepEqual(validation.errors, {});
  assert.deepEqual(validation.fields, { Mensagem: "MENSAGEM ALTERADA" });
});

function ticketPageRoot() {
  const listeners = new Map();
  const archiveButton = {
    addEventListener(name, listener) { listeners.set(name, listener); },
  };
  return {
    root: {
      innerHTML: "",
      querySelector(selector) {
        if (selector === "[data-ticket-delete]") return archiveButton;
        return null;
      },
      querySelectorAll() { return []; },
    },
    clickArchive() { return listeners.get("click")?.(); },
  };
}

test("arquivar ticket com movimentações preserva filhos e anexos e nunca exclui o cabeçalho", async () => {
  const calls = [];
  const repository = {
    ...repositoryFor([{
      id: "93",
      eTag: '"movement-1"',
      fields: {
        TicketPaiLookupId: 7,
        TicketCodigo: "3",
        ClienteNome: "CLIENTE A",
        Mensagem: "HISTÓRICO PRESERVADO",
      },
    }], calls),
    async updateItem(siteKey, listId, itemId, fields, options) {
      calls.push(["updateItem", siteKey, listId, itemId, fields, options]);
      return { id: itemId, eTag: '"ticket-2"', fields: { TicketCodigo: "3", ClienteNome: "CLIENTE A", Status: "INATIVO" } };
    },
    async deleteItem() {
      assert.fail("arquivar um ticket nunca pode excluir o cabeçalho ou seus filhos");
    },
  };
  const fixture = ticketPageRoot();
  const page = createTicketViewPage(fixture.root, {
    repository,
    entities: [ticketEntity, movementEntity],
    access: { active: true },
    can: () => true,
    itemId: "7",
    confirmDelete: async () => true,
  });
  await page.ready;

  assert.match(fixture.root.innerHTML, /Arquivar ticket/);
  await fixture.clickArchive();

  const updates = calls.filter(call => call[0] === "updateItem");
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].slice(1), ["company", "tickets", "7", { Status: "INATIVO" }, { eTag: '"ticket-1"' }]);
  assert.ok(calls.some(call => call[0] === "listAttachments" && call[1] === "93"));
  page.cleanup();
});
