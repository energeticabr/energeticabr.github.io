import portalConfig from "../config.js";
import { normalizeEmail } from "../core/utils.js";
import { ACTIONS, buildDefaultAccess, buildSuperAdminAccess, isSuperAdmin, permissionField } from "./access-model.js";
import { MODULES } from "../catalog/modules.js";
import { ENTITIES } from "../catalog/entities.js";
import { SharePointAuthorityError, createSharePointAuthority } from "../security/sharepoint-authority.js";
import { createSharePointAclService } from "../security/sharepoint-acl-service.js";
import {
  PORTAL_BASE_PERMISSIONS,
  maskForPermissionNames,
  permissionMaskValue,
} from "../security/sharepoint-permissions.js";

const ACCESS_LIST_ALIASES = Object.freeze(["PORTAL_ACESSOS", "PORTAL ACESSOS"]);
const ACCESS_SITE_KEY = "company";
const IDENTITY_COLUMN_NAMES = Object.freeze(["EMAIL", "MICROSOFT_OID"]);
const SECURITY_MANIFEST_TITLE = "__PORTAL_SECURITY_V2__";

const ACCESS_FIELD_DEFINITIONS = Object.freeze([
  { name: "EMAIL", text: {}, indexed: true, enforceUniqueValues: true },
  { name: "MICROSOFT_OID", text: {}, indexed: true, enforceUniqueValues: true },
  { name: "NOME", text: {} },
  { name: "STATUS", choice: { allowTextEntry: false, choices: ["ATIVO", "INATIVO"], displayAs: "dropDownMenu" } },
  { name: "PERFIL", text: {} },
  { name: "DATAALTERACAO", dateTime: { format: "dateTime" } },
  { name: "ALTERADOPOR", text: {} },
]);

export class AccessIdentityConflictError extends Error {
  constructor(message = "Há identidades duplicadas em PORTAL_ACESSOS. O superadministrador deve corrigir a lista antes de liberar o acesso.", details = {}) {
    super(message);
    this.name = "AccessIdentityConflictError";
    this.code = "duplicate_identity";
    Object.assign(this, details);
  }
}

export class AccessIdentityResolutionError extends Error {
  constructor(message = "Não foi possível vincular uma única conta Microsoft a este e-mail.", details = {}) {
    super(message);
    this.name = "AccessIdentityResolutionError";
    this.code = "identity_resolution_failed";
    Object.assign(this, details);
  }
}

export class AccessReconciliationError extends Error {
  constructor(message = "A sincronizacao das permissoes falhou. O cadastro foi mantido inativo e requer reconciliacao.", details = {}) {
    super(message, { cause: details.cause });
    this.name = "AccessReconciliationError";
    this.code = "access_reconciliation_required";
    Object.assign(this, details);
  }
}

function affirmative(value) {
  return value === true || ["SIM", "TRUE", "1", "ATIVO"].includes(String(value || "").trim().toUpperCase());
}

function normalizeOid(value) {
  const oid = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(oid) ? oid : "";
}

function normalizeIdentity(value) {
  if (typeof value === "string") return Object.freeze({ oid: "", email: normalizeEmail(value), name: "" });
  return Object.freeze({
    oid: normalizeOid(value?.oid || value?.objectId || value?.localAccountId || value?.id),
    email: normalizeEmail(value?.email || value?.username || value?.userPrincipalName || value?.preferred_username),
    name: String(value?.name || value?.displayName || "").trim(),
  });
}

function accessColumns(modules) {
  return [...ACCESS_FIELD_DEFINITIONS, ...modules.flatMap(({ id }) => ACTIONS.map(action => ({ name: permissionField(id, action), text: {} })))];
}

function fieldValue(record, fieldName) {
  return record?.fields?.[fieldName] ?? record?.[fieldName];
}

function systemIdentityLabel(identitySet) {
  const identity = identitySet?.user || identitySet?.siteUser || identitySet?.application || identitySet;
  return String(identity?.email || identity?.userPrincipalName || identity?.mail || identity?.loginName || identity?.displayName || identity?.id || "").trim();
}

function toAccessRecord(item, modules) {
  const fields = item?.fields || item || {};
  const access = buildDefaultAccess(fieldValue(fields, "EMAIL"), fieldValue(fields, "NOME"), modules);
  access.id = item?.id;
  access.eTag = item?.eTag || item?.["@odata.etag"] || fields?.["@odata.etag"];
  access.oid = normalizeOid(fieldValue(fields, "MICROSOFT_OID"));
  access.active = affirmative(fieldValue(fields, "STATUS"));
  access.profile = String(fieldValue(fields, "PERFIL") || "USUARIO").trim() || "USUARIO";
  access.changedAt = item?.lastModifiedDateTime || fieldValue(fields, "DATAALTERACAO") || undefined;
  access.changedBy = systemIdentityLabel(item?.lastModifiedBy) || String(fieldValue(fields, "ALTERADOPOR") || "").trim();
  for (const module of modules) {
    for (const action of ACTIONS) access.permissions[module.id][action] = affirmative(fieldValue(fields, permissionField(module.id, action)));
  }
  return access;
}

