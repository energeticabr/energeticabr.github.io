import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const contractModuleUrl = new URL("../portal/tickets/ticket-contract.js", import.meta.url);
const serviceModuleUrl = new URL("../portal/tickets/ticket-view-service.js", import.meta.url);
const pageModuleUrl = new URL("../portal/tickets/ticket-view-page.js", import.meta.url);

async function loadContractModule() {
  try {
    return await import(contractModuleUrl);
  } catch {
    return null;
  }
}

async function loadServiceModule() {
  try {
    return await import(serviceModuleUrl);
  } catch {
    return null;
  }
}

async function loadPageModule() {
  try {
    return await import(pageModuleUrl);
  } catch {
    return null;
  }
}

test("o contrato de ticket exige lookup pai e cliente além dos campos operacionais", async () => {
  const module = await loadContractModule();

  assert.ok(module, "o contrato específico da visualização unificada deve existir");
  assert.deepEqual(module.TICKET_VIEW_CONTRACT.ticket.fields, {
    code: "TicketCodigo",
    customer: "ClienteNome",
    status: "Status",
  });
  assert.deepEqual(module.TICKET_VIEW_CONTRACT.movement.fields, {
    parent: "TicketPai",
    ticketCode: "TicketCodigo",
    customer: "ClienteNome",
    authorType: "AutorTipo",
    authorName: "AutorNome",
    message: "Mensagem",
    status: "StatusNovo",
  });
  assert.equal(module.TICKET_VIEW_CONTRACT.orderBy, "createdDateTime");
  assert.equal(module.TICKET_VIEW_CONTRACT.relation.parentField, "TicketPai");
  assert.equal(module.TICKET_VIEW_CONTRACT.relation.parentLookupField, "TicketPaiLookupId");
  assert.equal(module.TICKET_VIEW_CONTRACT.relation.ticketCodeField, "TicketCodigo");
  assert.equal(module.TICKET_VIEW_CONTRACT.relation.movementTicketCodeField, "TicketCodigo");
  assert.equal(module.TICKET_VIEW_CONTRACT.relation.ticketCustomerField, "ClienteNome");
  assert.equal(module.TICKET_VIEW_CONTRACT.relation.movementCustomerField, "ClienteNome");
  assert.doesNotMatch(JSON.stringify(module.TICKET_VIEW_CONTRACT.relation), /Title|Mensagem|texto/i);
  assert.deepEqual(module.TICKET_VIEW_CONTRACT.evidence.artifacts, [
    "GALERIA TICKETS.pa.yaml",
    "MOVIMENTAÇÃO TICKETS.pa.yaml",
  ]);
  assert.deepEqual(module.TICKET_VIEW_CONTRACT.evidence.sha256, {
    "GALERIA TICKETS.pa.yaml": "0606a9e1ead5b6338ba3977f443ec3782de9b396e9fdc39f8dc8b51c00a830c6",
    "MOVIMENTAÇÃO TICKETS.pa.yaml": "261ac7a1c1a144a2566cc3cf7374682b7abd6d3d34f177d6fce3c466a3f4ec38",
  });
});

test("a validação do contrato exige os nomes internos exatos e não aceita aliases inferidos", async () => {
  const module = await loadContractModule();
  assert.equal(typeof module?.assertTicketContractColumns, "function");

  const ticketColumns = ["TicketCodigo", "ClienteNome", "Status"].map(name => ({ name }));
  const movementColumns = [
    { name: "TicketPai", lookup: { listId: "tickets", columnName: "TicketCodigo", allowMultipleValues: false } },
    ...["TicketCodigo", "ClienteNome", "AutorTipo", "AutorNome", "Mensagem", "StatusNovo"].map(name => ({ name })),
  ];

  assert.doesNotThrow(() => module.assertTicketContractColumns(ticketColumns, movementColumns));
  assert.throws(
    () => module.assertTicketContractColumns(ticketColumns, movementColumns.map(column => column.name === "TicketCodigo" ? { name: "TICKET" } : column)),
    /TicketCodigo/,
  );
});

