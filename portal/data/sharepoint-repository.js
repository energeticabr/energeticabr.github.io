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

const ACTION_PERMISSION_KINDS = Object.freeze({
  view: 1,
  create: 2,
  edit: 3,
  delete: 4,
  approve: 5,
  openItems: 6,
  viewVersions: 7,
  viewFormPages: 13,
  open: 17,
  viewPages: 18,
  browseUserInfo: 28,
  useRemoteAPIs: 38,
});

function permissionsMask(actions = []) {
  let mask = 0n;
  for (const action of actions) {
    const kind = ACTION_PERMISSION_KINDS[action];
    if (!kind) throw new RangeError(`Permissao SharePoint desconhecida: ${action}`);
    mask |= 1n << BigInt(kind - 1);
  }
  return {
    High: String((mask >> 32n) & 0xffffffffn),
    Low: String(mask & 0xffffffffn),
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
    await authorize("view", siteKey, listId);
    const cacheKey = `${siteKey}:${listId}`;
    if (columnCache.has(cacheKey)) return columnCache.get(cacheKey);
    const site = await getSite(siteKey);
    const columns = await getPaged(`/sites/${site.id}/lists/${encodeURIComponent(listId)}/columns`);
    columnCache.set(cacheKey, columns);
    return columns;
  }

  async function getItems(siteKey, listId, query = "$expand=fields") {
    await authorize("view", siteKey, listId);
    const site = await getSite(siteKey);
    return getPaged(`/sites/${site.id}/lists/${encodeURIComponent(listId)}/items${queryString(query)}`);
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
    let nextLink = `/_api/web/lists(guid'${list}')/RoleAssignments?$select=Member/Id,Member/Title,Member/LoginName,Member/Email,Member/PrincipalType,RoleDefinitionBindings/Name,RoleDefinitionBindings/RoleTypeKind&$expand=Member,RoleDefinitionBindings`;
    const roleAssignments = [];
    let pageCount = 0;
    while (nextLink) {
      pageCount += 1;
      if (pageCount > 100) throw new Error("A ACL de PORTAL_ACESSOS excedeu o limite seguro de paginação.");
      const page = await restTransport.request(
        config,
        nextLink,
        { method: "GET" },
      );
      const values = restCollection(page);
      if (!Array.isArray(values)) throw new Error("O SharePoint retornou uma página de ACL inválida.");
      roleAssignments.push(...values);
      nextLink = restNextLink(page) || "";
    }
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
      group = await restTransport.request(config, `/_api/web/sitegroups/getbyname('${restLiteral(title)}')?$select=Id,Title`, { method: "GET" });
    } catch (error) {
      if (error?.status !== 404) throw error;
      group = await restTransport.request(config, "/_api/web/sitegroups", {
        method: "POST",
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
    let role;
    try {
      role = await restTransport.request(config, `/_api/web/roledefinitions/getbyname('${restLiteral(name)}')?$select=Id,Name`, { method: "GET" });
    } catch (error) {
      if (error?.status !== 404) throw error;
      const mask = permissionsMask(definition?.permissions);
      role = await restTransport.request(config, "/_api/web/roledefinitions", {
        method: "POST",
        ...jsonRestBody({
          __metadata: { type: "SP.RoleDefinition" },
          Name: name,
          Description: "Permissao operacional gerenciada pelo portal Energetica.",
          BasePermissions: { __metadata: { type: "SP.BasePermissions" }, ...mask },
        }),
      });
    }
    const id = restId(role);
    if (!id) throw new Error(`O SharePoint nao retornou o id da funcao ${name}.`);
    return Object.freeze({ id, name: restTitle(role) || name });
  }

  async function ensureSiteUser(siteKey, email) {
    if (!restTransport?.request) throw new Error("A resolucao de usuarios SharePoint nao esta disponivel.");
    const config = getSiteConfig(siteKey);
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new RangeError("O e-mail do usuario SharePoint e invalido.");
    const loginName = `i:0#.f|membership|${normalizedEmail}`;
    const user = await restTransport.request(config, "/_api/web/ensureuser", {
      method: "POST",
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
    const fullControl = await restTransport.request(config, "/_api/web/roledefinitions/getbytype(5)?$select=Id,Name", { method: "GET" });
    const fullControlId = restId(fullControl);
    if (!fullControlId) throw new Error("A funcao Full Control nao foi localizada.");
    const desired = assignments.map(assignment => {
      const principalId = Number(assignment?.principal?.id);
      const roleId = assignment?.role === "FULL_CONTROL" ? fullControlId : Number(assignment?.roleId);
      if (!Number.isInteger(principalId) || principalId < 1 || !Number.isInteger(roleId) || roleId < 1) {
        throw new RangeError("A atribuicao de ACL contem principal ou funcao invalida.");
      }
      return { principalId, roleId };
    });
    const metadata = await restTransport.request(config, `/_api/web/lists(guid'${list}')?$select=HasUniqueRoleAssignments`, { method: "GET" });
    if (restValue(metadata, "HasUniqueRoleAssignments") !== true) {
      await restTransport.request(config, `/_api/web/lists(guid'${list}')/breakroleinheritance(false,false)`, { method: "POST" });
    }
    const currentPayload = await restTransport.request(
      config,
      `/_api/web/lists(guid'${list}')/RoleAssignments?$select=PrincipalId,RoleDefinitionBindings/Id&$expand=RoleDefinitionBindings`,
      { method: "GET" },
    );
    const current = restCollection(currentPayload).map(assignment => ({
      principalId: Number(assignment?.PrincipalId ?? assignment?.Member?.Id),
      roleIds: (assignment?.RoleDefinitionBindings?.results || assignment?.RoleDefinitionBindings || []).map(role => Number(role?.Id)),
    }));
    for (const existing of current) {
      const expected = desired.find(candidate => candidate.principalId === existing.principalId);
      if (expected && existing.roleIds.length === 1 && existing.roleIds[0] === expected.roleId) continue;
      await restTransport.request(config, `/_api/web/lists(guid'${list}')/roleassignments/getbyprincipalid(${existing.principalId})`, {
        method: "POST",
        headers: { "X-HTTP-Method": "DELETE" },
      });
    }
    for (const expected of desired) {
      const existing = current.find(candidate => candidate.principalId === expected.principalId);
      if (existing && existing.roleIds.length === 1 && existing.roleIds[0] === expected.roleId) continue;
      await restTransport.request(
        config,
        `/_api/web/lists(guid'${list}')/roleassignments/addroleassignment(principalid=${expected.principalId},roledefid=${expected.roleId})`,
        { method: "POST" },
      );
    }
    return Object.freeze({ configured: true, assignments: desired.length });
  }

  async function syncPortalGroupMemberships(siteKey, user, desiredGroups = [], managedGroups = []) {
    if (!restTransport?.request) throw new Error("A sincronizacao de grupos SharePoint nao esta disponivel.");
    const config = getSiteConfig(siteKey);
    const userId = Number(user?.id);
    const loginName = String(user?.loginName || "").trim();
    if (!Number.isInteger(userId) || userId < 1 || !loginName) throw new RangeError("O usuario SharePoint da reconciliacao e invalido.");
    const desired = new Set(desiredGroups);
    for (const name of managedGroups) {
      if (!/^ENERGETICA_PORTAL_[A-Z0-9_]+$/.test(name)) throw new RangeError("A reconciliacao recebeu um grupo fora do namespace permitido.");
      const group = await restTransport.request(config, `/_api/web/sitegroups/getbyname('${restLiteral(name)}')?$select=Id,Title`, { method: "GET" });
      const groupId = restId(group);
      if (!groupId) throw new Error(`O grupo ${name} nao foi localizado.`);
      const users = restCollection(await restTransport.request(config, `/_api/web/sitegroups(${groupId})/users?$select=Id,LoginName`, { method: "GET" }));
      const member = users.some(candidate => Number(candidate?.Id ?? candidate?.id) === userId);
      if (desired.has(name) && !member) {
        await restTransport.request(config, `/_api/web/sitegroups(${groupId})/users`, {
          method: "POST",
          ...jsonRestBody({ __metadata: { type: "SP.User" }, LoginName: loginName }),
        });
      } else if (!desired.has(name) && member) {
        await restTransport.request(config, `/_api/web/sitegroups(${groupId})/users/removeById(${userId})`, { method: "POST" });
      }
    }
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
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body,
    });
  }

  async function deleteAttachment(siteKey, listId, itemId, fileName) {
    await authorize("edit", siteKey, listId, { itemId: String(itemId || "") });
    const name = attachmentName(fileName);
    return requestAttachment(siteKey, listId, itemId, `('${name}')`, {
      method: "POST",
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
    ensureSiteUser,
    getUserListEffectivePermissions,
    configureListRoleAssignments,
    syncPortalGroupMemberships,
    getItemVersions,
    setAuthorizationProvider,
    clearCache,
  });
}
