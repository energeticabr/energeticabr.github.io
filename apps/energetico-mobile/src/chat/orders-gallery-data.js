import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createSharePointAttachmentTransport, validateAttachment } from "../../../../portal/data/attachments.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { provisionDateKey, provisionDayOffset, provisionDueState, provisionNumericValue } from "./pending-provision-dates.js";

const SITE_KEY = "personal";
const LIST_ALIASES = Object.freeze(["NOTASPENDENTES"]);
const LAUNCH_LIST_ALIASES = Object.freeze(["LANCAMENTOS"]);
const PENDING_PROVISION_LIST_ALIASES = Object.freeze([
  "PROVISÃO PGTOS", "PROVISAO PGTOS", "PROVISAO PAGAMENTOS",
]);
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const LAUNCH_GROUP_PAGE_SIZE = 100;
const LAUNCH_GROUP_MAX_PAGES = 100;
const LAUNCH_GROUP_PREFER = "HonorNonIndexedQueriesWarningMayFailRandomly";
// Internal names confirmed for LANCAMENTOS; the report renders their display labels.
const LAUNCH_GROUP_FIELDS = Object.freeze([
  ["DATA", "field_2"], ["FORNECEDOR", "field_5"], ["PRODUTO", "field_7"],
  ["QUANTIDADE", "field_8"], ["VALOR UNITÁRIO", "field_9"], ["FRETE", "field_10"],
  ["CONTA", "field_14"], ["CONCLUÍDO", "field_19"],
]);
const LAUNCH_GROUP_SELECT = ["AGRUPAR", "UN", ...LAUNCH_GROUP_FIELDS.map(([, internal]) => internal)].join(",");
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
  const eTag = String(item?.eTag || item?.["@odata.etag"] || item?.["odata.etag"] || "").trim();
  return Object.freeze({
    id,
    fields: Object.freeze(fields),
    hasAttachments,
    ...(eTag ? { eTag } : {}),
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
  const siteConfig = options.siteConfig || SHAREPOINT_SITES;
  let repository = options.repository;
  if (!repository) {
    if (typeof options.tokenProvider !== "function") throw new TypeError("A consulta SharePoint requer a sessão Microsoft ativa.");
    const graph = createGraphClient(options.tokenProvider, { fetch: options.fetchImpl || globalThis.fetch });
    const attachments = createSharePointAttachmentTransport({
      tokenProvider: options.tokenProvider,
      allowedSites: Object.values(siteConfig),
      fetch: options.fetchImpl || globalThis.fetch,
    });
    repository = createSharePointRepository(graph, siteConfig, { attachmentTransport: attachments });
  }
  const sharedOptions = { ...options, siteConfig, repository };
  const data = createSharePointListData({
    ...sharedOptions,
    siteKey: options.siteKey || SITE_KEY,
    listAliases: options.listAliases || LIST_ALIASES,
    listName: options.listName || "NOTASPENDENTES",
  });
  const launchGroups = createLaunchClusterData(sharedOptions);
  return Object.freeze({ ...data, loadLaunchGroup: launchGroups.loadGroup });
}

export function createLaunchClusterData({
  tokenProvider,
  repository: suppliedRepository,
  siteConfig = SHAREPOINT_SITES,
  fetchImpl = globalThis.fetch,
  siteKey = SITE_KEY,
  listAliases = LAUNCH_LIST_ALIASES,
} = {}) {
  let repository = suppliedRepository;
  if (!repository) {
    if (typeof tokenProvider !== "function") throw new TypeError("A consulta SharePoint requer a sessão Microsoft ativa.");
    const graph = createGraphClient(tokenProvider, { fetch: fetchImpl });
    repository = createSharePointRepository(graph, siteConfig);
  }
  if (typeof repository.resolveList !== "function" || typeof repository.getItemsPage !== "function") {
    throw new TypeError("A consulta de lançamentos agrupados requer um repositório SharePoint somente leitura.");
  }

  let resolvedList;
  async function resolveList(signal) {
    if (resolvedList) return resolvedList;
    const list = await repository.resolveList(siteKey, listAliases, signal ? { signal } : {});
    if (list?.status !== "resolved" || !list.id) {
      throw new OrdersGalleryDataError("launches_list_missing", "A lista LANCAMENTOS não está disponível nesta conta SharePoint.");
    }
    if (signal?.aborted) throw signal.reason || new DOMException("A consulta foi cancelada.", "AbortError");
    resolvedList = list;
    return list;
  }

  async function loadGroup(rawGroupId, { signal } = {}) {
    const groupId = String(rawGroupId ?? "").trim();
    if (!/^\d{1,15}$/.test(groupId)) throw new RangeError("O valor de AGRUPAR deve ser um ID numérico válido.");
    const list = await resolveList(signal);
    const rowsById = new Map();
    const query = `$select=id&$expand=fields($select=${LAUNCH_GROUP_SELECT})&$filter=fields/AGRUPAR eq '${groupId}'&$top=${LAUNCH_GROUP_PAGE_SIZE}`;
    let cursor = "";
    for (let pageNumber = 1; pageNumber <= LAUNCH_GROUP_MAX_PAGES; pageNumber += 1) {
      if (signal?.aborted) throw signal.reason || new DOMException("A consulta foi cancelada.", "AbortError");
      const page = await repository.getItemsPage(
        siteKey,
        list.id,
        query,
        {
          pageNumber,
          maxPages: LAUNCH_GROUP_MAX_PAGES,
          headers: { Prefer: LAUNCH_GROUP_PREFER },
          ...(cursor ? { cursor } : {}),
          ...(signal ? { signal } : {}),
        },
      );
      for (const item of Array.isArray(page?.items) ? page.items : []) {
        const fields = item?.fields && typeof item.fields === "object" ? item.fields : {};
        if (String(scalar(fieldValue(fields, ["AGRUPAR"])) ?? "").trim() !== groupId) continue;
        const id = String(item?.id ?? fieldValue(fields, ["ID"]) ?? "").trim();
        if (id) {
          const namedFields = { ...fields };
          for (const [label, internal] of LAUNCH_GROUP_FIELDS) {
            if (fieldValue(namedFields, [label]) == null && fields[internal] != null) namedFields[label] = fields[internal];
          }
          rowsById.set(id, Object.freeze({ ...item, id, fields: Object.freeze(namedFields) }));
        }
      }
      if (!page?.hasMore || !page?.nextLink) {
        const rows = [...rowsById.values()].sort((left, right) => Number(right.id) - Number(left.id));
        return Object.freeze(rows);
      }
      cursor = page.nextLink;
    }
    throw new OrdersGalleryDataError("launches_group_page_limit", "Os lançamentos do pedido ultrapassaram o limite seguro de páginas.");
  }

  return Object.freeze({ loadGroup });
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

const HR_PAYROLL_GALLERIES = Object.freeze({
  IDFOLHA: Object.freeze({
    listName: "IDFOLHA",
    fields: Object.freeze([
      ["MESREFERENCIA", ["MESREFERENCIA", "MES REFERENCIA"]],
      ["FORNECEDOR", ["FORNECEDOR"]],
    ]),
  }),
  FOLHAPGTO: Object.freeze({
    listName: "FOLHAPGTO",
    fields: Object.freeze([
      ["FORNECEDOR", ["FORNECEDOR"]],
      ["TIPOPGTO", ["TIPOPGTO", "TIPO PGTO", "TIPO PAGAMENTO"]],
      ["VALORUNITARIO", ["VALORUNITARIO", "VALOR UNITARIO"]],
      ["QTD", ["QTD", "QUANTIDADE"]],
      ["DATA", ["DATA"]],
      ["IDFOLHA", ["IDFOLHA", "ID FOLHA"]],
      ["IDLANCAMENTO", ["IDLANCAMENTO", "ID LANCAMENTO"]],
    ]),
  }),
});

const HR_PAYROLL_PAGE_SIZE_MAX = 50;
const HR_PAYROLL_REPORT_PAGE_SIZE = 100;
const HR_PAYROLL_PAGE_COUNT_MAX = 100;

function hrPayrollFieldValue(fields, aliases) {
  const accepted = new Set(aliases.map(fieldKey));
  const entry = Object.entries(fields || {}).find(([name, value]) => accepted.has(fieldKey(name)) && value != null);
  return entry ? scalar(entry[1]) : undefined;
}

export function createHrPayrollGalleryData({
  tokenProvider,
  repository: suppliedRepository,
  siteConfig = SHAREPOINT_SITES,
  fetchImpl = globalThis.fetch,
} = {}) {
  let repository = suppliedRepository;
  if (!repository) {
    if (typeof tokenProvider !== "function") throw new TypeError("A consulta da folha requer a sessão Microsoft ativa.");
    const graph = createGraphClient(tokenProvider, { fetch: fetchImpl });
    repository = createSharePointRepository(graph, siteConfig);
  }
  if (typeof repository.resolveList !== "function" || typeof repository.getItemsPage !== "function") {
    throw new TypeError("A galeria de folha requer um repositório SharePoint somente leitura.");
  }

  const listRequests = new Map();
  async function resolveList(gallery) {
    const config = HR_PAYROLL_GALLERIES[gallery];
    if (!config) throw new RangeError("Galeria de folha inválida.");
    if (!listRequests.has(gallery)) {
      const request = Promise.resolve(repository.resolveList(SITE_KEY, [config.listName])).then(list => {
        if (list?.status !== "resolved" || !list.id) {
          throw new Error(`A lista ${config.listName} não está disponível nesta conta SharePoint.`);
        }
        return list;
      }).catch(error => {
        if (listRequests.get(gallery) === request) listRequests.delete(gallery);
        throw error;
      });
      listRequests.set(gallery, request);
    }
    return listRequests.get(gallery);
  }

  async function loadPage(gallery, { page = 1, pageSize = 25, cursor = null } = {}) {
    const config = HR_PAYROLL_GALLERIES[gallery];
    if (!config) throw new RangeError("Galeria de folha inválida.");
    if (!Number.isInteger(page) || page < 1 || page > HR_PAYROLL_PAGE_COUNT_MAX
      || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > HR_PAYROLL_PAGE_SIZE_MAX
      || (cursor !== null && (typeof cursor !== "string" || !cursor || cursor.length > 8192))) {
      throw new RangeError("Página ou cursor da galeria de folha inválido.");
    }
    const list = await resolveList(gallery);
    const selectedFields = config.fields.map(([, aliases]) => aliases[0]).join(",");
    const result = await repository.getItemsPage(
      SITE_KEY,
      list.id,
      `$select=id&$expand=fields($select=${selectedFields})&$top=${pageSize}`,
      { pageNumber: page, maxPages: HR_PAYROLL_PAGE_COUNT_MAX, ...(cursor ? { cursor } : {}) },
    );
    const rows = (Array.isArray(result?.items) ? result.items : []).map(item => {
      const fields = item?.fields && typeof item.fields === "object" ? item.fields : {};
      const row = { id: String(item?.id ?? hrPayrollFieldValue(fields, ["ID"]) ?? "") };
      const eTag = String(item?.eTag || item?.["@odata.etag"] || item?.["odata.etag"] || "").trim();
      if (eTag && eTag !== "*") row.eTag = eTag;
      for (const [key, aliases] of config.fields) {
        const value = hrPayrollFieldValue(fields, aliases);
        if (value !== undefined) row[key] = value;
      }
      return Object.freeze(row);
    }).filter(row => row.id);
    const nextCursor = result?.hasMore === true && typeof result?.nextLink === "string" && result.nextLink
      ? result.nextLink
      : null;
    return Object.freeze({
      gallery,
      listName: config.listName,
      page,
      pageSize,
      fields: Object.freeze(config.fields.map(([key]) => key)),
      rows: Object.freeze(rows),
      hasMore: Boolean(nextCursor),
      nextCursor,
    });
  }

  async function loadPaymentsForPayrollId(rawId, { signal } = {}) {
    const raw = String(rawId ?? "").trim();
    if (!/^\d{1,10}$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) {
      throw new RangeError("IDFOLHA inválido para consultar os pagamentos.");
    }
    const payrollId = Number(raw);
    const gallery = "FOLHAPGTO";
    const config = HR_PAYROLL_GALLERIES[gallery];
    const list = await resolveList(gallery);
    const selectedFields = config.fields.map(([, aliases]) => aliases[0]).join(",");
    const baseQuery = `$select=id&$expand=fields($select=${selectedFields})&$top=${HR_PAYROLL_REPORT_PAGE_SIZE}`;

    async function readPayments(query, headers) {
      const rows = [];
      let cursor = null;
      for (let pageNumber = 1; pageNumber <= HR_PAYROLL_PAGE_COUNT_MAX; pageNumber += 1) {
        if (signal?.aborted) throw signal.reason || new DOMException("A consulta da folha foi cancelada.", "AbortError");
        const result = await repository.getItemsPage(
          SITE_KEY,
          list.id,
          query,
          {
            pageNumber,
            maxPages: HR_PAYROLL_PAGE_COUNT_MAX,
            ...(cursor ? { cursor } : {}),
            ...(headers ? { headers } : {}),
            ...(signal ? { signal } : {}),
          },
        );
        const items = Array.isArray(result?.items) ? result.items : [];
        for (const item of items) {
          const fields = item?.fields && typeof item.fields === "object" ? item.fields : {};
          const row = { id: String(item?.id ?? hrPayrollFieldValue(fields, ["ID"]) ?? "") };
          const eTag = String(item?.eTag || item?.["@odata.etag"] || item?.["odata.etag"] || "").trim();
          if (eTag && eTag !== "*") row.eTag = eTag;
          for (const [key, aliases] of config.fields) {
            const value = hrPayrollFieldValue(fields, aliases);
            if (value !== undefined) row[key] = value;
          }
          const linkedPayrollId = Number(String(row.IDFOLHA ?? "").trim());
          if (row.id && Number.isSafeInteger(linkedPayrollId) && linkedPayrollId === payrollId) {
            rows.push(Object.freeze(row));
          }
        }
        if (result?.hasMore !== true) return Object.freeze(rows);
        if (typeof result.nextLink !== "string" || !result.nextLink) {
          throw new Error("A paginação dos pagamentos da folha não retornou o próximo cursor.");
        }
        cursor = result.nextLink;
      }
      throw new Error("A folha excedeu o limite seguro de páginas; o relatório não foi truncado.");
    }

    try {
      return await readPayments(`${baseQuery}&$filter=fields/IDFOLHA eq ${payrollId}`,
        { Prefer: LAUNCH_GROUP_PREFER });
    } catch (error) {
      if (error?.status !== 400 || signal?.aborted) throw error;
      return readPayments(baseQuery);
    }
  }

  const editors = new Map();
  function editor(gallery) {
    const config = HR_PAYROLL_GALLERIES[gallery];
    if (!config) throw new RangeError("Galeria de folha inválida.");
    if (!editors.has(gallery)) {
      editors.set(gallery, import("./gallery-record-data.js").then(({ createGalleryRecordData }) =>
        createGalleryRecordData({ repository, siteKey: SITE_KEY, listName: config.listName,
          listAliases: [config.listName], metadataOnly: true, resolveList: () => resolveList(gallery) })));
    }
    return editors.get(gallery);
  }
  const editorContexts = new WeakMap();
  async function loadEditor(gallery, id, options) {
    const service = await editor(gallery), context = await service.loadEditor(id, options);
    editorContexts.set(context, service);
    return context;
  }
  async function saveEditor(context, fields) {
    const service = context && editorContexts.get(context);
    if (!service) throw new Error("O contexto de edição não pertence a esta galeria de folha.");
    return service.saveEditor(context, fields);
  }
  return Object.freeze({ loadPage, loadPaymentsForPayrollId, loadEditor, saveEditor,
    deleteItem: async (gallery, id, options) => (await editor(gallery)).deleteItem(id, options) });
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
    loadUpcomingPayments: data.loadUpcomingPayments,
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

  let resolvedList;
  const attachmentCache = new Map();
  async function resolveList(signal) {
    if (resolvedList) return resolvedList;
    const list = await repository.resolveList(siteKey, listAliases, signal ? { signal } : {});
    if (list?.status !== "resolved" || !list.id) {
      throw new OrdersGalleryDataError(listMissingCode, `A lista ${listName} não está disponível nesta conta SharePoint.`);
    }
    if (signal?.aborted) throw signal.reason || new DOMException("A consulta foi cancelada.", "AbortError");
    resolvedList = list;
    return list;
  }

  async function loadSnapshot({ signal } = {}) {
    const list = await resolveList(signal);
    const rows = [];
    let cursor = "";
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
      if (signal?.aborted) throw signal.reason || new DOMException("A consulta foi cancelada.", "AbortError");
      const page = await repository.getItemsPage(
        siteKey,
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

  async function loadItem(rawId, { signal } = {}) {
    const id = itemId(rawId);
    const list = await resolveList(signal);
    if (typeof repository.getItem !== "function") throw new Error("A consulta pontual de pedidos do SharePoint não está disponível.");
    if (signal?.aborted) throw signal.reason || new DOMException("A consulta foi cancelada.", "AbortError");
    let item;
    try {
      item = await repository.getItem(siteKey, list.id, id, "$expand=fields", signal ? { signal } : {});
    } catch (error) {
      if (Number(error?.status) === 404 || String(error?.code || "").toLowerCase() === "itemnotfound") return null;
      throw error;
    }
    if (signal?.aborted) throw signal.reason || new DOMException("A consulta foi cancelada.", "AbortError");
    if (item == null) return null;
    const row = normalizeItem(item);
    if (!row || row.id !== id) throw new OrdersGalleryDataError("orders_item_invalid", "O SharePoint não devolveu o pedido solicitado.");
    return row;
  }

  async function currentItemForMutation(rawId) {
    const id = itemId(rawId);
    const list = await resolveList();
    if (typeof repository.getItem !== "function") throw new Error("A alteração segura do pedido não está disponível.");
    const item = await repository.getItem(siteKey, list.id, id, "$expand=fields");
    const eTag = String(item?.eTag || item?.["@odata.etag"] || item?.["odata.etag"] || "").trim();
    if (!eTag || eTag === "*") throw new Error("Recarregue o pedido antes de alterar; a versão atual não foi identificada.");
    return { id, list, eTag };
  }

  async function updateItem(rawId, fields = {}) {
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      throw new TypeError("Os campos do pedido precisam ser um objeto.");
    }
    const { id, list, eTag } = await currentItemForMutation(rawId);
    if (typeof repository.updateItem !== "function") throw new Error("A edição segura do pedido não está disponível.");
    const updated = await repository.updateItem(siteKey, list.id, id, fields, { eTag });
    return normalizeItem(updated || { id, fields });
  }

  let editorDataPromise;
  function editorData() {
    return editorDataPromise ||= import("./gallery-record-data.js").then(({ createGalleryRecordData }) =>
      createGalleryRecordData({ repository, siteKey, listAliases, listName, resolveList }));
  }
  const loadEditor = async (id, options) => (await editorData()).loadEditor(id, options);
  const saveEditor = async (context, fields) => (await editorData()).saveEditor(context, fields);
  const deleteItem = async (id, options) => (await editorData()).deleteItem(id, options);

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

  async function loadUpcomingPayments({ now = new Date(), signal } = {}) {
    const today = provisionDateKey(now);
    if (!today) throw new RangeError("A data de referência dos vencimentos não é válida.");
    const list = await resolveList(signal);
    if (typeof repository.getColumns !== "function") throw new Error("Os metadados do vencimento não estão disponíveis.");
    const columns = await repository.getColumns(siteKey, list.id, signal ? { signal } : {});
    const dueColumns = [...new Set((Array.isArray(columns) ? columns : [])
      .filter(column => [column?.name, column?.displayName].some(name => ["DATAPREVISTOPGTO", "DATAPGTOPREVISTO"].includes(fieldKey(name))))
      .map(column => String(column.name || "")))];
    if (dueColumns.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(dueColumns[0])) {
      throw new Error("Não foi possível identificar com segurança a coluna DATA PREVISTO PGTO.");
    }
    const dateField = dueColumns[0];
    const query = `$expand=fields&$top=${PAGE_SIZE}&$filter=fields/${dateField} ge '${provisionDayOffset(today, 1)}T00:00:00Z' and fields/${dateField} lt '${provisionDayOffset(today, 3)}T03:00:00Z'`;
    const rows = new Map();
    let cursor = "";
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
      if (signal?.aborted) throw signal.reason || new DOMException("A consulta foi cancelada.", "AbortError");
      const page = await repository.getItemsPage(siteKey, list.id, query, {
        pageNumber, maxPages: MAX_PAGES, headers: { Prefer: LAUNCH_GROUP_PREFER },
        ...(cursor ? { cursor } : {}), ...(signal ? { signal } : {}),
      });
      for (const item of Array.isArray(page?.items) ? page.items : []) {
        const row = normalizeItem(item);
        if (!row) continue;
        const fields = row.fields;
        const dueDate = scalar(fieldValue(fields, [dateField, "DATA PREVISTO PGTO", "DATAPGTOPREVISTO"]));
        if (provisionDueState(dueDate, today).kind !== "upcoming"
          || fieldKey(scalar(fieldValue(fields, ["STATUS"]))) !== "PAGAMENTOPREVISTO"
          || fieldValue(fields, ["DATA PGTO EFETUADO", "DATAPGTOEFETUADO"])
          || fieldKey(scalar(fieldValue(fields, ["PGTOAGENDADO"]))) === "PAGO") continue;
        const amount = provisionNumericValue(scalar(fieldValue(fields, ["VALOR TOTAL", "VALORTOTAL"])));
        const quantity = provisionNumericValue(scalar(fieldValue(fields, ["QTD", "QUANTIDADE"])));
        rows.set(row.id, Object.freeze({
          id: row.id, dueDate,
          total: Number.isFinite(amount) ? amount * (Number.isFinite(quantity) ? quantity : 1) : "",
          supplier: scalar(fieldValue(fields, ["FORNECEDOR"])),
          product: scalar(fieldValue(fields, ["DESCRICAOPGTO", "PRODUTO", "DESCRIÇÃO PGTO"])),
          branch: scalar(fieldValue(fields, ["FILIAL"])), property: scalar(fieldValue(fields, ["IMOVEL", "IMÓVEL"])),
        }));
      }
      if (page?.hasMore !== true) return Object.freeze([...rows.values()].sort((a, b) => provisionDateKey(a.dueDate).localeCompare(provisionDateKey(b.dueDate)) || Number(a.id) - Number(b.id)));
      if (!page.nextLink) throw new Error("A paginação dos vencimentos não retornou o próximo cursor.");
      cursor = page.nextLink;
    }
    throw new Error("Os vencimentos excederam o limite seguro de páginas; a consulta não foi truncada.");
  }

  return Object.freeze({ loadSnapshot, loadItem, listAttachments, downloadAttachment, uploadAttachment, updateItem,
    loadEditor, saveEditor, deleteItem, updateDueDate, loadUpcomingPayments });
}
