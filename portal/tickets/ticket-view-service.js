import { assertTicketContractColumns, TICKET_VIEW_CONTRACT } from "./ticket-contract.js";

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_ATTACHMENT_CONCURRENCY = 6;

function exactTicketCode(value) {
  const code = String(value ?? "").trim();
  if (!code) throw new Error("O ticket não possui TicketCodigo e não pode ser relacionado às movimentações.");
  if (code.length > 120) throw new RangeError("O TicketCodigo ultrapassa o limite seguro de 120 caracteres.");
  return code;
}

function odataLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function movementQuery(ticketCode, pageSize) {
  const parameters = new URLSearchParams();
  parameters.set("$expand", "fields");
  parameters.set("$top", String(pageSize));
  parameters.set(
    "$filter",
    `fields/${TICKET_VIEW_CONTRACT.relation.movementField} eq ${odataLiteral(ticketCode)}`,
  );
  return parameters;
}

function movementTime(item) {
  const value = new Date(item?.createdDateTime || "").getTime();
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function compareMovement(left, right) {
  const byDate = movementTime(left) - movementTime(right);
  if (byDate) return byDate;
  return String(left?.id || "").localeCompare(String(right?.id || ""), "pt-BR", { numeric: true });
}

function requireEntity(entities, entityId) {
  const entity = (entities || []).find(candidate => candidate?.id === entityId);
  if (!entity) throw new Error(`A entidade ${entityId} não está disponível no catálogo do portal.`);
  return entity;
}

function requireResolvedList(list, label) {
  if (list?.status !== "resolved" || !list.id) {
    throw new Error(`A lista ${label} não está disponível no SharePoint.`);
  }
  return list;
}

async function withMovementAttachments(repository, entity, listId, movement) {
  if (typeof repository.listAttachments !== "function") {
    return Object.freeze({ ...movement, attachments: Object.freeze([]), attachmentsAvailability: "missing" });
  }
  try {
    const attachments = await repository.listAttachments(entity.siteKey, listId, movement.id);
    return Object.freeze({
      ...movement,
      attachments: Object.freeze([...(attachments || [])]),
      attachmentsAvailability: "available",
    });
  } catch (error) {
    return Object.freeze({
      ...movement,
      attachments: Object.freeze([]),
      attachmentsAvailability: "error",
      attachmentError: error?.message || "Não foi possível consultar os anexos desta movimentação.",
    });
  }
}

async function mapWithConcurrency(items, concurrency, operation) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(items[index], index);
    }
  }
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export function ticketActionAllowed({ entity, access, can, action } = {}) {
  return Boolean(
    entity?.capabilities?.[action] === true
    && typeof can === "function"
    && can(access, entity.moduleId, action) === true,
  );
}

export function createTicketViewService({
  repository,
  entities,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
  attachmentConcurrency = DEFAULT_ATTACHMENT_CONCURRENCY,
} = {}) {
  if (!repository?.resolveList || !repository?.getItem || !repository?.getItemsPage) {
    throw new TypeError("A visualização unificada requer um repositório SharePoint completo.");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new RangeError("O lote de movimentações deve conter entre 1 e 100 registros.");
  }
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) {
    throw new RangeError("A paginação de movimentações deve ficar entre 1 e 100 páginas.");
  }
  if (!Number.isInteger(attachmentConcurrency) || attachmentConcurrency < 1 || attachmentConcurrency > 10) {
    throw new RangeError("A concorrência de anexos deve ficar entre 1 e 10 consultas.");
  }

  const ticketEntity = requireEntity(entities, TICKET_VIEW_CONTRACT.ticket.entityId);
  const movementEntity = requireEntity(entities, TICKET_VIEW_CONTRACT.movement.entityId);

  async function load(ticketItemId, options = {}) {
    const itemId = String(ticketItemId || "").trim();
    if (!/^\d+$/.test(itemId) || Number(itemId) < 1) throw new RangeError("O item do ticket é inválido.");

    const [ticketList, movementList] = await Promise.all([
      repository.resolveList(ticketEntity.siteKey, TICKET_VIEW_CONTRACT.ticket.listNames),
      repository.resolveList(movementEntity.siteKey, TICKET_VIEW_CONTRACT.movement.listNames),
    ]);
    requireResolvedList(ticketList, "TICKETS CLIENTES");
    requireResolvedList(movementList, "TICKET MOVIMENTACOES");

    const [ticketColumns, movementColumns, ticket] = await Promise.all([
      repository.getColumns(ticketEntity.siteKey, ticketList.id),
      repository.getColumns(movementEntity.siteKey, movementList.id),
      repository.getItem(ticketEntity.siteKey, ticketList.id, itemId, "$expand=fields"),
    ]);
    assertTicketContractColumns(ticketColumns, movementColumns);
    if (!ticket?.fields) throw new Error("O cabeçalho do ticket não foi encontrado no SharePoint.");

    const ticketCode = exactTicketCode(ticket.fields[TICKET_VIEW_CONTRACT.relation.ticketField]);
    const query = movementQuery(ticketCode, pageSize);
    const movements = [];
    const seen = new Set();
    let cursor = "";

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const page = await repository.getItemsPage(
        movementEntity.siteKey,
        movementList.id,
        query,
        { cursor, pageNumber, maxPages, signal: options.signal },
      );
      for (const movement of page.items || []) {
        const movementCode = exactTicketCode(movement?.fields?.[TICKET_VIEW_CONTRACT.relation.movementField]);
        if (movementCode !== ticketCode) {
          throw new Error("O SharePoint devolveu uma movimentação de outro ticket; a conversa foi bloqueada para impedir cruzamento de dados.");
        }
        const movementId = String(movement?.id || "").trim();
        if (!/^\d+$/.test(movementId) || seen.has(movementId)) {
          throw new Error("O SharePoint devolveu uma movimentação sem identificador único comprovável.");
        }
        seen.add(movementId);
        movements.push(movement);
      }
      cursor = String(page.nextLink || "");
      if (!cursor) break;
      if (pageNumber === maxPages) {
        throw new RangeError(`A conversa ultrapassou o limite seguro de ${maxPages} páginas.`);
      }
    }

    const withAttachments = await mapWithConcurrency(
      movements,
      attachmentConcurrency,
      movement => withMovementAttachments(repository, movementEntity, movementList.id, movement),
    );

    return Object.freeze({
      ticket,
      ticketCode,
      ticketEntity,
      movementEntity,
      ticketListId: ticketList.id,
      movementListId: movementList.id,
      movements: Object.freeze(withAttachments.sort(compareMovement)),
    });
  }

  return Object.freeze({ load });
}
