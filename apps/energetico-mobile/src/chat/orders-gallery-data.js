import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createSharePointAttachmentTransport, validateAttachment } from "../../../../portal/data/attachments.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";

const SITE_KEY = "personal";
const LIST_ALIASES = Object.freeze(["NOTASPENDENTES"]);
const PENDING_PROVISION_LIST_ALIASES = Object.freeze([
  "PROVISÃO PGTOS", "PROVISAO PGTOS", "PROVISAO PAGAMENTOS",
]);
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const KNOWN_FIELDS = Object.freeze([
  ["FILIAL", ["FILIAL"]],
  ["FORNECEDOR", ["FORNECEDOR"]],
  ["STATUS", ["STATUS"]],
  ["VALORTOTAL", ["VALORTOTAL", "VALOR TOTAL"]],
  ["ID", ["ID"]],
  ["FORMAPGTO", ["FORMAPGTO", "FORMA PGTO", "FORMA DE PAGAMENTO"]],
  ["NOTA FISCAL", ["NOTA FISCAL"]],
  ["OBS", ["OBS"]],
  ["OBS FISCAL", ["OBS FISCAL"]],
  ["DATAPGTOEFETUADO", ["DATAPGTOEFETUADO", "DATA PGTO EFETUADO"]],
  ["Criado", ["CRIADO", "CREATED"]],
  ["Modificado", ["MODIFICADO", "MODIFIED"]],
  ["Criado por", ["CRIADO POR", "AUTHOR", "CREATED BY"]],
  ["Modificado por", ["MODIFICADO POR", "EDITOR", "MODIFIED BY"]],
  ["Tem anexos", ["TEM ANEXOS", "ATTACHMENTS"]],
]);

export class OrdersGalleryDataError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OrdersGalleryDataError";
    this.code = code;
  }
}

