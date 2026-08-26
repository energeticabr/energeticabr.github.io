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
  access.changedAt = fieldValue(fields, "DATAALTERACAO") || undefined;
  access.changedBy = String(fieldValue(fields, "ALTERADOPOR") || "").trim();

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

  return Object.freeze({
    async ensureList(email = currentEmail()) {
      assertSuperAdmin(email);
      const existing = await resolveAccessList();
      if (existing?.status === "resolved") return existing;
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
      return { ...created, status: "created" };
    },

    async getCurrentAccess(email) {
      const normalizedEmail = normalizeEmail(email);
      if (isSuperAdmin(normalizedEmail, config.superAdminEmail)) {
        return buildSuperAdminAccess(config.superAdminEmail, "Bernardo Notini", modules);
      }

      const list = await resolveAccessList();
      if (list?.status !== "resolved") return buildDefaultAccess(normalizedEmail, "", modules);
      const items = await sharepoint.getItems(ACCESS_SITE_KEY, list.id, currentAccessQuery(normalizedEmail));
      const match = items
        .map(item => toAccessRecord(item, modules))
        .find(record => record.email === normalizedEmail);
      return match || buildDefaultAccess(normalizedEmail, "", modules);
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
  });
}

export { ACCESS_LIST_ALIASES };