function toSharePointFields(record, modules, changedBy, changedAt) {
  const access = buildDefaultAccess(record?.email, record?.name, modules);
  const fields = {
    Title: access.email.toUpperCase(),
    EMAIL: access.email.toUpperCase(),
    NOME: access.name.toLocaleUpperCase("pt-BR"),
    STATUS: record?.active === true ? "ATIVO" : "INATIVO",
    PERFIL: String(record?.profile || "USUARIO").trim().toLocaleUpperCase("pt-BR") || "USUARIO",
    DATAALTERACAO: changedAt,
    ALTERADOPOR: changedBy,
  };
  const oid = normalizeOid(record?.oid);
  if (oid) fields.MICROSOFT_OID = oid;
  for (const module of modules) {
    for (const action of ACTIONS) fields[permissionField(module.id, action)] = record?.permissions?.[module.id]?.[action] === true ? "SIM" : "NAO";
  }
  return fields;
}

function escapeFilterValue(value) {
  return String(value || "").replace(/'/g, "''");
}

function identityQueries(identity) {
  const queries = [];
  if (identity.oid) queries.push(`$expand=fields&$filter=fields/MICROSOFT_OID eq '${escapeFilterValue(identity.oid)}'`);
  if (identity.email) queries.push(`$expand=fields&$filter=fields/EMAIL eq '${escapeFilterValue(identity.email.toUpperCase())}'`);
  return queries;
}

function matchingIdentityRecords(items, identity, modules) {
  return (items || []).map(item => toAccessRecord(item, modules))
    .filter(record => (identity.oid && record.oid === identity.oid) || (identity.email && record.email === identity.email));
}

async function findIdentityRecords(sharepoint, listId, identity, modules) {
  const pages = await Promise.all(identityQueries(identity).map(query => sharepoint.getItems(ACCESS_SITE_KEY, listId, query)));
  const uniqueItems = new Map();
  for (const item of pages.flat()) {
    const key = item?.id ? `id:${item.id}` : `value:${JSON.stringify(item)}`;
    if (!uniqueItems.has(key)) uniqueItems.set(key, item);
  }
  return matchingIdentityRecords([...uniqueItems.values()], identity, modules);
}

function assertSingleIdentity(records, identity) {
  if (records.length > 1) {
    throw new AccessIdentityConflictError(undefined, { identity: Object.freeze({ ...identity }), itemIds: Object.freeze(records.map(record => record.id)) });
  }
  return records[0];
}

function assertNoDuplicateIdentities(records) {
  const owners = new Map();
  const duplicates = new Set();
  for (const record of records) {
    for (const key of [record.oid && `oid:${record.oid}`, record.email && `email:${record.email}`].filter(Boolean)) {
      const previous = owners.get(key);
      if (previous && previous !== record.id) duplicates.add(key);
      else owners.set(key, record.id);
    }
  }
  if (duplicates.size) throw new AccessIdentityConflictError(undefined, { duplicateKeys: Object.freeze([...duplicates]) });
}

function securityState(status, instructions, details = {}) {
  return Object.freeze({ status, instructions, ...details });
}

function roleBindings(assignment) {
  const value = assignment?.RoleDefinitionBindings;
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.results)) return value.results;
  return undefined;
}

function roleCapability(binding) {
  const kind = Number(binding?.RoleTypeKind);
  if (kind === 2) return "read";
  if ([3, 4, 5].includes(kind)) return "write";
  const name = String(binding?.Name || "").trim().toLowerCase();
  if (["read", "leitura"].includes(name)) return "read";
  if (["contribute", "edit", "full control", "contribuição", "editar", "controle total"].includes(name)) return "write";
  return "unknown";
}

function memberEmail(member) {
  const direct = normalizeEmail(member?.Email || member?.email || member?.UserPrincipalName);
  if (direct) return direct;
  const login = String(member?.LoginName || "").trim();
  return normalizeEmail(login.includes("|") ? login.slice(login.lastIndexOf("|") + 1) : login);
}