const ticketEntity = Object.freeze({
  id: "tickets-clientes",
  moduleId: "demandas",
  siteKey: "company",
  listNames: Object.freeze(["TICKETS CLIENTES"]),
  capabilities: Object.freeze({ view: true, edit: true, delete: true }),
});

const movementEntity = Object.freeze({
  id: "movimentacoes-de-ticket",
  moduleId: "demandas",
  siteKey: "company",
  listNames: Object.freeze(["TICKET MOVIMENTACOES", "TICKET MOVIMENTAÇÕES"]),
  capabilities: Object.freeze({ view: true, edit: true, delete: true }),
});

const ticketColumns = ["TicketCodigo", "ClienteNome", "Status"].map(name => ({ name }));
const movementColumns = [
  { name: "TicketPai", lookup: { listId: "tickets", columnName: "TicketCodigo", allowMultipleValues: false } },
  ...["TicketCodigo", "ClienteNome", "AutorTipo", "AutorNome", "Mensagem", "StatusNovo"].map(name => ({ name })),
];

test("o serviço une cabeçalho e movimentações pela chave exata, pagina, ordena e anexa arquivos ao item correto", async () => {
  const module = await loadServiceModule();
  assert.equal(typeof module?.createTicketViewService, "function");
  const calls = [];
  const nextLink = "https://graph.microsoft.com/v1.0/sites/company/lists/movements/items?$skiptoken=next";
  const ticket = {
    id: "7",
    eTag: '"ticket-1"',
    createdDateTime: "2026-05-23T13:00:00Z",
    createdBy: { user: { displayName: "BERNARDO" } },
    fields: { TicketCodigo: "3", ClienteNome: "CLIENTE TESTE", Status: "ATIVO" },
  };
  const movements = [
    { id: "12", createdDateTime: "2026-05-23T14:00:00Z", fields: { TicketPaiLookupId: 7, TicketCodigo: "3", ClienteNome: "CLIENTE TESTE", AutorTipo: "Administrador", AutorNome: "BERNARDO", Mensagem: "SEGUNDA", StatusNovo: "ATIVO" } },
    { id: "11", createdDateTime: "2026-05-23T13:10:00Z", fields: { TicketPaiLookupId: 7, TicketCodigo: "3", ClienteNome: "CLIENTE TESTE", AutorTipo: "Cliente", AutorNome: "CLIENTE TESTE", Mensagem: "PRIMEIRA", StatusNovo: "PENDENTE" } },
  ];
  let page = 0;
  const repository = {
    async resolveList(siteKey, aliases) {
      calls.push(["resolveList", siteKey, [...aliases]]);
      return { status: "resolved", id: aliases[0] === "TICKETS CLIENTES" ? "tickets" : "movements" };
    },
    async getColumns(_siteKey, listId) {
      return listId === "tickets" ? ticketColumns : movementColumns;
    },
    async getItem(siteKey, listId, itemId, query) {
      calls.push(["getItem", siteKey, listId, itemId, query]);
      return ticket;
    },
    async getItemsPage(siteKey, listId, query, options) {
      calls.push(["getItemsPage", siteKey, listId, query, { ...options }]);
      page += 1;
      return page === 1
        ? { items: [movements[0]], nextLink, hasMore: true, batchCount: 1 }
        : { items: [movements[1]], nextLink: "", hasMore: false, batchCount: 1 };
    },
    async listAttachments(siteKey, listId, itemId) {
      calls.push(["listAttachments", siteKey, listId, itemId]);
      return [{ name: `ARQUIVO-${itemId}.pdf`, size: 1200, type: "application/pdf" }];
    },
  };

  const service = module.createTicketViewService({ repository, entities: [ticketEntity, movementEntity] });
  const result = await service.load("7");

  assert.equal(result.ticket, ticket);
  assert.deepEqual(result.movements.map(item => item.id), ["11", "12"]);
  assert.deepEqual(result.movements.map(item => item.attachments[0].name), ["ARQUIVO-11.pdf", "ARQUIVO-12.pdf"]);
  const pageCalls = calls.filter(call => call[0] === "getItemsPage");
  assert.equal(pageCalls.length, 2);
  const query = new URLSearchParams(pageCalls[0][3]);
  assert.equal(query.get("$expand"), "fields");
  assert.equal(query.get("$filter"), "fields/TicketPaiLookupId eq 7");
  assert.equal(query.get("$top"), "50");
  assert.equal(pageCalls[1][4].cursor, nextLink);
  assert.deepEqual(calls.filter(call => call[0] === "listAttachments").map(call => call.slice(1)), [
    ["company", "movements", "12"],
    ["company", "movements", "11"],
  ]);
});

