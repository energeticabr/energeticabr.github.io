function freezeFields(fields) {
  return Object.freeze({ ...fields });
}

export const TICKET_VIEW_CONTRACT = Object.freeze({
  siteKey: "company",
  ticket: Object.freeze({
    entityId: "tickets-clientes",
    listNames: Object.freeze(["TICKETS CLIENTES"]),
    fields: freezeFields({
      code: "TicketCodigo",
      customer: "ClienteNome",
      status: "Status",
    }),
  }),
  movement: Object.freeze({
    entityId: "movimentacoes-de-ticket",
    listNames: Object.freeze(["TICKET MOVIMENTACOES", "TICKET MOVIMENTAÇÕES"]),
    fields: freezeFields({
      parent: "TicketPai",
      ticketCode: "TicketCodigo",
      customer: "ClienteNome",
      authorType: "AutorTipo",
      authorName: "AutorNome",
      message: "Mensagem",
      status: "StatusNovo",
    }),
  }),
  relation: Object.freeze({
    parentField: "TicketPai",
    parentLookupField: "TicketPaiLookupId",
    ticketCodeField: "TicketCodigo",
    movementTicketCodeField: "TicketCodigo",
    ticketCustomerField: "ClienteNome",
    movementCustomerField: "ClienteNome",
  }),
  orderBy: "createdDateTime",
  evidence: Object.freeze({
    origin: "powerapps-form-audit-20260815",
    artifacts: Object.freeze([
      "GALERIA TICKETS.pa.yaml",
      "MOVIMENTAÇÃO TICKETS.pa.yaml",
    ]),
    sha256: Object.freeze({
      "GALERIA TICKETS.pa.yaml": "0606a9e1ead5b6338ba3977f443ec3782de9b396e9fdc39f8dc8b51c00a830c6",
      "MOVIMENTAÇÃO TICKETS.pa.yaml": "261ac7a1c1a144a2566cc3cf7374682b7abd6d3d34f177d6fce3c466a3f4ec38",
    }),
    formula: "Filter('TICKET MOVIMENTACOES', TicketCodigo = Gallery6_5.Selected.TicketCodigo)",
  }),
});

function columnNames(columns) {
  return new Set((columns || []).map(column => String(column?.name || "")));
}

function requireFields(columns, fields, source) {
  const available = columnNames(columns);
  const missing = fields.filter(field => !available.has(field));
  if (missing.length) {
    throw new Error(`${source} não possui os campos SharePoint comprovados: ${missing.join(", ")}.`);
  }
}

export function assertTicketContractColumns(ticketColumns, movementColumns, options = {}) {
  requireFields(ticketColumns, Object.values(TICKET_VIEW_CONTRACT.ticket.fields), "TICKETS CLIENTES");
  requireFields(movementColumns, Object.values(TICKET_VIEW_CONTRACT.movement.fields), "TICKET MOVIMENTACOES");
  const parent = (movementColumns || []).find(column => column?.name === TICKET_VIEW_CONTRACT.relation.parentField);
  if (!parent?.lookup || parent.lookup.allowMultipleValues === true) {
    throw new Error("TICKET MOVIMENTACOES precisa de um lookup SharePoint simples chamado TicketPai.");
  }
  const expectedListId = String(options.ticketListId || "").trim().toLowerCase();
  const actualListId = String(parent.lookup.listId || "").trim().toLowerCase();
  if (expectedListId && actualListId !== expectedListId) {
    throw new Error("O lookup TicketPai não referencia a lista TICKETS CLIENTES resolvida.");
  }
  return true;
}
