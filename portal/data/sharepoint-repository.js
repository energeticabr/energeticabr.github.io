import {
  FULL_CONTROL_MASK,
  maskForPermissionNames,
  permissionMaskObject,
  permissionMaskValue,
  permissionMaskSignature,
} from "../security/sharepoint-permissions.js";

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function isCustomList(list) {
  return list?.list?.template === "genericList" && !list.system;
}

function restListMetadata(value, config) {
  const id = String(value?.Id ?? value?.id ?? "").replace(/^\{|\}$/g, "").trim();
  const displayName = String(value?.Title ?? value?.title ?? "").trim();
  const baseTemplate = Number(value?.BaseTemplate ?? value?.baseTemplate);
  const hidden = value?.Hidden === true || value?.hidden === true;
  if (!displayName || hidden || baseTemplate !== 100 || !/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const relativeUrl = String(value?.RootFolder?.ServerRelativeUrl ?? value?.rootFolder?.serverRelativeUrl ?? "").trim();
  return Object.freeze({
    id,
    displayName,
    ...(relativeUrl ? { webUrl: `https://${config.host}${relativeUrl}` } : {}),
    list: Object.freeze({ template: "genericList" }),
  });
}

function queryString(query) {
  if (!query) return "";
  if (typeof query === "string") return query.startsWith("?") ? query : `?${query}`;
  if (query instanceof URLSearchParams) return `?${query.toString()}`;
  return `?${new URLSearchParams(query).toString()}`;
}

const MAX_INCREMENTAL_PAGES = 100;
const MAX_GENERIC_PAGES = 100;
const MAX_GRAPH_BATCH_SIZE = 100;
const MAX_STRUCTURED_SEARCH_FIELDS = 8;
const MAX_RELATIONSHIP_OPTIONS = 20;
const MIN_RELATIONSHIP_TERM_LENGTH = 2;

function graphFieldName(value) {
  const field = String(value || "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) throw new RangeError("O campo de pesquisa do Microsoft Graph é inválido.");
  return field;
}

function graphStringLiteral(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function relationshipLimit(value) {
  const limit = Number(value ?? MAX_RELATIONSHIP_OPTIONS);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RELATIONSHIP_OPTIONS) {
    throw new RangeError(`A pesquisa relacional aceita entre 1 e ${MAX_RELATIONSHIP_OPTIONS} resultados.`);
  }
  return limit;
}

function relationshipTerm(value) {
  const term = String(value || "").trim();
  if (term.length < MIN_RELATIONSHIP_TERM_LENGTH) {
    throw new RangeError(`Digite pelo menos ${MIN_RELATIONSHIP_TERM_LENGTH} caracteres para pesquisar.`);
  }
  if (term.length > 80) throw new RangeError("A pesquisa relacional aceita no máximo 80 caracteres.");
  return term;
}

function relationshipListId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
    throw new RangeError("A lista relacionada informada pelos metadados SharePoint é inválida.");
  }
  return id;
}

function relationshipOption(value, label, secondary = "") {
  const id = Number(value);
  const title = String(label || "").trim();
  if (!Number.isInteger(id) || id < 1 || !title) {
    throw new TypeError("A relação retornou uma opção sem ID ou nome válido.");
  }
  return Object.freeze({ id, label: title, secondary: String(secondary || "").trim() });
}

function graphBatchLimit(query) {
  const raw = typeof query === "string" ? query.replace(/^\?/, "") : new URLSearchParams(query || {}).toString();
  const requested = Number(new URLSearchParams(raw).get("$top") || MAX_GRAPH_BATCH_SIZE);
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_GRAPH_BATCH_SIZE) {
    throw new RangeError(`O lote Graph deve conter entre 1 e ${MAX_GRAPH_BATCH_SIZE} registros.`);
  }
  return requested;
}

function boundedGraphItems(payload, limit) {
  const items = payload?.value;
  if (!Array.isArray(items)) throw new TypeError("O Microsoft Graph retornou um lote de itens inválido.");
  if (items.length > limit) {
    throw new RangeError(`O Microsoft Graph retornou mais registros que o limite de ${limit}; o lote foi recusado para não omitir nem renderizar dados silenciosamente.`);
  }
  return items;
}

function incrementalPageNumber(value, maximum) {
  const page = Number(value ?? 1);
  const limit = Number(maximum ?? MAX_INCREMENTAL_PAGES);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_INCREMENTAL_PAGES) {
    throw new RangeError(`O limite de páginas deve estar entre 1 e ${MAX_INCREMENTAL_PAGES}.`);
  }
  if (!Number.isInteger(page) || page < 1 || page > limit) {
    throw new RangeError(`A paginação incremental excedeu o limite de ${limit} páginas.`);
  }
  return { page, limit };
}

function validatedItemsNextLink(value, siteId, listId) {
  const nextLink = String(value || "").trim();
  if (!nextLink) return "";
  let url;
  try {
    url = new URL(nextLink);
  } catch {
    throw new TypeError("O cursor de paginação do Microsoft Graph é inválido.");
  }
  const expectedPath = `/v1.0/sites/${siteId}/lists/${encodeURIComponent(listId)}/items`;
  const isExpectedGraphCursor = url.protocol === "https:"
    && url.hostname === "graph.microsoft.com"
    && !url.port
    && !url.username
    && !url.password
    && !url.hash
    && url.pathname === expectedPath;
  if (!isExpectedGraphCursor) {
    throw new TypeError("O cursor de paginação do Microsoft Graph é inválido para esta lista.");
  }
  return url.toString();
}

function graphPaginationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function graphCollectionUrl(path) {
  const source = String(path || "").trim();
  let url;
  try {
    url = source.startsWith("https://")
      ? new URL(source)
      : new URL(`/v1.0${source.startsWith("/") ? source : `/${source}`}`, "https://graph.microsoft.com");
  } catch {
    throw graphPaginationError("graph_pagination_cursor_invalid", "A coleção de paginação do Microsoft Graph é inválida.");
  }
  if (url.protocol !== "https:" || url.origin !== "https://graph.microsoft.com" || url.username || url.password || url.port || url.hash) {
    throw graphPaginationError("graph_pagination_cursor_invalid", "A coleção de paginação do Microsoft Graph é inválida.");
  }
  return url;
}