function inspectPermissions(acl, configuredSuperAdmin, accountEmail) {
  if (acl?.HasUniqueRoleAssignments !== true || !Array.isArray(acl?.RoleAssignments)) {
    const status = acl?.HasUniqueRoleAssignments === false ? "insecure" : "indeterminate";
    return securityState(status, acl?.HasUniqueRoleAssignments === false
      ? "PORTAL_ACESSOS herda permissões do site. Configure permissões exclusivas antes de liberar usuários comuns."
      : "Não foi possível confirmar a forma da ACL de PORTAL_ACESSOS no SharePoint.");
  }
  let superAdminCanWrite = false;
  let accountCanRead = isSuperAdmin(accountEmail, configuredSuperAdmin);
  for (const assignment of acl.RoleAssignments) {
    const member = assignment?.Member;
    const bindings = roleBindings(assignment);
    if (Number(member?.PrincipalType) !== 1 || !bindings?.length) {
      return securityState("indeterminate", "A ACL de PORTAL_ACESSOS contém grupo, identidade ou função que não pode ser validada com segurança.");
    }
    const email = memberEmail(member);
    const capabilities = bindings.map(roleCapability);
    if (!email || capabilities.includes("unknown")) {
      return securityState("indeterminate", "A ACL de PORTAL_ACESSOS contém identidade ou função que não pode ser validada com segurança.");
    }
    if (capabilities.includes("write")) {
      if (email !== configuredSuperAdmin) return securityState("insecure", "A ACL de PORTAL_ACESSOS concede escrita a uma identidade diferente do superadministrador.");
      superAdminCanWrite = true;
    }
    if (email === accountEmail) accountCanRead = true;
  }
  if (!superAdminCanWrite) return securityState("insecure", "A ACL de PORTAL_ACESSOS não comprova escrita exclusiva do superadministrador.");
  if (!accountCanRead) return securityState("setup_required", "Sua conta ainda não recebeu leitura direta em PORTAL_ACESSOS.");
  return securityState("secure", "Permissões de PORTAL_ACESSOS verificadas pelo SharePoint REST.");
}

function inspectEffectivePermissions(security) {
  if (security?.HasUniqueRoleAssignments !== true) {
    return securityState(
      security?.HasUniqueRoleAssignments === false ? "insecure" : "indeterminate",
      security?.HasUniqueRoleAssignments === false
        ? "PORTAL_ACESSOS herda permissões do site. Configure permissões exclusivas antes de liberar usuários comuns."
        : "Não foi possível confirmar as permissões exclusivas de PORTAL_ACESSOS.",
    );
  }
  const mask = permissionMaskValue(security?.EffectiveBasePermissions);
  if (mask === undefined) return securityState("indeterminate", "O SharePoint não retornou as permissões efetivas de PORTAL_ACESSOS em um formato comprovável.");
  const expectedMask = maskForPermissionNames(PORTAL_BASE_PERMISSIONS);
  if ((mask & 1n) === 0n) {
    return securityState("setup_required", "Sua conta ainda não recebeu leitura direta em PORTAL_ACESSOS.");
  }
  if (mask !== expectedMask) return securityState("insecure", "As permissões efetivas de PORTAL_ACESSOS não coincidem exatamente com o contrato de leitura protegida; o acesso comum foi bloqueado.");
  return securityState(
    "indeterminate",
    "Sua leitura sem escrita em PORTAL_ACESSOS foi confirmada, mas a exclusividade de escrita do superadministrador ainda precisa ser comprovada antes de liberar usuários comuns.",
    { readOnly: true },
  );
}

function exactMicrosoftIdentityMatches(users, email) {
  const matches = new Map();
  for (const user of users || []) {
    const id = normalizeOid(user?.id);
    const addresses = [user?.mail, user?.userPrincipalName].map(normalizeEmail).filter(Boolean);
    if (id && addresses.includes(email)) matches.set(id, user);
  }
  return [...matches.values()];
}