function fieldKey(value) {
  return String(value || "").replace(/_x([0-9a-f]{4})_/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("pt-BR").replace(/[^A-Z0-9]/g, "");
}

function scalar(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(scalar).filter(Boolean).join(", ");
  if (typeof value === "object") {
    for (const key of ["LookupValue", "Value", "value", "DisplayName", "displayName", "Title", "title", "Email", "email"]) {
      if (value[key] != null) return scalar(value[key]);
    }
    return "";
  }
  return value;
}

function identityDisplayName(identity) {
  const user = identity?.user ?? identity?.User ?? identity;
  if (!user || typeof user !== "object") return "";
  for (const key of ["displayName", "DisplayName", "title", "Title", "email", "EMail", "Email"]) {
    if (user[key] != null && String(user[key]).trim()) return String(user[key]).trim();
  }
  return "";
}

function isUsefulPersonName(value) {
  const name = String(scalar(value) ?? "").trim();
  return Boolean(name)
    && !/^\d+$/.test(name)
    && !/^(?:sharepoint(?: app)?|system account|app|microsoft flow|power automate)$/i.test(name);
}

function fieldValue(fields, aliases) {
  const accepted = new Set(aliases.map(fieldKey));
  const entry = Object.entries(fields || {}).find(([name, value]) => accepted.has(fieldKey(name)) && value != null);
  return entry ? entry[1] : undefined;
}

function truthy(value) {
  if (value === true || value === 1) return true;
  return /^(true|yes|sim|1)$/i.test(String(scalar(value)).trim());
}

function normalizedFields(item) {
  const source = item?.fields && typeof item.fields === "object" ? item.fields : {};
  const fields = { ...source };
  for (const [target, aliases] of KNOWN_FIELDS) {
    let value = fieldValue(source, aliases);
    if (target === "Criado por" || target === "Modificado por") {
      const identity = target === "Criado por" ? item?.createdBy : item?.lastModifiedBy;
      const graphName = identityDisplayName(identity);
      if (isUsefulPersonName(graphName)) value = graphName;
      else if (value != null && !isUsefulPersonName(value)) value = "Usuário não identificado";
      else if (value == null && identity) value = "Usuário não identificado";
    }
    if (value == null && target === "Criado") value = item?.createdDateTime;
    if (value == null && target === "Modificado") value = item?.lastModifiedDateTime;
    if (value != null) fields[target] = target === "Criado por" || target === "Modificado por" ? scalar(value) : value;
  }
  return fields;
}

function normalizeItem(item) {
  const fields = normalizedFields(item);
  const id = String(fieldValue(fields, ["ID"]) ?? item?.id ?? "").trim();
  if (!/^\d{1,15}$/.test(id)) return null;
  const attachmentValue = fieldValue(fields, ["Tem anexos", "ATTACHMENTS"]);
  const embeddedAttachments = fieldValue(fields, ["Anexos"]);
  const embeddedCount = Array.isArray(embeddedAttachments) ? embeddedAttachments.length : 0;
  const attachmentPresenceKnown = attachmentValue != null
    || typeof item?.hasAttachments === "boolean"
    || Array.isArray(embeddedAttachments);
  const hasAttachments = embeddedCount > 0 || truthy(attachmentValue) || item?.hasAttachments === true
    ? true
    : attachmentPresenceKnown ? false : null;
  return Object.freeze({
    id,
    fields: Object.freeze(fields),
    hasAttachments,
  });
}

function attachmentMimeType(name, supplied) {
  const mime = String(supplied || "").split(";", 1)[0].toLowerCase();
  if (mime && mime !== "application/octet-stream") return mime;
  const extension = String(name || "").toLowerCase().split(".").at(-1);
  return ({
    pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
    webp: "image/webp", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", txt: "text/plain", csv: "text/csv",
  })[extension] || "application/octet-stream";
}

function attachmentDescriptor(value) {
  const fileName = String(value?.name || value?.FileName || "").trim();
  if (!fileName) return null;
  return Object.freeze({
    fileName,
    mimeType: attachmentMimeType(fileName, value?.type || value?.ContentType),
    size: Math.max(0, Number(value?.size ?? value?.Length ?? 0) || 0),
    uploadedAt: String(value?.uploadedAt || value?.TimeLastModified || ""),
  });
}

function itemId(value) {
  const id = String(value ?? "").trim();
  if (!/^\d{1,15}$/.test(id)) throw new RangeError("O ID do pedido não é válido.");
  return id;
}

function sharePointDateValue(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new RangeError("Informe a data de vencimento no formato DD/MM/AAAA.");
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (month < 1 || month > 12 || day < 1 || date.getFullYear() !== year
    || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new RangeError("A data de vencimento informada não existe.");
  }
  return date.toISOString();
}

function asBlob(value, mimeType) {
  const body = value instanceof Blob ? value : new Blob([value], { type: mimeType });
  return String(body.type || "").toLowerCase() === mimeType.toLowerCase()
    ? body
    : new Blob([body], { type: mimeType });
}

export function createOrdersGalleryData(options = {}) {
  return createSharePointListData({
    ...options,
    siteKey: options.siteKey || SITE_KEY,
    listAliases: options.listAliases || LIST_ALIASES,
    listName: options.listName || "NOTASPENDENTES",
  });
}

export function createTasksGalleryData(options = {}) {
  return createSharePointListData({
    ...options,
    siteKey: options.siteKey || SITE_KEY,
    listAliases: options.listAliases || ["LANCAMENTOTAREFAS", "LANCAMENTO TAREFAS"],
    listName: options.listName || "LANCAMENTOTAREFAS",
    listMissingCode: options.listMissingCode || "tasks_list_missing",
  });
}

export function createPaymentProgrammingGalleryData(options = {}) {
  return createSharePointListData({
    ...options,
    siteKey: options.siteKey || SITE_KEY,
    listAliases: options.listAliases || PENDING_PROVISION_LIST_ALIASES,
    listName: options.listName || "PROVISÃO PGTOS",
    listMissingCode: options.listMissingCode || "payment_programming_list_missing",
  });
}

export function createRecurringExpensesGalleryData(options = {}) {
  return createSharePointListData({
    ...options,
    siteKey: options.siteKey || SITE_KEY,
    listAliases: options.listAliases || ["DESPESASRECORRENTES", "DESPESAS RECORRENTES"],
    listName: options.listName || "DESPESASRECORRENTES",
    listMissingCode: options.listMissingCode || "recurring_expenses_list_missing",
  });
}

export function createPendingProvisionAttachmentsData(options = {}) {
  const data = createSharePointListData({
    ...options,
    siteKey: options.siteKey || SITE_KEY,
    listAliases: options.listAliases || PENDING_PROVISION_LIST_ALIASES,
    listName: options.listName || "PROVISÃO PGTOS",
    listMissingCode: options.listMissingCode || "pending_provision_list_missing",
  });
  return Object.freeze({
    listAttachments: data.listAttachments,
    downloadAttachment: data.downloadAttachment,
    uploadAttachment: data.uploadAttachment,
    updateDueDate: data.updateDueDate,
  });
}

function createSharePointListData({
  tokenProvider,
  repository: suppliedRepository,
  siteConfig = SHAREPOINT_SITES,
  fetchImpl = globalThis.fetch,
  siteKey = SITE_KEY,
  listAliases = LIST_ALIASES,
  listName = "NOTASPENDENTES",
  listMissingCode = "orders_list_missing",
} = {}) {
  let repository = suppliedRepository;
  if (!repository) {
    if (typeof tokenProvider !== "function") throw new TypeError("A consulta SharePoint requer a sessão Microsoft ativa.");
    const graph = createGraphClient(tokenProvider, { fetch: fetchImpl });
    const attachments = createSharePointAttachmentTransport({
      tokenProvider,
      allowedSites: Object.values(siteConfig),
      fetch: fetchImpl,
    });
    repository = createSharePointRepository(graph, siteConfig, { attachmentTransport: attachments });
  }
  if (typeof repository.resolveList !== "function" || typeof repository.getItemsPage !== "function") {
    throw new TypeError("A Galeria de Pedidos requer um repositório SharePoint compatível.");
  }

  let listRequest;
  const attachmentCache = new Map();
  async function resolveList(signal) {
    if (!listRequest) {
      listRequest = Promise.resolve(repository.resolveList(siteKey, listAliases, signal ? { signal } : {})).then(list => {
        if (list?.status !== "resolved" || !list.id) {
          throw new OrdersGalleryDataError(listMissingCode, `A lista ${listName} não está disponível nesta conta SharePoint.`);
        }
        return list;
      }).catch(error => {
        listRequest = null;
        throw error;
      });
    }
    return listRequest;
  }

  async function loadSnapshot({ signal } = {}) {
    const list = await resolveList(signal);
    const rows = [];
    let cursor = "";
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
      if (signal?.aborted) throw signal.reason || new DOMException("A consulta foi cancelada.", "AbortError");
      const page = await repository.getItemsPage(
        SITE_KEY,
        list.id,
        `$expand=fields&$top=${PAGE_SIZE}`,
        { pageNumber, maxPages: MAX_PAGES, ...(cursor ? { cursor } : {}), ...(signal ? { signal } : {}) },
      );
      for (const item of Array.isArray(page?.items) ? page.items : []) {
        const row = normalizeItem(item);
        if (row) rows.push(row);
      }
      if (!page?.hasMore || !page?.nextLink) {
        rows.sort((left, right) => Number(right.id) - Number(left.id));
        return Object.freeze({ listName, rows: Object.freeze(rows) });
      }
      cursor = page.nextLink;
    }
    throw new OrdersGalleryDataError("orders_page_limit", "A lista de pedidos ultrapassou o limite seguro de páginas.");
  }

  async function listAttachments(rawId, { refresh = false } = {}) {
    const id = itemId(rawId);
    if (refresh) attachmentCache.delete(id);
    if (attachmentCache.has(id)) return attachmentCache.get(id);
    const pending = (async () => {
      const list = await resolveList();
      if (typeof repository.listAttachments !== "function") throw new Error("A consulta de anexos SharePoint não está disponível.");
      const values = await repository.listAttachments(siteKey, list.id, id);
      return Object.freeze((Array.isArray(values) ? values : []).map(attachmentDescriptor).filter(Boolean));
    })();
    attachmentCache.set(id, pending);
    try {
      const result = await pending;
      attachmentCache.set(id, result);
      return result;
    } catch (error) {
      if (attachmentCache.get(id) === pending) attachmentCache.delete(id);
      throw error;
    }
  }

  async function downloadAttachment(rawId, rawName) {
    const id = itemId(rawId);
    const fileName = String(rawName || "").trim();
    if (!fileName || fileName.length > 400 || /[\\/\u0000-\u001f]/.test(fileName)) {
      throw new RangeError("O nome do anexo não é válido.");
    }
    const list = await resolveList();
    if (typeof repository.downloadAttachment !== "function") throw new Error("A abertura de anexos SharePoint não está disponível.");
    const payload = await repository.downloadAttachment(siteKey, list.id, id, fileName);
    const metadata = (await listAttachments(id)).find(entry => entry.fileName === fileName);
    return asBlob(payload, metadata?.mimeType || attachmentMimeType(fileName));
  }

  async function uploadAttachment(rawId, file) {
    const id = itemId(rawId);
    const validation = validateAttachment(file);
    if (!validation.valid) throw new RangeError(validation.message);
    const list = await resolveList();
    if (typeof repository.uploadAttachment !== "function") throw new Error("O envio de anexos SharePoint não está disponível.");
    const result = await repository.uploadAttachment(siteKey, list.id, id, file, validation.name);
    attachmentCache.delete(id);
    return result;
  }

  async function updateDueDate(rawId, rawDate) {
    const id = itemId(rawId);
    const value = sharePointDateValue(rawDate);
    const list = await resolveList();
    if (typeof repository.getItem !== "function" || typeof repository.getColumns !== "function"
      || typeof repository.updateItem !== "function") {
      throw new Error("A atualização segura da provisão não está disponível.");
    }
    const [item, columns] = await Promise.all([
      repository.getItem(siteKey, list.id, id, "$expand=fields"),
      repository.getColumns(siteKey, list.id),
    ]);
    const eTag = String(item?.eTag || item?.["@odata.etag"] || item?.["odata.etag"] || "").trim();
    if (!eTag || eTag === "*") throw new Error("Recarregue a provisão antes de alterar; a versão atual não foi identificada.");
    const dueDateColumns = (Array.isArray(columns) ? columns : []).filter(column => (
      column?.readOnly !== true
      && (fieldKey(column?.name) === "DATAPREVISTOPGTO"
        || fieldKey(column?.displayName) === "DATAPREVISTOPGTO")
    ));
    const uniqueColumns = [...new Map(dueDateColumns.filter(column => column?.name)
      .map(column => [String(column.name), column])).values()];
    if (uniqueColumns.length !== 1) throw new Error("Não foi possível identificar com segurança a coluna DATA PREVISTO PGTO.");
    const fieldName = String(uniqueColumns[0].name);
    const result = await repository.updateItem(siteKey, list.id, id, { [fieldName]: value }, { eTag });
    return result;
  }

  return Object.freeze({ loadSnapshot, listAttachments, downloadAttachment, uploadAttachment, updateDueDate });
}