function validatedGraphCollectionNextLink(value, collectionUrl) {
  const source = String(value || "").trim();
  if (!source) return "";
  let url;
  try {
    url = new URL(source);
  } catch {
    throw graphPaginationError("graph_pagination_cursor_invalid", "O cursor genérico do Microsoft Graph é inválido.");
  }
  if (url.protocol !== "https:" || url.origin !== collectionUrl.origin || url.username || url.password || url.port || url.hash
    || url.pathname !== collectionUrl.pathname) {
    throw graphPaginationError("graph_pagination_cursor_invalid", "O cursor genérico do Microsoft Graph não pertence ao mesmo host, site e coleção.");
  }
  return url.toString();
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("A descoberta SharePoint foi cancelada.", "AbortError");
}

function unavailableSite(error) {
  return { status: "unavailable", error };
}

function listGuid(value) {
  const list = String(value || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(list)) {
    throw new RangeError("O identificador da lista SharePoint é inválido.");
  }
  return list;
}

function attachmentTarget(listId, itemId) {
  const list = listGuid(listId);
  const item = String(itemId || "");
  if (!/^\d+$/.test(item) || Number(item) < 1) {
    throw new RangeError("O destino do anexo precisa ser uma lista e um item SharePoint válidos.");
  }
  return { list, item };
}