export function createAccessRepository({ sharepoint, graph, config = portalConfig, modules = MODULES, entities = ENTITIES, getCurrentIdentity, getCurrentEmail = () => "", now = () => new Date().toISOString(), aclService } = {}) {
  if (!sharepoint || typeof sharepoint.resolveList !== "function") throw new TypeError("O repositorio de acessos requer o repositorio SharePoint.");

  const sessionIdentity = () => normalizeIdentity(getCurrentIdentity ? getCurrentIdentity() : getCurrentEmail());
  const currentEmail = () => sessionIdentity().email;
  const assertSuperAdmin = () => {
    if (!isSuperAdmin(currentEmail(), config.superAdminEmail)) throw new Error("Somente o superadministrador pode administrar acessos.");
  };
  const resolveAccessList = () => sharepoint.resolveList(ACCESS_SITE_KEY, ACCESS_LIST_ALIASES);
  async function requireAccessList() {
    const list = await resolveAccessList();
    if (list?.status !== "resolved") throw new Error("A lista PORTAL_ACESSOS ainda nao foi configurada.");
    return list;
  }

  async function getAccessListSecurity() {
    const list = await resolveAccessList();
    if (list?.status !== "resolved") return securityState("setup_required", "A lista PORTAL_ACESSOS ainda não existe. O superadministrador deve criá-la e concluir as permissões exclusivas no SharePoint.");
    try {
      if (isSuperAdmin(currentEmail(), config.superAdminEmail)) {
        const getAdministrativeSecurity = sharepoint.getListAdministrativeSecurity || sharepoint.getListSecurity;
        if (typeof getAdministrativeSecurity !== "function") return securityState("indeterminate", "Não foi possível consultar a ACL administrativa de PORTAL_ACESSOS pelo SharePoint REST.");
        return inspectPermissions(await getAdministrativeSecurity.call(sharepoint, ACCESS_SITE_KEY, list.id), normalizeEmail(config.superAdminEmail), currentEmail());
      }
      if (typeof sharepoint.getListEffectivePermissions !== "function") return securityState("indeterminate", "Não foi possível consultar as permissões efetivas de PORTAL_ACESSOS pelo SharePoint REST.");
      return inspectEffectivePermissions(await sharepoint.getListEffectivePermissions(ACCESS_SITE_KEY, list.id));
    } catch {
      return securityState("indeterminate", "Não foi possível comprovar a ACL de PORTAL_ACESSOS. Revise as permissões exclusivas da lista no SharePoint e tente novamente.");
    }
  }

  async function accessForEntityAuthority() {
    const session = sessionIdentity();
    if (isSuperAdmin(session.email, config.superAdminEmail)) {
      const access = buildSuperAdminAccess(config.superAdminEmail, session.name || "Bernardo Notini", modules);
      access.oid = session.oid;
      return access;
    }
    const list = await resolveAccessList();
    if (list?.status !== "resolved") return buildDefaultAccess(session.email, "", modules);
    const records = await findIdentityRecords(sharepoint, list.id, session, modules);
    if (records.length !== 1) return buildDefaultAccess(session.email, "", modules);
    const match = records[0];
    if (!match?.oid || !session.oid || match.oid !== session.oid) return buildDefaultAccess(session.email, "", modules);
    return match;
  }

  async function securityManifestItems(listId) {
    const items = await sharepoint.getItems(
      ACCESS_SITE_KEY,
      listId,
      `$select=id,createdBy,lastModifiedBy&$expand=fields&$filter=fields/Title eq '${SECURITY_MANIFEST_TITLE}'`,
    );
    const manifests = (items || []).filter(item => {
      const fields = item?.fields || item || {};
      return String(fields.Title || "").trim() === SECURITY_MANIFEST_TITLE;
    });
    return manifests;
  }

  async function findSecurityManifestItem(listId) {
    const manifests = await securityManifestItems(listId);
    return manifests.length === 1 ? manifests[0] : undefined;
  }

  async function findSecurityManifest(listId) {
    const manifest = await findSecurityManifestItem(listId);
    if (!manifest) return undefined;
    const fields = manifest?.fields || manifest || {};
    const proof = String(fields.NOME || "").trim().toLowerCase();
    const trustedAuthor = normalizeEmail(systemIdentityLabel(manifest?.createdBy)) === normalizeEmail(config.superAdminEmail)
      && normalizeEmail(systemIdentityLabel(manifest?.lastModifiedBy)) === normalizeEmail(config.superAdminEmail);
    const verified = affirmative(fields.STATUS)
      && String(fields.PERFIL || "").trim().toUpperCase() === "SECURITY_MANIFEST_V2"
      && /^[a-f0-9]{64}$/.test(proof)
      && normalizeEmail(fields.ALTERADOPOR) === normalizeEmail(config.superAdminEmail)
      && trustedAuthor;
    return verified ? Object.freeze({ item: manifest, proof }) : undefined;
  }

  async function writeSecurityManifest(list, proof) {
    const fields = {
      Title: SECURITY_MANIFEST_TITLE,
      NOME: String(proof || "").trim().toLowerCase(),
      STATUS: "ATIVO",
      PERFIL: "SECURITY_MANIFEST_V2",
      DATAALTERACAO: now(),
      ALTERADOPOR: currentEmail(),
    };
    const existing = await findSecurityManifestItem(list.id);
    if (existing?.id) {
      return sharepoint.updateItem(ACCESS_SITE_KEY, list.id, existing.id, fields, { eTag: existing.eTag || existing["@odata.etag"] });
    }
    return sharepoint.createItem(ACCESS_SITE_KEY, list.id, fields);
  }

  async function invalidateSecurityManifest(list) {
    const manifests = await securityManifestItems(list.id);
    if (manifests.length > 1) throw new Error("Existem manifestos de seguranca duplicados; o setup foi bloqueado antes de alterar ACLs.");
    const existing = manifests[0];
    if (!existing?.id) return;
    await sharepoint.updateItem(ACCESS_SITE_KEY, list.id, existing.id, {
      STATUS: "INATIVO",
      DATAALTERACAO: now(),
      ALTERADOPOR: currentEmail(),
    }, { eTag: existing.eTag || existing["@odata.etag"] });
  }

  const supportsEntityAuthority = typeof sharepoint.setAuthorizationProvider === "function"
    && typeof sharepoint.getListEffectivePermissions === "function";
  const entityAuthority = supportsEntityAuthority
    ? createSharePointAuthority({
      sharepoint,
      entities,
      getAccess: accessForEntityAuthority,
      isRecoveryAdmin: access => isSuperAdmin(access?.email, config.superAdminEmail),
    })
    : Object.freeze({ invalidate() {} });
  const supportsAclLifecycle = [
    "getListAdministrativeSecurity",
    "getPortalRoleDefinition",
    "ensurePortalRoleDefinition",
    "ensurePortalGroup",
    "ensureSiteUser",
    "configureListRoleAssignments",
    "restoreListRoleAssignments",
    "restorePortalRoleDefinition",
    "syncPortalGroupMemberships",
    "getUserListEffectivePermissions",
    "getListEffectivePermissions",
  ].every(method => typeof sharepoint[method] === "function");
  const unavailableAclService = Object.freeze({
    async reconcileUserAccess() {
      if (supportsEntityAuthority) throw new Error("O transporte de ACL SharePoint esta incompleto.");
      return Object.freeze({ status: "legacy_repository_without_acl_transport" });
    },
    async denyUser() {
      if (supportsEntityAuthority) throw new Error("O transporte de ACL SharePoint esta incompleto.");
      return Object.freeze({ status: "legacy_repository_without_acl_transport" });
    },
    async previewSecuritySetup() { throw new Error("A configuracao de ACL SharePoint nao esta disponivel neste repositorio."); },
    async applySecuritySetup() { throw new Error("A configuracao de ACL SharePoint nao esta disponivel neste repositorio."); },
    async verifySecuritySetup() { return Object.freeze({ verified: false, reasons: Object.freeze(["Transporte de ACL indisponivel."]) }); },
    async verifyUserAccess() { return Object.freeze({ verified: false, reasons: Object.freeze(["Transporte de ACL indisponivel."]) }); },
  });
  const securityService = aclService || (supportsAclLifecycle
    ? createSharePointAclService({ sharepoint, entities, modules, config, getCurrentIdentity: sessionIdentity })
    : unavailableAclService);

  if (supportsEntityAuthority) {
    sharepoint.setAuthorizationProvider({
      async authorize(request) {
        const accessList = await resolveAccessList();
        if (accessList?.status === "resolved" && String(accessList.id) === String(request.listId)) {
          if (isSuperAdmin(currentEmail(), config.superAdminEmail)) {
            return Object.freeze({ allowed: true, action: request.action, list: "PORTAL_ACESSOS" });
          }
          if (request.action !== "view") {
            throw new SharePointAuthorityError("access_list_write_denied", "Somente o superadministrador pode alterar PORTAL_ACESSOS.");
          }
          const security = await sharepoint.getListEffectivePermissions(ACCESS_SITE_KEY, accessList.id);
          const mask = security?.HasUniqueRoleAssignments === true
            ? permissionMaskValue(security?.EffectiveBasePermissions)
            : undefined;
          if (mask === undefined || mask !== maskForPermissionNames(PORTAL_BASE_PERMISSIONS)) {
            throw new SharePointAuthorityError("access_list_acl_unverified", "A leitura protegida de PORTAL_ACESSOS nao foi comprovada.");
          }
          return Object.freeze({ allowed: true, action: "view", list: "PORTAL_ACESSOS" });
        }
        return entityAuthority.authorize(request);
      },
      invalidate: entityAuthority.invalidate,
    });
  }

  async function disableAfterReconciliationFailure(list, access, cause) {
    let disabled = { ...access, active: false };
    try {
      if (access?.id) {
        const updated = await sharepoint.updateItem(
          ACCESS_SITE_KEY,
          list.id,
          access.id,
          { STATUS: "INATIVO", DATAALTERACAO: now(), ALTERADOPOR: currentEmail() },
          { eTag: access.eTag },
        );
        disabled = toAccessRecord(updated, modules);
      }
    } catch {
      disabled.active = false;
    }
    try {
      await securityService.denyUser?.(disabled);
    } catch {
      // The inactive access record remains the first fail-closed barrier.
    }
    throw new AccessReconciliationError(undefined, {
      cause,
      userEmail: access?.email,
      reconciliationAction: "Revise a configuracao dos grupos SharePoint e execute a reconciliacao novamente.",
    });
  }

  async function resolveMicrosoftIdentity(email) {
    if (!graph?.request) throw new AccessIdentityResolutionError("A consulta Microsoft necessária para vincular esta conta não está disponível.", { email });
    const escaped = escapeFilterValue(email);
    const query = new URLSearchParams({
      "$select": "id,displayName,mail,userPrincipalName",
      "$filter": `mail eq '${escaped}' or userPrincipalName eq '${escaped}'`,
      "$top": "3",
    });
    let payload;
    try {
      payload = await graph.request(`/users?${query.toString()}`, { method: "GET", scopes: ["User.ReadBasic.All"] });
    } catch (error) {
      throw new AccessIdentityResolutionError("Não foi possível consultar a conta Microsoft. Nenhuma permissão foi salva.", { email, cause: error });
    }
    const matches = exactMicrosoftIdentityMatches(payload?.value, email);
    if (matches.length !== 1) {
      throw new AccessIdentityResolutionError(matches.length
        ? "Mais de uma conta Microsoft corresponde a este e-mail. Corrija o diretório antes de liberar acesso."
        : "Nenhuma conta Microsoft corresponde a este e-mail ou UPN.", { email, matchCount: matches.length });
    }
    return Object.freeze({
      oid: normalizeOid(matches[0].id),
      email,
      name: String(matches[0].displayName || "").trim(),
    });
  }

  async function ensureAccessColumns(site, list) {
    if (!graph?.request || typeof sharepoint.getColumns !== "function") throw new Error("Não foi possível atualizar as colunas de PORTAL_ACESSOS.");
    const columns = await sharepoint.getColumns(ACCESS_SITE_KEY, list.id);
    for (const definition of accessColumns(modules)) {
      const existing = columns.find(column => String(column?.name || "").toUpperCase() === definition.name);
      if (!existing) {
        await graph.request(`/sites/${encodeURIComponent(site.id)}/lists/${encodeURIComponent(list.id)}/columns`, { method: "POST", scopes: ["Sites.Manage.All"], body: definition });
      } else if (IDENTITY_COLUMN_NAMES.includes(definition.name) && (existing.indexed !== true || existing.enforceUniqueValues !== true)) {
        await graph.request(`/sites/${encodeURIComponent(site.id)}/lists/${encodeURIComponent(list.id)}/columns/${encodeURIComponent(existing.id)}`, { method: "PATCH", scopes: ["Sites.Manage.All"], body: { indexed: true, enforceUniqueValues: true } });
      }
    }
  }

  return Object.freeze({
    async ensureList() {
      assertSuperAdmin();
      const sites = await sharepoint.resolveSites();
      const site = sites?.[ACCESS_SITE_KEY];
      if (!site?.id) throw new Error("Nao foi possivel configurar PORTAL_ACESSOS: site corporativo indisponivel.");
      const existing = await resolveAccessList();
      if (existing?.status === "resolved") {
        await ensureAccessColumns(site, existing);
        sharepoint.clearCache?.();
        return { ...existing, security: await getAccessListSecurity() };
      }
      if (!graph?.request) throw new Error("Nao foi possivel configurar PORTAL_ACESSOS: acesso Microsoft adicional indisponivel.");
      const created = await graph.request(`/sites/${encodeURIComponent(site.id)}/lists`, { method: "POST", scopes: ["Sites.Manage.All"], body: { displayName: "PORTAL_ACESSOS", list: { template: "genericList" }, columns: accessColumns(modules) } });
      sharepoint.clearCache?.();
      return { ...created, status: "created", security: securityState("setup_required", "A lista foi criada com identidade indexada e única, mas ainda precisa de permissões exclusivas no SharePoint.") };
    },

    async getCurrentAccess(requestedIdentity) {
      const requested = normalizeIdentity(requestedIdentity);
      const session = sessionIdentity();
      const identityMatches = Boolean(session.email && requested.email === session.email) && (!requested.oid || !session.oid || requested.oid === session.oid);
      if (!identityMatches) return { ...buildDefaultAccess(session.email, "", modules), security: securityState("identity_mismatch", "A identidade solicitada não corresponde à conta Microsoft conectada.") };
      if (isSuperAdmin(session.email, config.superAdminEmail)) {
        const access = buildSuperAdminAccess(config.superAdminEmail, session.name || "Bernardo Notini", modules);
        access.oid = session.oid;
        return { ...access, security: securityState("superadmin", "O superadministrador permanece funcional enquanto a ACL é configurada.") };
      }
      const list = await resolveAccessList();
      if (list?.status !== "resolved") return { ...buildDefaultAccess(session.email, "", modules), security: await getAccessListSecurity() };
      let security = await getAccessListSecurity();
      let records;
      let match;
      if (security.status !== "secure" && security.readOnly === true) {
        const manifest = await findSecurityManifest(list.id);
        let verification;
        try {
          if (manifest) {
            records = await findIdentityRecords(sharepoint, list.id, session, modules);
            if (records.length === 1) match = records[0];
            verification = match ? await securityService.verifyUserAccess(match) : undefined;
          }
        } catch {
          verification = undefined;
        }
        if (verification?.verified === true) {
          security = securityState("secure", "O recibo Microsoft e as permissoes efetivas desta conta coincidem com o contrato; cada acao continua validada na ACL da lista.");
        }
      }
      if (security.status !== "secure") return { ...buildDefaultAccess(session.email, "", modules), security };
      records ||= await findIdentityRecords(sharepoint, list.id, session, modules);
      if (records.length > 1) return { ...buildDefaultAccess(session.email, "", modules), security: securityState("duplicate_identity", "Há cadastros duplicados para esta conta. O superadministrador deve corrigir PORTAL_ACESSOS antes de liberar o acesso.") };
      match ||= records[0];
      if (match && !match.oid) return { ...buildDefaultAccess(session.email, match.name, modules), security: securityState("legacy_identity_unbound", "Este acesso antigo ainda não foi vinculado ao identificador Microsoft imutável. Solicite ao superadministrador a migração explícita.") };
      if (match?.oid && (!session.oid || match.oid !== session.oid)) return { ...buildDefaultAccess(session.email, "", modules), security: securityState("identity_mismatch", "O identificador Microsoft desta conta não corresponde ao cadastro de acesso.") };
      return { ...(match || buildDefaultAccess(session.email, "", modules)), security };
    },

    async listUsers() {
      assertSuperAdmin();
      const list = await resolveAccessList();
      if (list?.status !== "resolved") return [];
      const records = (await sharepoint.getItems(ACCESS_SITE_KEY, list.id))
        .filter(item => {
          const fields = item?.fields || item || {};
          const profile = String(fields.PERFIL || "").trim().toUpperCase();
          return String(fields.Title || "").trim() !== SECURITY_MANIFEST_TITLE
            && !profile.startsWith("SECURITY_MANIFEST");
        })
        .map(item => toAccessRecord(item, modules))
        .filter(record => !String(record.profile || "").toUpperCase().startsWith("SECURITY_MANIFEST"));
      assertNoDuplicateIdentities(records);
      return records.sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.email.localeCompare(b.email));
    },

    async saveUserAccess(record) {
      assertSuperAdmin();
      const list = await requireAccessList();
      let identity = normalizeIdentity(record);
      if (!identity.email) throw new Error("Informe o e-mail corporativo do usuario.");
      let existing = assertSingleIdentity(await findIdentityRecords(sharepoint, list.id, identity, modules), identity);
      if (record?.id && !existing) throw new AccessIdentityConflictError("O cadastro de acesso mudou ou foi removido. Recarregue a lista antes de salvar.");
      if (record?.id && existing?.id && String(record.id) !== String(existing.id)) throw new AccessIdentityConflictError("O identificador informado pertence a outro cadastro de acesso.");
      if (existing?.oid && identity.oid && existing.oid !== identity.oid) throw new AccessIdentityConflictError("O identificador Microsoft imutável não pode ser substituído.");
      if (!identity.oid) {
        if (existing && !existing.oid && record?.migrateLegacyIdentity !== true) {
          throw new AccessIdentityResolutionError("Este cadastro legado precisa de migração explícita antes de ser salvo.", { code: "legacy_identity_migration_required", itemId: existing.id });
        }
        const resolvedIdentity = await resolveMicrosoftIdentity(identity.email);
        identity = Object.freeze({ ...identity, oid: resolvedIdentity.oid, name: identity.name || resolvedIdentity.name });
        const resolvedExisting = assertSingleIdentity(await findIdentityRecords(sharepoint, list.id, identity, modules), identity);
        if (existing?.id && resolvedExisting?.id && String(existing.id) !== String(resolvedExisting.id)) {
          throw new AccessIdentityConflictError("O identificador Microsoft resolvido já pertence a outro cadastro de acesso.");
        }
        existing = resolvedExisting || existing;
        if (existing?.oid && existing.oid !== identity.oid) throw new AccessIdentityConflictError("O identificador Microsoft imutável não pode ser substituído.");
      }
      const target = existing;
      const desiredActive = record?.active === true;
      const stagedRecord = { ...record, active: false, email: identity.email, oid: identity.oid || existing?.oid };
      const fields = toSharePointFields(stagedRecord, modules, currentEmail(), now());
      let staged;
      if (target?.id) {
        const eTag = existing?.eTag;
        const updated = await sharepoint.updateItem(ACCESS_SITE_KEY, list.id, target.id, fields, { eTag });
        staged = toAccessRecord(updated, modules);
      } else {
        staged = toAccessRecord(await sharepoint.createItem(ACCESS_SITE_KEY, list.id, fields) || { fields }, modules);
      }
      try {
        if (!desiredActive) {
          await securityService.denyUser(staged);
          entityAuthority.invalidate();
          return staged;
        }
        const desired = { ...staged, active: true };
        await securityService.reconcileUserAccess(desired);
        const activated = await sharepoint.updateItem(
          ACCESS_SITE_KEY,
          list.id,
          staged.id,
          { STATUS: "ATIVO", DATAALTERACAO: now(), ALTERADOPOR: currentEmail() },
          { eTag: staged.eTag },
        );
        entityAuthority.invalidate();
        return toAccessRecord(activated, modules);
      } catch (error) {
        return disableAfterReconciliationFailure(list, staged, error);
      }
    },

    async setUserActive(record, active) {
      assertSuperAdmin();
      if (!record?.id) throw new Error("Selecione um usuario para alterar o status.");
      const list = await requireAccessList();
      const identity = normalizeIdentity(record);
      const existing = assertSingleIdentity(await findIdentityRecords(sharepoint, list.id, identity, modules), identity);
      if (!existing || String(existing.id) !== String(record.id)) throw new AccessIdentityConflictError("O cadastro de acesso mudou. Recarregue a lista antes de revogar ou ativar.");
      if (active === true) {
        try {
          await securityService.reconcileUserAccess({ ...existing, active: true });
          const activated = await sharepoint.updateItem(ACCESS_SITE_KEY, list.id, existing.id, { STATUS: "ATIVO", DATAALTERACAO: now(), ALTERADOPOR: currentEmail() }, { eTag: existing.eTag });
          entityAuthority.invalidate();
          return activated;
        } catch (error) {
          return disableAfterReconciliationFailure(list, existing, error);
        }
      }
      const disabled = await sharepoint.updateItem(ACCESS_SITE_KEY, list.id, existing.id, { STATUS: "INATIVO", DATAALTERACAO: now(), ALTERADOPOR: currentEmail() }, { eTag: existing.eTag });
      try {
        await securityService.denyUser({ ...toAccessRecord(disabled, modules), active: false });
      } catch (error) {
        throw new AccessReconciliationError("O cadastro foi inativado, mas a remocao dos grupos precisa de reconciliacao.", {
          cause: error,
          userEmail: existing.email,
          reconciliationAction: "Remova o usuario dos grupos ENERGETICA_PORTAL_* e verifique novamente.",
        });
      } finally {
        entityAuthority.invalidate();
      }
      return disabled;
    },

    getAccessListSecurity,
    previewSecuritySetup: () => securityService.previewSecuritySetup(),
    async applySecuritySetup(options) {
      assertSuperAdmin();
      const list = await requireAccessList();
      await invalidateSecurityManifest(list);
      const result = await securityService.applySecuritySetup(options);
      const verification = await securityService.verifySecuritySetup();
      if (result?.status !== "verified" || verification?.verified !== true || result.planHash !== verification.planHash) {
        throw new AccessReconciliationError("A configuracao SharePoint nao foi comprovada; o portal comum permanece fechado.", {
          reconciliationAction: "Gere uma nova pre-visualizacao e aplique a configuracao novamente.",
        });
      }
      await writeSecurityManifest(list, verification.proof);
      entityAuthority.invalidate();
      return result;
    },
    verifySecuritySetup: () => securityService.verifySecuritySetup(),
  });
}

export { ACCESS_LIST_ALIASES, ACCESS_FIELD_DEFINITIONS, SECURITY_MANIFEST_TITLE, normalizeOid };