test("o serviço falha fechado se uma página trouxer movimentação de outro ticket", async () => {
  const module = await loadServiceModule();
  assert.equal(typeof module?.createTicketViewService, "function");
  let attachmentCalls = 0;
  const repository = {
    async resolveList(_siteKey, aliases) { return { status: "resolved", id: aliases[0] === "TICKETS CLIENTES" ? "tickets" : "movements" }; },
    async getColumns(_siteKey, listId) { return listId === "tickets" ? ticketColumns : movementColumns; },
    async getItem() { return { id: "7", fields: { TicketCodigo: "3", ClienteNome: "CLIENTE", Status: "ATIVO" } }; },
    async getItemsPage() {
      return { items: [{ id: "99", fields: { TicketPaiLookupId: 7, TicketCodigo: "30", ClienteNome: "CLIENTE", Mensagem: "NÃO PERTENCE" } }], nextLink: "", hasMore: false };
    },
    async listAttachments() { attachmentCalls += 1; return []; },
  };
  const service = module.createTicketViewService({ repository, entities: [ticketEntity, movementEntity] });

  await assert.rejects(() => service.load("7"), /outro ticket/i);
  assert.equal(attachmentCalls, 0);
});

test("o serviço limita a concorrência dos anexos sem omitir movimentações", async () => {
  const module = await loadServiceModule();
  const movements = Array.from({ length: 14 }, (_, index) => ({
    id: String(index + 1),
    createdDateTime: `2026-05-23T14:${String(index).padStart(2, "0")}:00Z`,
    fields: { TicketPaiLookupId: 7, TicketCodigo: "3", ClienteNome: "CLIENTE", AutorTipo: "Administrador", AutorNome: "ADMIN", Mensagem: String(index), StatusNovo: "ATIVO" },
  }));
  let active = 0;
  let maximum = 0;
  const repository = {
    async resolveList(_siteKey, aliases) { return { status: "resolved", id: aliases[0] === "TICKETS CLIENTES" ? "tickets" : "movements" }; },
    async getColumns(_siteKey, listId) { return listId === "tickets" ? ticketColumns : movementColumns; },
    async getItem() { return { id: "7", fields: { TicketCodigo: "3", ClienteNome: "CLIENTE", Status: "ATIVO" } }; },
    async getItemsPage() { return { items: movements, nextLink: "", hasMore: false }; },
    async listAttachments() {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active -= 1;
      return [];
    },
  };
  const service = module.createTicketViewService({
    repository,
    entities: [ticketEntity, movementEntity],
    attachmentConcurrency: 3,
  });

  const result = await service.load("7");

  assert.equal(result.movements.length, 14);
  assert.ok(maximum <= 3, `foram observadas ${maximum} consultas simultâneas`);
});

test("edição e exclusão de movimentação exigem simultaneamente catálogo e ACL", async () => {
  const module = await loadServiceModule();
  assert.equal(typeof module?.ticketActionAllowed, "function");
  const access = { active: true };
  const allowAcl = (_access, moduleId, action) => moduleId === "demandas" && ["edit", "delete"].includes(action);

  assert.equal(module.ticketActionAllowed({ entity: movementEntity, access, can: allowAcl, action: "edit" }), true);
  assert.equal(module.ticketActionAllowed({ entity: { ...movementEntity, capabilities: { ...movementEntity.capabilities, edit: false } }, access, can: allowAcl, action: "edit" }), false);
  assert.equal(module.ticketActionAllowed({ entity: movementEntity, access, can: () => false, action: "delete" }), false);
});