function attachmentName(value) {
  const name = String(value || "").trim();
  if (!name || /[\\/\u0000-\u001f]/.test(name)) throw new RangeError("O nome do anexo é inválido.");
  return encodeURIComponent(name.replaceAll("'", "''")).replace(/[!()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function attachmentValues(payload) {
  return payload?.value || payload?.d?.results || [];
}

function attachmentMetadata(file) {
  return {
    name: file?.FileName || file?.name || "Arquivo sem nome",
    type: file?.ContentType || file?.type || "",
    size: Number(file?.Length ?? file?.size ?? 0),
    author: file?.Author?.Title || file?.author?.displayName || file?.author || "",
    uploadedAt: file?.TimeLastModified || file?.lastModifiedDateTime || file?.uploadedAt || "",
  };
}

function restValue(payload, name) {
  return payload?.[name] ?? payload?.d?.[name];
}

function restCollection(payload) {
  return payload?.value || payload?.d?.results || payload?.d?.RoleAssignments?.results || [];
}

function restNextLink(payload) {
  return payload?.["@odata.nextLink"] || payload?.["odata.nextLink"] || payload?.d?.__next;
}

function validatedRestNextLink(value, site, collectionPath) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const host = String(site?.host || "").trim().toLowerCase();
  const sitePath = String(site?.path || "").trim();
  const apiPath = String(collectionPath || "").split("?", 1)[0];
  const rawPath = raw.split(/[?#]/, 1)[0];
  if (!host || host.includes(":") || !sitePath.startsWith("/") || sitePath.endsWith("/")
    || !apiPath.startsWith("/_api/") || rawPath.includes("\\") || /%(?:2e|2f|5c)/i.test(rawPath)) {
    throw new TypeError("O destino do nextLink de paginacao REST do SharePoint e invalido.");
  }
  const origin = `https://${host}`;
  let url;
  try {
    if (/^https?:/i.test(raw)) url = new URL(raw);
    else if (raw.startsWith("/_api/")) url = new URL(`${sitePath}${raw}`, origin);
    else url = new URL(raw, origin);
  } catch {
    throw new TypeError("O destino do nextLink de paginacao REST do SharePoint e invalido.");
  }
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password || url.port || url.hash
    || url.pathname !== `${sitePath}${apiPath}`) {
    throw new TypeError("O destino do nextLink de paginacao REST do SharePoint e invalido para esta colecao.");
  }
  return url.toString();
}

function restId(value) {
  const id = Number(value?.Id ?? value?.id ?? value?.d?.Id ?? value?.d?.id);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

function restTitle(value) {
  return String(value?.Title ?? value?.title ?? value?.Name ?? value?.name ?? value?.d?.Title ?? value?.d?.Name ?? "").trim();
}

function restLiteral(value) {
  return String(value || "").replaceAll("'", "''");
}

function jsonRestBody(body) {
  return {
    headers: { "Content-Type": "application/json;odata=verbose" },
    body: JSON.stringify(body),
  };
}

function requireEtag(options = {}) {
  const eTag = String(options?.eTag || "").trim();
  if (!eTag || eTag === "*") {
    throw new SharePointConflictError({
      status: 428,
      code: "etag_required",
      message: "Recarregue o registro antes de alterar ou excluir; a versão atual não foi identificada.",
    });
  }
  return eTag;
}

function asConcurrencyError(error) {
  if (error?.status !== 412) return error;
  return new SharePointConflictError({
    status: 412,
    code: "concurrent_change",
    message: "Este registro foi alterado por outra pessoa. Seus valores foram preservados para conferência.",
    cause: error,
  });
}

export class SharePointConflictError extends Error {
  constructor({ status = 412, code = "concurrent_change", message, cause } = {}) {
    super(message || "O registro mudou no SharePoint antes da sua operação.", { cause });
    this.name = "SharePointConflictError";
    this.status = status;
    this.code = code;
  }
}

export function createSharePointRepository(graph, siteConfig, { attachmentTransport, restTransport = attachmentTransport } = {}) {
  if (!graph || typeof graph.request !== "function") {
    throw new TypeError("O repositorio SharePoint requer um cliente Graph.");
  }

  const sites = siteConfig || {};
  const siteCache = new Map();
  const listCache = new Map();
  const columnCache = new Map();
  let authorizationProvider;

  async function authorize(action, siteKey, listId, details = {}) {
    if (!authorizationProvider) return;
    await authorizationProvider.authorize({ action, siteKey, listId: String(listId || ""), ...details });
  }

  function setAuthorizationProvider(provider) {
    if (!provider || typeof provider.authorize !== "function") {
      throw new TypeError("O provedor de autorizacao SharePoint e invalido.");
    }
    authorizationProvider = provider;
  }

  async function getAllRestCollection(config, collectionPath, options = {}, context = "A colecao REST") {
    const values = [];
    let nextPath = collectionPath;
    let pageCount = 0;
    while (nextPath) {
      pageCount += 1;
      if (pageCount > 100) throw new Error(`${context} excedeu o limite seguro de paginacao.`);
      const page = await restTransport.request(config, nextPath, options);
      values.push(...restCollection(page));
      nextPath = validatedRestNextLink(restNextLink(page), config, collectionPath);
    }
    return values;
  }

  function getSiteConfig(siteKey) {
    const config = sites[siteKey];
    if (!config?.host || !config?.path) {
      throw new RangeError(`Site SharePoint desconhecido: ${siteKey}`);
    }
    return config;
  }

  async function resolveSites(options = {}) {
    const signal = options.signal;
    throwIfAborted(signal);
    for (const [siteKey, config] of Object.entries(sites)) {
      throwIfAborted(signal);
      if (siteCache.has(siteKey)) continue;
      try {
        const site = await graph.request(`/sites/${config.host}:${config.path}`, {
          method: "GET",
          ...(signal ? { signal } : {}),
        });
        throwIfAborted(signal);
        siteCache.set(siteKey, site);
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError" || error?.code === "request_aborted") throw error;
        // Keep an inaccessible source isolated so another configured site remains usable.
        siteCache.set(siteKey, unavailableSite(error));
      }
    }
    return Object.fromEntries(siteCache);
  }

  async function getSite(siteKey, options = {}) {
    getSiteConfig(siteKey);
    const resolved = await resolveSites(options);
    const site = resolved[siteKey];
    if (site?.status === "unavailable") throw site.error;
    if (!site?.id) throw new Error(`O Microsoft Graph nao retornou um id para o site ${siteKey}.`);
    return site;
  }

  async function getPaged(path, options = {}) {
    const values = [];
    let nextPath = path;
    let pageCount = 0;
    const signal = options.signal;
    const collectionUrl = graphCollectionUrl(path);
    const seenCursors = new Set();
    while (nextPath) {
      throwIfAborted(signal);
      if (pageCount >= MAX_GENERIC_PAGES) {
        throw graphPaginationError("graph_pagination_limit", `A paginação genérica excedeu o limite seguro de ${MAX_GENERIC_PAGES} páginas.`);
      }
      pageCount += 1;
      const page = await graph.request(nextPath, { method: "GET", ...(signal ? { signal } : {}) });
      throwIfAborted(signal);
      if (!Array.isArray(page?.value)) {
        throw graphPaginationError("graph_pagination_payload_invalid", "O Microsoft Graph retornou uma página genérica inválida.");
      }
      values.push(...page.value);
      const nextLink = validatedGraphCollectionNextLink(page?.["@odata.nextLink"], collectionUrl);
      if (nextLink && seenCursors.has(nextLink)) {
        throw graphPaginationError("graph_pagination_cursor_repeated", "O Microsoft Graph repetiu o cursor da paginação genérica.");
      }
      if (nextLink) seenCursors.add(nextLink);
      nextPath = nextLink;
    }
    return values;
  }

  async function listLists(siteKey, options = {}) {
    throwIfAborted(options.signal);
    if (listCache.has(siteKey)) return listCache.get(siteKey);
    const site = await getSite(siteKey, options);
    const graphLists = (await getPaged(`/sites/${site.id}/lists?$select=id,displayName,webUrl,list`, options))
      .filter(isCustomList);
    let lists = graphLists;
    if (restTransport?.request) {
      const config = getSiteConfig(siteKey);
      const path = "/_api/web/lists?$select=Id,Title,Hidden,BaseTemplate,RootFolder/ServerRelativeUrl&$expand=RootFolder&$filter=Hidden%20eq%20false%20and%20BaseTemplate%20eq%20100";
      try {
        const restValues = await getAllRestCollection(config, path, {
          method: "GET",
          permission: "read",
          ...(options.signal ? { signal: options.signal } : {}),
        }, "A descoberta de listas SharePoint");
        const merged = new Map(graphLists.map(list => [String(list.id).toLowerCase(), list]));
        for (const value of restValues) {
          const list = restListMetadata(value, config);
          if (list && !merged.has(list.id.toLowerCase())) merged.set(list.id.toLowerCase(), list);
        }
        lists = [...merged.values()];
      } catch (error) {
        if (!graphLists.length) throw error;
      }
    }
    if (lists.length) listCache.set(siteKey, lists);
    return lists;
  }

  async function resolveList(siteKey, aliases, options = {}) {
    const normalizedAliases = new Set((Array.isArray(aliases) ? aliases : [aliases]).map(normalizeName));
    const list = (await listLists(siteKey, options))
      .find(candidate => normalizedAliases.has(normalizeName(candidate.displayName)));

    if (!list) {
      return {
        status: "missing",
        siteKey,
        aliases: Array.isArray(aliases) ? aliases : [aliases],
      };
    }
    return { ...list, status: "resolved" };
  }

  async function getColumns(siteKey, listId, options = {}) {
    throwIfAborted(options.signal);
    await authorize("view", siteKey, listId, options.signal ? { signal: options.signal } : {});
    const cacheKey = `${siteKey}:${listId}`;
    if (columnCache.has(cacheKey)) return columnCache.get(cacheKey);
    const site = await getSite(siteKey, options);
    const columns = await getPaged(`/sites/${site.id}/lists/${encodeURIComponent(listId)}/columns`, options);
    columnCache.set(cacheKey, columns);
    return columns;
  }

  async function getItems(siteKey, listId, query = "$expand=fields") {
    await authorize("view", siteKey, listId);
    const site = await getSite(siteKey);
    return getPaged(`/sites/${site.id}/lists/${encodeURIComponent(listId)}/items${queryString(query)}`);
  }

  async function getItemsPage(siteKey, listId, query = "$expand=fields", options = {}) {
    incrementalPageNumber(options.pageNumber, options.maxPages);
    await authorize("view", siteKey, listId);
    const site = await getSite(siteKey);
    const cursor = validatedItemsNextLink(options.cursor, site.id, listId);
    const path = cursor || `/sites/${site.id}/lists/${encodeURIComponent(listId)}/items${queryString(query)}`;
    const payload = await graph.request(path, { method: "GET", signal: options.signal });
    const items = boundedGraphItems(payload, graphBatchLimit(query));
    const nextLink = validatedItemsNextLink(payload?.["@odata.nextLink"], site.id, listId);
    return Object.freeze({
      items: Object.freeze([...items]),
      nextLink,
      hasMore: Boolean(nextLink),
      batchCount: items.length,
    });
  }

  async function searchItemsPage(siteKey, listId, search = {}, options = {}) {
    incrementalPageNumber(options.pageNumber, options.maxPages);
    if (Number(options.pageNumber ?? 1) !== 1 || options.cursor) {
      throw new RangeError("A pesquisa estruturada em vários campos aceita somente um lote completo; refine o texto para reduzir os resultados.");
    }
    const fields = [...new Set((search.fields || []).map(graphFieldName))];
    if (!fields.length || fields.length > MAX_STRUCTURED_SEARCH_FIELDS) {
      throw new RangeError(`A pesquisa estruturada deve informar entre 1 e ${MAX_STRUCTURED_SEARCH_FIELDS} campos seguros.`);
    }
    const term = String(search.term || "").trim();
    if (!term || term.length > 120) throw new RangeError("O texto da pesquisa estruturada deve conter entre 1 e 120 caracteres.");
    const pageSize = Number(search.pageSize);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_GRAPH_BATCH_SIZE) {
      throw new RangeError(`O lote da pesquisa deve conter entre 1 e ${MAX_GRAPH_BATCH_SIZE} registros.`);
    }

    await authorize("view", siteKey, listId);
    const site = await getSite(siteKey);
    const merged = new Map();
    for (const field of fields) {
      const parameters = new URLSearchParams();
      parameters.set("$expand", "fields");
      parameters.set("$top", String(pageSize));
      parameters.set("$filter", `startswith(fields/${field},${graphStringLiteral(term)})`);
      const path = `/sites/${site.id}/lists/${encodeURIComponent(listId)}/items?${parameters}`;
      const payload = await graph.request(path, { method: "GET", signal: options.signal });
      const items = boundedGraphItems(payload, pageSize);
      const nextLink = validatedItemsNextLink(payload?.["@odata.nextLink"], site.id, listId);
      if (nextLink) {
        throw new RangeError("O resultado ultrapassou o lote seguro. Refine a pesquisa para não omitir correspondências.");
      }
      for (const item of items) {
        const id = String(item?.id || "").trim();
        if (!id) throw new TypeError("A pesquisa Graph retornou um item sem identificador.");
        merged.set(id, item);
      }
      if (merged.size > pageSize) {
        throw new RangeError("O resultado ultrapassou o lote seguro. Refine a pesquisa para não omitir correspondências.");
      }
    }
    const items = Object.freeze([...merged.values()]);
    return Object.freeze({ items, nextLink: "", hasMore: false, batchCount: items.length });
  }

  async function searchRelationshipOptions(siteKey, sourceListId, relation = {}, termValue, options = {}) {
    const term = relationshipTerm(termValue);
    const limit = relationshipLimit(options.limit);
    if (relation?.resolvable !== true || relation?.multiple === true) {
      throw new Error("Esta relação não pode ser resolvida com segurança pelos metadados SharePoint.");
    }

    if (relation.kind === "lookup") {
      const relatedListId = relationshipListId(relation.listId);
      const displayField = graphFieldName(relation.displayField);
      const relatedColumns = await getColumns(siteKey, relatedListId);
      const displayColumn = relatedColumns.find(column => column?.name === displayField);
      if (!displayColumn || displayColumn.indexed !== true) {
        throw new Error(`O campo ${displayField} da lista relacionada precisa estar indexado no SharePoint para permitir pesquisa segura.`);
      }
      const site = await getSite(siteKey);
      const parameters = new URLSearchParams();
      parameters.set("$select", "id");
      parameters.set("$expand", `fields($select=${displayField})`);
      parameters.set("$filter", `startswith(fields/${displayField},${graphStringLiteral(term)})`);
      parameters.set("$top", String(limit));
      const path = `/sites/${site.id}/lists/${encodeURIComponent(relatedListId)}/items?${parameters}`;
      const payload = await graph.request(path, { method: "GET", signal: options.signal });
      const items = boundedGraphItems(payload, limit);
      if (validatedItemsNextLink(payload?.["@odata.nextLink"], site.id, relatedListId)) {
        throw new RangeError("Há mais opções do que o lote seguro. Refine a pesquisa.");
      }
      return Object.freeze(items.map(item => relationshipOption(item?.id, item?.fields?.[displayField])));
    }

    if (relation.kind === "person") {
      if (String(relation.principalType || "peopleOnly").toLowerCase() !== "peopleonly") {
        throw new Error("Este campo não está limitado a pessoa individual (peopleOnly) e foi bloqueado por segurança.");
      }
      if (!restTransport?.request) throw new Error("A pesquisa de pessoas do SharePoint não está disponível.");
      await authorize("view", siteKey, sourceListId);
      const config = getSiteConfig(siteKey);
      const parameters = new URLSearchParams();
      parameters.set("$select", "Id,Title,Email,LoginName");
      parameters.set("$filter", `startswith(Title,${graphStringLiteral(term)}) or startswith(Email,${graphStringLiteral(term)})`);
      parameters.set("$orderby", "Title asc");
      parameters.set("$top", String(limit));
      const payload = await restTransport.request(config, `/_api/web/siteusers?${parameters}`, { method: "GET", signal: options.signal });
      if (restNextLink(payload)) throw new RangeError("Há mais pessoas do que o lote seguro. Refine a pesquisa.");
      const values = restCollection(payload);
      if (values.length > limit) throw new RangeError("O SharePoint retornou pessoas além do limite seguro.");
      return Object.freeze(values.map(user => relationshipOption(user?.Id ?? user?.id, user?.Title ?? user?.title, user?.Email ?? user?.email)));
    }

    throw new Error("O tipo de relação informado pelo SharePoint não é suportado.");
  }

  async function getItem(siteKey, listId, itemId, query = "$expand=fields") {
    await authorize("view", siteKey, listId, { itemId: String(itemId || "") });
    const site = await getSite(siteKey);
    return graph.request(`/sites/${site.id}/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}${queryString(query)}`, { method: "GET" });
  }

  async function createItem(siteKey, listId, fields) {
    await authorize("create", siteKey, listId);
    const site = await getSite(siteKey);
    return graph.request(`/sites/${site.id}/lists/${encodeURIComponent(listId)}/items`, {
      method: "POST",
      scopes: ["Sites.ReadWrite.All"],
      body: { fields },
    });
  }

  async function writeItem(action, siteKey, listId, itemId, fields, options = {}) {
    await authorize(action, siteKey, listId, { itemId: String(itemId || "") });
    const site = await getSite(siteKey);
    const eTag = requireEtag(options);
    try {
      await graph.request(`/sites/${site.id}/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}/fields`, {
        method: "PATCH",
        scopes: ["Sites.ReadWrite.All"],
        headers: { "If-Match": eTag },
        body: fields,
      });
      return graph.request(`/sites/${site.id}/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}?$expand=fields`, { method: "GET" });
    } catch (error) {
      throw asConcurrencyError(error);
    }
  }

  async function updateItem(siteKey, listId, itemId, fields, options = {}) {
    return writeItem("edit", siteKey, listId, itemId, fields, options);
  }

  async function approveItem(siteKey, listId, itemId, fields, options = {}) {
    return writeItem("approve", siteKey, listId, itemId, fields, options);
  }

  async function deleteItem(siteKey, listId, itemId, options = {}) {
    await authorize("delete", siteKey, listId, { itemId: String(itemId || "") });
    const site = await getSite(siteKey);
    const eTag = requireEtag(options);
    try {
      return await graph.request(`/sites/${site.id}/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`, {
        method: "DELETE",
        scopes: ["Sites.ReadWrite.All"],
        headers: { "If-Match": eTag },
      });
    } catch (error) {
      throw asConcurrencyError(error);
    }
  }

  async function requestAttachment(siteKey, listId, itemId, path, options) {
    if (!attachmentTransport?.request) throw new Error("Anexos SharePoint não foram configurados para este portal.");
    const target = attachmentTarget(listId, itemId);
    const config = getSiteConfig(siteKey);
    return attachmentTransport.request(config, `/_api/web/lists(guid'${target.list}')/items(${target.item})/AttachmentFiles${path}`, options);
  }

  async function getListEffectivePermissions(siteKey, listId) {
    if (!restTransport?.request) throw new Error("A consulta REST de permissões SharePoint não foi configurada.");
    const config = getSiteConfig(siteKey);
    const list = listGuid(listId);
    const metadata = await restTransport.request(config, `/_api/web/lists(guid'${list}')?$select=HasUniqueRoleAssignments,EffectiveBasePermissions`, { method: "GET" });
    return Object.freeze({
      HasUniqueRoleAssignments: restValue(metadata, "HasUniqueRoleAssignments"),
      EffectiveBasePermissions: restValue(metadata, "EffectiveBasePermissions"),
    });
  }

  async function getListAdministrativeSecurity(siteKey, listId) {
    if (!restTransport?.request) throw new Error("A consulta REST de permissões SharePoint não foi configurada.");
    const config = getSiteConfig(siteKey);
    const list = listGuid(listId);
    const metadata = await restTransport.request(config, `/_api/web/lists(guid'${list}')?$select=HasUniqueRoleAssignments`, { method: "GET" });
    const collectionPath = `/_api/web/lists(guid'${list}')/RoleAssignments?$select=Member/Id,Member/Title,Member/LoginName,Member/Email,Member/PrincipalType,RoleDefinitionBindings/Id,RoleDefinitionBindings/Name,RoleDefinitionBindings/RoleTypeKind,RoleDefinitionBindings/BasePermissions&$expand=Member,RoleDefinitionBindings`;
    const roleAssignments = await getAllRestCollection(config, collectionPath, { method: "GET" }, "A ACL administrativa");
    return Object.freeze({
      HasUniqueRoleAssignments: restValue(metadata, "HasUniqueRoleAssignments"),
      RoleAssignments: Object.freeze(roleAssignments),
    });
  }

  async function getListSecurity(siteKey, listId) {
    return getListAdministrativeSecurity(siteKey, listId);
  }

  async function ensurePortalGroup(siteKey, definition) {
    if (!restTransport?.request) throw new Error("A configuracao de grupos SharePoint nao esta disponivel.");
    const config = getSiteConfig(siteKey);
    const title = String(definition?.title || "").trim();
    if (!/^ENERGETICA_PORTAL_[A-Z0-9_]+$/.test(title)) throw new RangeError("O grupo nao pertence ao namespace permitido do portal.");
    let group;
    try {
      group = await restTransport.request(config, `/_api/web/sitegroups/getbyname('${restLiteral(title)}')?$select=Id,Title`, { method: "GET", permission: "manage" });
    } catch (error) {
      if (error?.status !== 404) throw error;
      group = await restTransport.request(config, "/_api/web/sitegroups", {
        method: "POST",
        permission: "manage",
        ...jsonRestBody({
          __metadata: { type: "SP.Group" },
          Title: title,
          Description: String(definition?.description || "Acesso administrado pelo portal Energetica.").trim(),
        }),
      });
    }
    const id = restId(group);
    if (!id) throw new Error(`O SharePoint nao retornou o id do grupo ${title}.`);
    return Object.freeze({ id, title: restTitle(group) || title });
  }

  async function ensurePortalRoleDefinition(siteKey, definition) {
    if (!restTransport?.request) throw new Error("A configuracao de funcoes SharePoint nao esta disponivel.");
    const config = getSiteConfig(siteKey);
    const name = String(definition?.name || "").trim();
    if (!name.startsWith("ENERGETICA PORTAL - ")) throw new RangeError("A funcao nao pertence ao namespace permitido do portal.");
    const expectedMask = permissionMaskObject(maskForPermissionNames(definition?.permissions));
    const rolePath = `/_api/web/roledefinitions/getbyname('${restLiteral(name)}')?$select=Id,Name,RoleTypeKind,BasePermissions`;
    let role;
    try {
      role = await restTransport.request(config, rolePath, { method: "GET", permission: "manage" });
    } catch (error) {
      if (error?.status !== 404) throw error;
      role = await restTransport.request(config, "/_api/web/roledefinitions", {
        method: "POST",
        permission: "manage",
        ...jsonRestBody({
          __metadata: { type: "SP.RoleDefinition" },
          Name: name,
          Description: "Permissao operacional gerenciada pelo portal Energetica.",
          BasePermissions: { __metadata: { type: "SP.BasePermissions" }, ...expectedMask },
        }),
      });
    }
    let id = restId(role);
    if (!id) throw new Error(`O SharePoint nao retornou o id da funcao ${name}.`);
    const currentMask = permissionMaskSignature(restValue(role, "BasePermissions"));
    const expectedSignature = permissionMaskSignature(expectedMask);
    const roleTypeKind = Number(restValue(role, "RoleTypeKind"));
    if (currentMask !== expectedSignature || roleTypeKind !== 0) {
      if (Number.isFinite(roleTypeKind) && roleTypeKind !== 0) {
        throw new Error(`A funcao ${name} existe como funcao nativa e nao pode ser reutilizada.`);
      }
      await restTransport.request(config, `/_api/web/roledefinitions(${id})`, {
        method: "POST",
        permission: "manage",
        ...jsonRestBody({
          __metadata: { type: "SP.RoleDefinition" },
          BasePermissions: { __metadata: { type: "SP.BasePermissions" }, ...expectedMask },
        }),
        headers: {
          ...jsonRestBody({}).headers,
          "X-HTTP-Method": "MERGE",
          "IF-MATCH": "*",
        },
      });
      role = await restTransport.request(config, rolePath, { method: "GET", permission: "manage" });
      id = restId(role);
    }
    if (!id || Number(restValue(role, "RoleTypeKind")) !== 0 || permissionMaskSignature(restValue(role, "BasePermissions")) !== expectedSignature) {
      throw new Error(`As BasePermissions da funcao ${name} nao foram comprovadas.`);
    }
    return Object.freeze({ id, name: restTitle(role) || name, roleTypeKind: 0, basePermissions: expectedMask });
  }

  function portalRoleName(value) {
    const name = String(value || "").trim();
    if (!name.startsWith("ENERGETICA PORTAL - ")) throw new RangeError("A funcao nao pertence ao namespace permitido do portal.");
    return name;
  }

  async function getPortalRoleDefinition(siteKey, roleName) {
    if (!restTransport?.request) throw new Error("A leitura de funcoes SharePoint nao esta disponivel.");
    const config = getSiteConfig(siteKey);
    const name = portalRoleName(roleName);
    try {
      const role = await restTransport.request(
        config,
        `/_api/web/roledefinitions/getbyname('${restLiteral(name)}')?$select=Id,Name,Description,RoleTypeKind,BasePermissions`,
        { method: "GET", permission: "manage" },
      );
      const id = restId(role);
      const mask = permissionMaskValue(restValue(role, "BasePermissions"));
      if (!id || mask === undefined) throw new Error(`A funcao ${name} nao retornou um snapshot restauravel.`);
      return Object.freeze({
        status: "resolved",
        id,
        name: restTitle(role) || name,
        description: String(restValue(role, "Description") || ""),
        roleTypeKind: Number(restValue(role, "RoleTypeKind")),
        basePermissions: permissionMaskObject(mask),
      });
    } catch (error) {
      if (error?.status === 404) return Object.freeze({ status: "missing", name });
      throw error;
    }
  }

  async function restorePortalRoleDefinition(siteKey, snapshot) {
    if (!restTransport?.request) throw new Error("A restauracao de funcoes SharePoint nao esta disponivel.");
    const config = getSiteConfig(siteKey);
    const name = portalRoleName(snapshot?.name);
    const rolePath = `/_api/web/roledefinitions/getbyname('${restLiteral(name)}')?$select=Id,Name,Description,RoleTypeKind,BasePermissions`;
    let current;
    try {
      current = await restTransport.request(config, rolePath, { method: "GET", permission: "manage" });
    } catch (error) {
      if (error?.status !== 404) throw error;
      if (snapshot?.status === "missing") return Object.freeze({ restored: true, status: "missing", name });
      throw new Error(`A funcao ${name} existente antes do setup desapareceu e nao pode ser restaurada com o mesmo id.`);
    }
    const currentId = restId(current);
    const currentKind = Number(restValue(current, "RoleTypeKind"));
    if (!currentId || currentKind !== 0) throw new Error(`A funcao ${name} nao e uma funcao customizada restauravel.`);
    if (snapshot?.status === "missing") {
      await restTransport.request(config, `/_api/web/roledefinitions(${currentId})`, {
        method: "POST",
        permission: "manage",
        headers: { "X-HTTP-Method": "DELETE", "IF-MATCH": "*" },
      });
      try {
        await restTransport.request(config, rolePath, { method: "GET", permission: "manage" });
      } catch (error) {
        if (error?.status === 404) return Object.freeze({ restored: true, status: "missing", name });
        throw error;
      }
      throw new Error(`A remocao da funcao criada ${name} nao foi comprovada.`);
    }
    const expectedId = Number(snapshot?.id);
    const expectedMask = permissionMaskValue(snapshot?.basePermissions);
    if (snapshot?.status !== "resolved" || expectedId !== currentId || Number(snapshot?.roleTypeKind) !== 0 || expectedMask === undefined) {
      throw new TypeError(`O snapshot da funcao ${name} e invalido ou nao corresponde a funcao atual.`);
    }
    await restTransport.request(config, `/_api/web/roledefinitions(${currentId})`, {
      method: "POST",
      permission: "manage",
      ...jsonRestBody({
        __metadata: { type: "SP.RoleDefinition" },
        Description: String(snapshot.description || ""),
        BasePermissions: { __metadata: { type: "SP.BasePermissions" }, ...permissionMaskObject(expectedMask) },
      }),
      headers: {
        ...jsonRestBody({}).headers,
        "X-HTTP-Method": "MERGE",
        "IF-MATCH": "*",
      },
    });
    const restored = await restTransport.request(config, rolePath, { method: "GET", permission: "manage" });
    if (restId(restored) !== expectedId
      || Number(restValue(restored, "RoleTypeKind")) !== 0
      || permissionMaskValue(restValue(restored, "BasePermissions")) !== expectedMask
      || String(restValue(restored, "Description") || "") !== String(snapshot.description || "")) {
      throw new Error(`A restauracao exata da funcao ${name} nao foi comprovada.`);
    }
    return Object.freeze({ restored: true, status: "resolved", id: expectedId, name });
  }

  async function ensureSiteUser(siteKey, email) {
    if (!restTransport?.request) throw new Error("A resolucao de usuarios SharePoint nao esta disponivel.");
    const config = getSiteConfig(siteKey);
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new RangeError("O e-mail do usuario SharePoint e invalido.");
    const loginName = `i:0#.f|membership|${normalizedEmail}`;
    const user = await restTransport.request(config, "/_api/web/ensureuser", {
      method: "POST",
      permission: "manage",
      ...jsonRestBody({ logonName: loginName }),
    });
    const id = restId(user);
    if (!id) throw new Error("O SharePoint nao retornou o id do usuario assegurado.");
    return Object.freeze({ id, loginName: String(user?.LoginName || user?.loginName || user?.d?.LoginName || loginName) });
  }

  async function getUserListEffectivePermissions(siteKey, listId, loginName) {
    if (!restTransport?.request) throw new Error("A consulta de permissoes de usuario SharePoint nao esta disponivel.");
    const config = getSiteConfig(siteKey);
    const list = listGuid(listId);
    const login = String(loginName || "").trim();
    if (!login) throw new RangeError("O login SharePoint precisa ser informado.");
    const metadata = await restTransport.request(config, `/_api/web/lists(guid'${list}')?$select=HasUniqueRoleAssignments`, { method: "GET" });
    const permissions = await restTransport.request(
      config,
      `/_api/web/lists(guid'${list}')/getUserEffectivePermissions(@u)?@u='${encodeURIComponent(login)}'`,
      { method: "GET" },
    );
    return Object.freeze({
      HasUniqueRoleAssignments: restValue(metadata, "HasUniqueRoleAssignments"),
      EffectiveBasePermissions: restValue(permissions, "EffectiveBasePermissions") || permissions?.d?.GetUserEffectivePermissions || permissions,
    });
  }

  async function configureListRoleAssignments(siteKey, listId, assignments = []) {
    if (!restTransport?.request) throw new Error("A configuracao de ACL SharePoint nao esta disponivel.");
    const config = getSiteConfig(siteKey);
    const list = listGuid(listId);
    const fullControl = await restTransport.request(config, "/_api/web/roledefinitions/getbytype(5)?$select=Id,Name,RoleTypeKind,BasePermissions", { method: "GET", permission: "manage" });
    const fullControlId = restId(fullControl);
    if (!fullControlId || Number(restValue(fullControl, "RoleTypeKind")) !== 5 || permissionMaskValue(restValue(fullControl, "BasePermissions")) !== FULL_CONTROL_MASK) {
      throw new Error("A funcao Full Control ou suas BasePermissions nao foram comprovadas.");
    }
    const desired = assignments.map(assignment => {
      const principalId = Number(assignment?.principal?.id);
      const roleId = assignment?.role === "FULL_CONTROL" ? fullControlId : Number(assignment?.roleId);
      if (!Number.isInteger(principalId) || principalId < 1 || !Number.isInteger(roleId) || roleId < 1) {
        throw new RangeError("A atribuicao de ACL contem principal ou funcao invalida.");
      }
      return { principalId, roleId };
    });
    const metadata = await restTransport.request(config, `/_api/web/lists(guid'${list}')?$select=HasUniqueRoleAssignments`, { method: "GET", permission: "manage" });
    if (restValue(metadata, "HasUniqueRoleAssignments") !== true) {
      await restTransport.request(config, `/_api/web/lists(guid'${list}')/breakroleinheritance(false,false)`, { method: "POST", permission: "manage" });
    }
    const collectionPath = `/_api/web/lists(guid'${list}')/RoleAssignments?$select=PrincipalId,RoleDefinitionBindings/Id&$expand=RoleDefinitionBindings`;
    const current = (await getAllRestCollection(
      config,
      collectionPath,
      { method: "GET", permission: "manage" },
      "A enumeracao operacional da ACL",
    )).map(assignment => ({
      principalId: Number(assignment?.PrincipalId ?? assignment?.Member?.Id),
      roleIds: (assignment?.RoleDefinitionBindings?.results || assignment?.RoleDefinitionBindings || []).map(role => Number(role?.Id)),
    }));
    for (const existing of current) {
      const expected = desired.find(candidate => candidate.principalId === existing.principalId);
      if (expected && existing.roleIds.length === 1 && existing.roleIds[0] === expected.roleId) continue;
      await restTransport.request(config, `/_api/web/lists(guid'${list}')/roleassignments/getbyprincipalid(${existing.principalId})`, {
        method: "POST",
        permission: "manage",
        headers: { "X-HTTP-Method": "DELETE" },
      });
    }
    for (const expected of desired) {
      const existing = current.find(candidate => candidate.principalId === expected.principalId);
      if (existing && existing.roleIds.length === 1 && existing.roleIds[0] === expected.roleId) continue;
      await restTransport.request(
        config,
        `/_api/web/lists(guid'${list}')/roleassignments/addroleassignment(principalid=${expected.principalId},roledefid=${expected.roleId})`,
        { method: "POST", permission: "manage" },
      );
    }
    return Object.freeze({ configured: true, assignments: desired.length });
  }

  function roleAssignmentPairs(assignments, context) {
    const pairs = [];
    for (const assignment of assignments || []) {
      const principalId = Number(assignment?.PrincipalId ?? assignment?.Member?.Id);
      const bindings = assignment?.RoleDefinitionBindings?.results || assignment?.RoleDefinitionBindings || [];
      if (!Number.isInteger(principalId) || principalId < 1 || !Array.isArray(bindings) || bindings.length === 0) {
        throw new Error(`A ACL ${context} nao possui identificadores suficientes para restauracao.`);
      }
      for (const binding of bindings) {
        const roleId = Number(binding?.Id);
        if (!Number.isInteger(roleId) || roleId < 1) throw new Error(`A ACL ${context} possui uma funcao sem identificador.`);
        pairs.push({ principalId, roleId });
      }
    }
    return pairs.sort((left, right) => left.principalId - right.principalId || left.roleId - right.roleId);
  }

  async function restoreListRoleAssignments(siteKey, listId, snapshot) {
    if (!restTransport?.request) throw new Error("A restauracao de ACL SharePoint nao esta disponivel.");
    if (typeof snapshot?.HasUniqueRoleAssignments !== "boolean") throw new TypeError("O snapshot de ACL para restauracao e invalido.");
    const config = getSiteConfig(siteKey);
    const list = listGuid(listId);
    const metadataPath = `/_api/web/lists(guid'${list}')?$select=HasUniqueRoleAssignments`;
    const metadata = await restTransport.request(config, metadataPath, { method: "GET", permission: "manage" });
    const currentlyUnique = restValue(metadata, "HasUniqueRoleAssignments") === true;
    if (snapshot.HasUniqueRoleAssignments === false) {
      if (currentlyUnique) {
        await restTransport.request(config, `/_api/web/lists(guid'${list}')/resetroleinheritance()`, { method: "POST", permission: "manage" });
      }
      const restored = await restTransport.request(config, metadataPath, { method: "GET", permission: "manage" });
      if (restValue(restored, "HasUniqueRoleAssignments") === true) throw new Error("A restauracao da heranca de permissoes nao foi comprovada.");
      return Object.freeze({ restored: true, unique: false, assignments: 0 });
    }

    const expectedPairs = roleAssignmentPairs(snapshot.RoleAssignments, "anterior");
    if (!currentlyUnique) {
      await restTransport.request(config, `/_api/web/lists(guid'${list}')/breakroleinheritance(false,false)`, { method: "POST", permission: "manage" });
    }
    const collectionPath = `/_api/web/lists(guid'${list}')/RoleAssignments?$select=PrincipalId,RoleDefinitionBindings/Id&$expand=RoleDefinitionBindings`;
    const currentPrincipals = new Set((await getAllRestCollection(
      config,
      collectionPath,
      { method: "GET", permission: "manage" },
      "A enumeracao de rollback da ACL",
    )).map(assignment => Number(assignment?.PrincipalId ?? assignment?.Member?.Id)));
    for (const principalId of currentPrincipals) {
      if (!Number.isInteger(principalId) || principalId < 1) throw new Error("A ACL atual possui principal sem identificador.");
      await restTransport.request(config, `/_api/web/lists(guid'${list}')/roleassignments/getbyprincipalid(${principalId})`, {
        method: "POST",
        permission: "manage",
        headers: { "X-HTTP-Method": "DELETE" },
      });
    }
    for (const pair of expectedPairs) {
      await restTransport.request(
        config,
        `/_api/web/lists(guid'${list}')/roleassignments/addroleassignment(principalid=${pair.principalId},roledefid=${pair.roleId})`,
        { method: "POST", permission: "manage" },
      );
    }
    const restored = await getListAdministrativeSecurity(siteKey, listId);
    const actualPairs = roleAssignmentPairs(restored.RoleAssignments, "restaurada");
    if (restored.HasUniqueRoleAssignments !== true || JSON.stringify(actualPairs) !== JSON.stringify(expectedPairs)) {
      throw new Error("A restauracao exata da ACL anterior nao foi comprovada.");
    }
    return Object.freeze({ restored: true, unique: true, assignments: expectedPairs.length });
  }

  async function syncPortalGroupMemberships(siteKey, user, desiredGroups = [], managedGroups = []) {
    if (!restTransport?.request) throw new Error("A sincronizacao de grupos SharePoint nao esta disponivel.");
    const config = getSiteConfig(siteKey);
    const userId = Number(user?.id);
    const loginName = String(user?.loginName || "").trim();
    if (!Number.isInteger(userId) || userId < 1 || !loginName) throw new RangeError("O usuario SharePoint da reconciliacao e invalido.");
    const desired = new Set(desiredGroups);
    const groupIds = new Map();
    const failures = [];
    for (const name of managedGroups) {
      if (!/^ENERGETICA_PORTAL_[A-Z0-9_]+$/.test(name)) throw new RangeError("A reconciliacao recebeu um grupo fora do namespace permitido.");
      try {
        const group = await restTransport.request(config, `/_api/web/sitegroups/getbyname('${restLiteral(name)}')?$select=Id,Title`, { method: "GET", permission: "manage" });
        const groupId = restId(group);
        if (!groupId) throw new Error(`O grupo ${name} nao foi localizado.`);
        groupIds.set(name, groupId);
        const usersPath = `/_api/web/sitegroups(${groupId})/users?$select=Id,LoginName`;
        const users = await getAllRestCollection(
          config,
          usersPath,
          { method: "GET", permission: "manage" },
          `Os membros do grupo ${name}`,
        );
        const member = users.some(candidate => Number(candidate?.Id ?? candidate?.id) === userId);
        if (desired.has(name) && !member) {
          await restTransport.request(config, `/_api/web/sitegroups(${groupId})/users`, {
            method: "POST",
            permission: "manage",
            ...jsonRestBody({ __metadata: { type: "SP.User" }, LoginName: loginName }),
          });
        } else if (!desired.has(name) && member) {
          await restTransport.request(config, `/_api/web/sitegroups(${groupId})/users/removeById(${userId})`, { method: "POST", permission: "manage" });
        }
      } catch (error) {
        if (error?.status === 404 && !desired.has(name)) continue;
        failures.push(Object.freeze({ groupName: name, error }));
      }
    }
    const memberships = [];
    for (const [name, groupId] of groupIds) {
      try {
        const usersPath = `/_api/web/sitegroups(${groupId})/users?$select=Id,LoginName`;
        const users = await getAllRestCollection(
          config,
          usersPath,
          { method: "GET", permission: "manage" },
          `A verificacao dos membros do grupo ${name}`,
        );
        const member = users.some(candidate => Number(candidate?.Id ?? candidate?.id) === userId);
        if (member) memberships.push(name);
        if (member !== desired.has(name)) throw new Error(`A participacao no grupo ${name} nao foi comprovada.`);
      } catch (error) {
        failures.push(Object.freeze({ groupName: name, error }));
      }
    }
    if (failures.length) {
      throw Object.assign(new AggregateError(failures.map(failure => failure.error), "A sincronizacao de grupos ficou incompleta."), {
        code: "group_membership_incomplete",
        failures: Object.freeze(failures),
      });
    }
    return Object.freeze({ verified: true, memberships: Object.freeze(memberships.sort()) });
  }

  async function listAttachments(siteKey, listId, itemId) {
    await authorize("view", siteKey, listId, { itemId: String(itemId || "") });
    const payload = await requestAttachment(siteKey, listId, itemId, "?$select=FileName,ServerRelativeUrl,Length,TimeLastModified,Author/Title&$expand=Author", { method: "GET" });
    return attachmentValues(payload).map(attachmentMetadata);
  }

  async function uploadAttachment(siteKey, listId, itemId, file, fileName = file?.name) {
    await authorize("edit", siteKey, listId, { itemId: String(itemId || "") });
    if (typeof file?.arrayBuffer !== "function") throw new TypeError("O arquivo de anexo não pode ser lido.");
    const body = await file.arrayBuffer();
    const name = attachmentName(fileName);
    return requestAttachment(siteKey, listId, itemId, `/add(FileName='${name}')`, {
      method: "POST",
      permission: "write",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body,
    });
  }

  async function deleteAttachment(siteKey, listId, itemId, fileName) {
    await authorize("edit", siteKey, listId, { itemId: String(itemId || "") });
    const name = attachmentName(fileName);
    return requestAttachment(siteKey, listId, itemId, `('${name}')`, {
      method: "POST",
      permission: "write",
      headers: { "X-HTTP-Method": "DELETE" },
    });
  }

  async function downloadAttachment(siteKey, listId, itemId, fileName) {
    await authorize("view", siteKey, listId, { itemId: String(itemId || "") });
    const name = attachmentName(fileName);
    return requestAttachment(siteKey, listId, itemId, `('${name}')/$value`, {
      method: "GET",
      responseType: "arrayBuffer",
    });
  }

  async function getItemVersions(siteKey, listId, itemId) {
    await authorize("view", siteKey, listId, { itemId: String(itemId || "") });
    const site = await getSite(siteKey);
    const target = attachmentTarget(listId, itemId);
    return getPaged(`/sites/${site.id}/lists/${encodeURIComponent(target.list)}/items/${target.item}/versions?$expand=fields`);
  }

  function clearCache() {
    siteCache.clear();
    listCache.clear();
    columnCache.clear();
  }

  return Object.freeze({
    resolveSites,
    listLists,
    resolveList,
    getColumns,
    getItems,
    getItemsPage,
    searchItemsPage,
    searchRelationshipOptions,
    getItem,
    createItem,
    updateItem,
    approveItem,
    deleteItem,
    listAttachments,
    uploadAttachment,
    deleteAttachment,
    downloadAttachment,
    getListEffectivePermissions,
    getListAdministrativeSecurity,
    getListSecurity,
    ensurePortalGroup,
    ensurePortalRoleDefinition,
    getPortalRoleDefinition,
    restorePortalRoleDefinition,
    ensureSiteUser,
    getUserListEffectivePermissions,
    configureListRoleAssignments,
    restoreListRoleAssignments,
    syncPortalGroupMemberships,
    getItemVersions,
    setAuthorizationProvider,
    clearCache,
  });
}
