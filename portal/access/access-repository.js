import portalConfig from "../config.js";
import { normalizeEmail } from "../core/utils.js";
import {
  ACTIONS,
  buildDefaultAccess,
  buildSuperAdminAccess,
  isSuperAdmin,
  permissionField,
} from "./access-model.js";
import { MODULES } from "../catalog/modules.js";

const ACCESS_LIST_ALIASES = Object.freeze(["PORTAL_ACESSOS", "PORTAL ACESSOS"]);
const ACCESS_SITE_KEY = "company";
const ACCESS_SECURITY_SCOPES = Object.freeze(["Sites.Read.All"]);

const ACCESS_FIELD_DEFINITIONS = Object.freeze([
  { name: "EMAIL", text: {} },
  { name: "NOME", text: {} },
  { name: "STATUS", choice: { allowTextEntry: false, choices: ["ATIVO", "INATIVO"], displayAs: "dropDownMenu" } },
  { name: "PERFIL", text: {} },
  { name: "DATAALTERACAO", dateTime: { format: "dateTime" } },
  { name: "ALTERADOPOR", text: {} },
]);

function affirmative(value) {
  return value === true || ["SIM", "TRUE", "1", "ATIVO"].includes(String(value || "").trim().toUpperCase());
}

function accessColumns(modules) {
  return [
    ...ACCESS_FIELD_DEFINITIONS,
    ...modules.flatMap(({ id }) => ACTIONS.map(action => ({ name: permissionField(id, action), text: {} }))),
  ];
}

function fieldValue(record, fieldName) {
  return record?.fields?.[fieldName] ?? record?.[fieldName];
}