function unifiedViewFixture() {
  return {
    ticketCode: "3",
    ticketEntity,
    movementEntity,
    ticketListId: "tickets",
    movementListId: "movements",
    ticket: {
      id: "7",
      eTag: '"ticket-1"',
      createdDateTime: "2026-05-23T13:00:00Z",
      createdBy: { user: { displayName: "BERNARDO" } },
      fields: { TicketCodigo: "3", ClienteNome: "CLIENTE TESTE", Status: "ATIVO" },
    },
    movements: [
      {
        id: "11",
        eTag: '"movement-1"',
        createdDateTime: "2026-05-23T13:10:00Z",
        fields: { TicketPaiLookupId: 7, TicketCodigo: "3", ClienteNome: "CLIENTE TESTE", AutorTipo: "Cliente", AutorNome: "CLIENTE TESTE", Mensagem: "<script>PRIMEIRA</script>", StatusNovo: "PENDENTE" },
        attachmentsAvailability: "available",
        attachments: [{ name: "DOCUMENTO 1.pdf", size: 1200, type: "application/pdf" }],
      },
      {
        id: "12",
        eTag: '"movement-2"',
        createdDateTime: "2026-05-23T14:00:00Z",
        fields: { TicketPaiLookupId: 7, TicketCodigo: "3", ClienteNome: "CLIENTE TESTE", AutorTipo: "Administrador", AutorNome: "BERNARDO", Mensagem: "SEGUNDA", StatusNovo: "ATIVO" },
        attachmentsAvailability: "available",
        attachments: [],
      },
    ],
  };
}

test("a página mostra cabeçalho e conversa corporativa com anexos dentro da movimentação", async () => {
  const module = await loadPageModule();
  assert.equal(typeof module?.ticketConversationMarkup, "function");
  const markup = module.ticketConversationMarkup(unifiedViewFixture(), {
    ticket: { edit: false, delete: false },
    movement: { edit: false, delete: false },
  });

  assert.match(markup, /Ticket 3/);
  assert.match(markup, /CLIENTE TESTE/);
  assert.match(markup, /ATIVO/);
  assert.match(markup, /ticket-message is-customer/);
  assert.match(markup, /ticket-message is-company/);
  assert.match(markup, /&lt;script&gt;PRIMEIRA&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /<script>PRIMEIRA<\/script>/);
  const firstMovementStart = markup.indexOf('data-movement-id="11"');
  const secondMovementStart = markup.indexOf('data-movement-id="12"');
  const attachmentPosition = markup.indexOf("DOCUMENTO 1.pdf");
  assert.ok(firstMovementStart >= 0 && attachmentPosition > firstMovementStart && attachmentPosition < secondMovementStart);
  assert.match(markup, /data-ticket-attachment-open="DOCUMENTO 1.pdf"/);
  assert.match(markup, /data-ticket-attachment-download="DOCUMENTO 1.pdf"/);
});

test("os comandos de edição e exclusão só aparecem quando a decisão conjunta os libera", async () => {
  const module = await loadPageModule();
  assert.equal(typeof module?.ticketConversationMarkup, "function");
  const denied = module.ticketConversationMarkup(unifiedViewFixture(), {
    ticket: { edit: false, delete: false },
    movement: { edit: false, delete: false },
  });
  const allowed = module.ticketConversationMarkup(unifiedViewFixture(), {
    ticket: { edit: true, delete: true },
    movement: { edit: true, delete: true },
  });

  assert.doesNotMatch(denied, /data-ticket-delete|data-movement-delete|>Editar ticket<|>Editar movimentação</);
  assert.match(allowed, /data-ticket-delete/);
  assert.match(allowed, /data-movement-delete="11"/);
  assert.match(allowed, />Editar ticket</);
  assert.match(allowed, />Editar movimentação</);
});

test("o detalhe de tickets-clientes é encaminhado à visualização unificada sem mudar entities.js", async () => {
  const appSource = await readFile(new URL("../portal/app.js", import.meta.url), "utf8");
  const entitiesSource = await readFile(new URL("../portal/catalog/entities.js", import.meta.url), "utf8");

  assert.match(appSource, /createTicketViewPage/);
  assert.match(appSource, /entity\.id === "tickets-clientes"/);
  assert.match(appSource, /createTicketViewPage\(portalShell\.content/);
  assert.doesNotMatch(entitiesSource, /ticket-view|ticketContract|unifiedTicket/);
});
