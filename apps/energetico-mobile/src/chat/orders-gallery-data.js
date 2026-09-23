import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createSharePointAttachmentTransport } from "../../../../portal/data/attachments.js";
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
    if (value == null && target === "Criado") value = item?.createdDateTime;
    if (value == null && target === "Modificado") value = item?.lastModifiedDateTime;
    if (value == null && target === "Criado por") value = item?.createdBy?.user?.displayName || item?.createdBy?.application?.displayName;
    if (value == null && target === "Modificado por") value = item?.lastModifiedBy?.user?.displayName || item?.lastModifiedBy?.application?.displayName;
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

  async function listAttachments(rawId) {
    const id = itemId(rawId);
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

  return Object.freeze({ loadSnapshot, listAttachments, downloadAttachment });
}