function toAccessRecord(item, modules) {
  const fields = item?.fields || item || {};
  const access = buildDefaultAccess(fieldValue(fields, "EMAIL"), fieldValue(fields, "NOME"), modules);
  access.id = item?.id;
  access.active = affirmative(fieldValue(fields, "STATUS"));
  access.profile = String(fieldValue(fields, "PERFIL") || "USUARIO").trim() || "USUARIO";
  access.changedAt = item?.lastModifiedDateTime || fieldValue(fields, "DATAALTERACAO") || undefined;
  access.changedBy = systemIdentityLabel(item?.lastModifiedBy) || String(fieldValue(fields, "ALTERADOPOR") || "").trim();

  for (const module of modules) {
    for (const action of ACTIONS) {
      access.permissions[module.id][action] = affirmative(fieldValue(fields, permissionField(module.id, action)));
    }
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

  for (const module of modules) {
    for (const action of ACTIONS) {
      fields[permissionField(module.id, action)] = record?.permissions?.[module.id]?.[action] === true ? "SIM" : "NAO";
    }
  }
  return fields;
}

function currentAccessQuery(email) {
  return `$expand=fields&$filter=fields/EMAIL eq '${email.replace(/'/g, "''")}'`;
}

function systemIdentityLabel(identitySet) {
  const identity = identitySet?.user || identitySet?.siteUser || identitySet?.application || identitySet;
  const value = identity?.email || identity?.userPrincipalName || identity?.mail || identity?.loginName
    || identity?.displayName || identity?.id;
  return String(value || "").trim();
}

function permissionIdentitySets(permission) {
  return [
    ...(Array.isArray(permission?.grantedToIdentitiesV2) ? permission.grantedToIdentitiesV2 : []),
    ...(Array.isArray(permission?.grantedToIdentities) ? permission.grantedToIdentities : []),
    ...(permission?.grantedToV2 ? [permission.grantedToV2] : []),
    ...(permission?.grantedTo ? [permission.grantedTo] : []),
  ];
}

function identityEmails(identitySet) {
  const identities = [identitySet?.user, identitySet?.siteUser].filter(Boolean);
  return identities
    .map(identity => normalizeEmail(identity.email || identity.userPrincipalName || identity.mail || identity.loginName))
    .filter(Boolean);
}

function securityState(status, instructions, details = {}) {
  return Object.freeze({ status, instructions, ...details });
}

function inspectPermissions(permissions, configuredSuperAdmin, accountEmail) {
  if (!Array.isArray(permissions)) {
    return securityState("indeterminate", "Não foi possível confirmar as permissões da lista PORTAL_ACESSOS no SharePoint.");
  }

  let superAdminCanWrite = false;
  let accountCanRead = isSuperAdmin(accountEmail, configuredSuperAdmin);
  for (const permission of permissions) {
    if (!Object.hasOwn(permission || {}, "inheritedFrom")) {
      return securityState("indeterminate", "O SharePoint não informou se a ACL de PORTAL_ACESSOS é herdada. Configure permissões exclusivas da lista e tente novamente.");
    }
    if (permission.inheritedFrom !== null) {
      return securityState("insecure", "PORTAL_ACESSOS herda permissões do site. Configure permissões exclusivas: leitura direta aos usuários autorizados e escrita somente ao superadministrador.");
    }

    const roles = Array.isArray(permission.roles)
      ? permission.roles.map(role => String(role).trim().toLowerCase()).filter(Boolean)
      : [];
    if (roles.length === 0 || roles.some(role => !["read", "write", "owner", "fullcontrol", "full_control"].includes(role))) {
      return securityState("indeterminate", "A ACL de PORTAL_ACESSOS contém uma função de permissão que não pode ser validada com segurança.");
    }

    const identities = permissionIdentitySets(permission);
    const emails = identities.flatMap(identityEmails);
    if (identities.length === 0 || identities.some(identity => identityEmails(identity).length !== 1)) {
      return securityState("indeterminate", "A ACL de PORTAL_ACESSOS contém uma identidade não verificável. Use identidades diretas de usuários para concluir a configuração.");
    }

    const writable = roles.some(role => role !== "read");
    if (writable) {
      if (emails.some(email => email !== configuredSuperAdmin)) {
        return securityState("insecure", "A ACL de PORTAL_ACESSOS concede escrita ou controle a uma identidade diferente do superadministrador.");
      }
      superAdminCanWrite = true;
      if (isSuperAdmin(accountEmail, configuredSuperAdmin)) accountCanRead = true;
      continue;
    }

    if (emails.includes(accountEmail)) accountCanRead = true;
  }

  if (!superAdminCanWrite) {
    return securityState("insecure", "A ACL de PORTAL_ACESSOS não comprova escrita ou controle exclusivo do superadministrador.");
  }
  if (!accountCanRead) {
    return securityState("setup_required", "Sua conta ainda não recebeu leitura direta em PORTAL_ACESSOS. O superadministrador deve conceder leitura no SharePoint antes de liberar o portal.");
  }
  return securityState("secure", "Permissões de PORTAL_ACESSOS verificadas.");
}

export function createAccessRepository({
  sharepoint,
  graph,
  config = portalConfig,
  modules = MODULES,
  getCurrentEmail = () => "",
  now = () => new Date().toISOString(),
} = {}) {
  if (!sharepoint || typeof sharepoint.resolveList !== "function") {
    throw new TypeError("O repositorio de acessos requer o repositorio SharePoint.");
  }

  function currentEmail() {
    return normalizeEmail(getCurrentEmail());
  }

  function assertSuperAdmin(email = currentEmail()) {
    if (!isSuperAdmin(email, config.superAdminEmail)) {
      throw new Error("Somente o superadministrador pode administrar acessos.");
    }
  }

  async function resolveAccessList() {
    return sharepoint.resolveList(ACCESS_SITE_KEY, ACCESS_LIST_ALIASES);
  }

  async function requireAccessList() {
    const list = await resolveAccessList();
    if (list?.status !== "resolved") {
      throw new Error("A lista PORTAL_ACESSOS ainda nao foi configurada.");
    }
    return list;
  }

  async function getAccessListSecurity() {
    const list = await resolveAccessList();
    if (list?.status !== "resolved") {
      return securityState("setup_required", "A lista PORTAL_ACESSOS ainda não existe. O superadministrador deve criá-la e concluir as permissões exclusivas no SharePoint.");
    }
    if (!graph || typeof graph.request !== "function") {
      return securityState("indeterminate", "Não foi possível consultar a ACL de PORTAL_ACESSOS. Conceda a permissão Microsoft Sites.Read.All e revise a configuração no SharePoint.");
    }

    try {
      const sites = await sharepoint.resolveSites();
      const site = sites?.[ACCESS_SITE_KEY];
      if (!site?.id) {
        return securityState("indeterminate", "O site corporativo não está disponível para validar a ACL de PORTAL_ACESSOS.");
      }
      const response = await graph.request(`/sites/${encodeURIComponent(site.id)}/lists/${encodeURIComponent(list.id)}/permissions`, {
        method: "GET",
        scopes: ACCESS_SECURITY_SCOPES,
      });
      return inspectPermissions(response?.value, normalizeEmail(config.superAdminEmail), currentEmail());
    } catch {
      return securityState("indeterminate", "Não foi possível comprovar a ACL de PORTAL_ACESSOS. Revise as permissões exclusivas da lista no SharePoint e tente novamente.");
    }
  }

  return Object.freeze({
    async ensureList() {
      assertSuperAdmin();
      const existing = await resolveAccessList();
      if (existing?.status === "resolved") {
        return { ...existing, security: await getAccessListSecurity() };
      }
      if (!graph || typeof graph.request !== "function") {
        throw new Error("Nao foi possivel configurar PORTAL_ACESSOS: acesso Microsoft adicional indisponivel.");
      }

      const sites = await sharepoint.resolveSites();
      const site = sites?.[ACCESS_SITE_KEY];
      if (!site?.id) {
        throw new Error("Nao foi possivel configurar PORTAL_ACESSOS: site corporativo indisponivel.");
      }

      const created = await graph.request(`/sites/${encodeURIComponent(site.id)}/lists`, {
        method: "POST",
        scopes: ["Sites.Manage.All"],
        body: {
          displayName: "PORTAL_ACESSOS",
          list: { template: "genericList" },
          columns: accessColumns(modules),
        },
      });
      sharepoint.clearCache?.();
      return {
        ...created,
        status: "created",
        security: securityState("setup_required", "A lista foi criada, mas herda permissões do site por padrão. Configure permissões exclusivas no SharePoint: leitura direta aos usuários autorizados e escrita somente ao superadministrador.") ,
      };
    },

    async getCurrentAccess(email) {
      const normalizedEmail = normalizeEmail(email);
      const sessionEmail = currentEmail();
      if (!sessionEmail || normalizedEmail !== sessionEmail) {
        return {
          ...buildDefaultAccess(sessionEmail, "", modules),
          security: securityState("identity_mismatch", "A identidade solicitada não corresponde à conta Microsoft conectada."),
        };
      }
      if (isSuperAdmin(normalizedEmail, config.superAdminEmail)) {
        return {
          ...buildSuperAdminAccess(config.superAdminEmail, "Bernardo Notini", modules),
          security: securityState("superadmin", "O superadministrador permanece funcional enquanto a ACL é configurada."),
        };
      }

      const list = await resolveAccessList();
      if (list?.status !== "resolved") {
        return { ...buildDefaultAccess(normalizedEmail, "", modules), security: await getAccessListSecurity() };
      }
      const security = await getAccessListSecurity();
      if (security.status !== "secure") {
        return { ...buildDefaultAccess(normalizedEmail, "", modules), security };
      }
      const items = await sharepoint.getItems(ACCESS_SITE_KEY, list.id, currentAccessQuery(normalizedEmail));
      const match = items
        .map(item => toAccessRecord(item, modules))
        .find(record => record.email === normalizedEmail);
      return { ...(match || buildDefaultAccess(normalizedEmail, "", modules)), security };
    },

    async listUsers() {
      assertSuperAdmin();
      const list = await resolveAccessList();
      if (list?.status !== "resolved") return [];
      const items = await sharepoint.getItems(ACCESS_SITE_KEY, list.id);
      return items
        .map(item => toAccessRecord(item, modules))
        .sort((first, second) => first.name.localeCompare(second.name, "pt-BR") || first.email.localeCompare(second.email));
    },

    async saveUserAccess(record) {
      assertSuperAdmin();
      const list = await requireAccessList();
      const email = normalizeEmail(record?.email);
      if (!email) throw new Error("Informe o e-mail corporativo do usuario.");
      const fields = toSharePointFields({ ...record, email }, modules, currentEmail(), now());
      if (record?.id) {
        const updated = await sharepoint.updateItem(ACCESS_SITE_KEY, list.id, record.id, fields);
        return toAccessRecord({ id: record.id, fields: updated?.fields || fields }, modules);
      }
      const created = await sharepoint.createItem(ACCESS_SITE_KEY, list.id, fields);
      return toAccessRecord(created || { fields }, modules);
    },

    async setUserActive(id, active) {
      assertSuperAdmin();
      if (!id) throw new Error("Selecione um usuario para alterar o status.");
      const list = await requireAccessList();
      return sharepoint.updateItem(ACCESS_SITE_KEY, list.id, id, {
        STATUS: active === true ? "ATIVO" : "INATIVO",
        DATAALTERACAO: now(),
        ALTERADOPOR: currentEmail(),
      });
    },

    getAccessListSecurity,
  });
}

export { ACCESS_LIST_ALIASES };
