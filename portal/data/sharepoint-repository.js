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

function queryString(query) {
  if (!query) return "";
  if (typeof query === "string") return query.startsWith("?") ? query : `?${query}`;
  if (query instanceof URLSearchParams) return `?${query.toString()}`;
  return `?${new URLSearchParams(query).toString()}`;
}

function unavailableSite(error) {
  return { status: "unavailable", error };
}

function attachmentTarget(listId, itemId) {
  const list = String(listId || "");
  const item = String(itemId || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(list) || !/^\d+$/.test(item) || Number(item) < 1) {
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

export function createSharePointRepository(graph, siteConfig, { attachmentTransport } = {}) {
  if (!graph || typeof graph.request !== "function") {
    throw new TypeError("O repositorio SharePoint requer um cliente Graph.");
  }

  const sites = siteConfig || {};
  const siteCache = new Map();
  const listCache = new Map();
  const columnCache = new Map();

  function getSiteConfig(siteKey) {
    const config = sites[siteKey];
    if (!config?.host || !config?.path) {
      throw new RangeError(`Site SharePoint desconhecido: ${siteKey}`);
    }
    return config;
  }

  async function resolveSites() {
    for (const [siteKey, config] of Object.entries(sites)) {
      if (siteCache.has(siteKey)) continue;
      try {
        const site = await graph.request(`/sites/${config.host}:${config.path}`, { method: "GET" });
        siteCache.set(siteKey, site);
      } catch (error) {
        // Keep an inaccessible source isolated so another configured site remains usable.
        siteCache.set(siteKey, unavailableSite(error));
      }
    }
    return Object.fromEntries(siteCache);
  }

  async function getSite(siteKey) {
    getSiteConfig(siteKey);
    const resolved = await resolveSites();
    const site = resolved[siteKey];
    if (site?.status === "unavailable") throw site.error;
    if (!site?.id) throw new Error(`O Microsoft Graph nao retornou um id para o site ${siteKey}.`);
    return site;
  }

  async function getPaged(path) {
    const values = [];
    let nextPath = path;
    while (nextPath) {
      const page = await graph.request(nextPath, { method: "GET" });
      values.push(...(page?.value || []));
      nextPath = page?.["@odata.nextLink"];
    }
    return values;
  }

  async function listLists(siteKey) {
    if (listCache.has(siteKey)) return listCache.get(siteKey);
    const site = await getSite(siteKey);
    const lists = (await getPaged(`/sites/${site.id}/lists?$select=id,displayName,webUrl,list`))
      .filter(isCustomList);
    listCache.set(siteKey, lists);
    return lists;
  }

  async function resolveList(siteKey, aliases) {
    const normalizedAliases = new Set((Array.isArray(aliases) ? aliases : [aliases]).map(normalizeName));
    const list = (await listLists(siteKey))
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

  async function getColumns(siteKey, listId) {
    const cacheKey = `${siteKey}:${listId}`;
    if (columnCache.has(cacheKey)) return columnCache.get(cacheKey);
    const site = await getSite(siteKey);
    const columns = await getPaged(`/sites/${site.id}/lists/${encodeURIComponent(listId)}/columns`);
    columnCache.set(cacheKey, columns);
    return columns;
  }

  async function getItems(siteKey, listId, query = "$expand=fields") {
    const site = await getSite(siteKey);
    return getPaged(`/sites/${site.id}/lists/${encodeURIComponent(listId)}/items${queryString(query)}`);
  }

  async function createItem(siteKey, listId, fields) {
    const site = await getSite(siteKey);
    return graph.request(`/sites/${site.id}/lists/${encodeURIComponent(listId)}/items`, {
      method: "POST",
      body: { fields },
    });
  }

  async function updateItem(siteKey, listId, itemId, fields) {
    const site = await getSite(siteKey);
    return graph.request(`/sites/${site.id}/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}/fields`, {
      method: "PATCH",
      body: fields,
    });
  }

  async function deleteItem(siteKey, listId, itemId) {
    const site = await getSite(siteKey);
    return graph.request(`/sites/${site.id}/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`, {
      method: "DELETE",
    });
  }

  async function requestAttachment(siteKey, listId, itemId, path, options) {
    if (!attachmentTransport?.request) throw new Error("Anexos SharePoint não foram configurados para este portal.");
    const target = attachmentTarget(listId, itemId);
    const config = getSiteConfig(siteKey);
    return attachmentTransport.request(config, `/_api/web/lists(guid'${target.list}')/items(${target.item})/AttachmentFiles${path}`, options);
  }

  async function listAttachments(siteKey, listId, itemId) {
    const payload = await requestAttachment(siteKey, listId, itemId, "?$select=FileName,ServerRelativeUrl,Length,TimeLastModified,Author/Title&$expand=Author", { method: "GET" });
    return attachmentValues(payload).map(attachmentMetadata);
  }

  async function uploadAttachment(siteKey, listId, itemId, file, fileName = file?.name) {
    if (typeof file?.arrayBuffer !== "function") throw new TypeError("O arquivo de anexo não pode ser lido.");
    const body = await file.arrayBuffer();
    const name = attachmentName(fileName);
    return requestAttachment(siteKey, listId, itemId, `/add(FileName='${name}')`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body,
    });
  }

  async function deleteAttachment(siteKey, listId, itemId, fileName) {
    const name = attachmentName(fileName);
    return requestAttachment(siteKey, listId, itemId, `('${name}')`, {
      method: "POST",
      headers: { "X-HTTP-Method": "DELETE" },
    });
  }

  async function downloadAttachment(siteKey, listId, itemId, fileName) {
    const name = attachmentName(fileName);
    return requestAttachment(siteKey, listId, itemId, `('${name}')/$value`, {
      method: "GET",
      responseType: "arrayBuffer",
    });
  }

  async function getItemVersions(siteKey, listId, itemId) {
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
    createItem,
    updateItem,
    deleteItem,
    listAttachments,
    uploadAttachment,
    deleteAttachment,
    downloadAttachment,
    getItemVersions,
    clearCache,
  });
}
