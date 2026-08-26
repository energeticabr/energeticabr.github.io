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

export function createSharePointRepository(graph, siteConfig) {
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
    clearCache,
  });
}
