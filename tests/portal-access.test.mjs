import assert from "node:assert/strict";
import test from "node:test";
import portalConfig from "../portal/config.js";
import { MODULES } from "../portal/catalog/modules.js";
import {
  ACTIONS,
  buildDefaultAccess,
  can,
  isSuperAdmin,
  permissionField,
} from "../portal/access/access-model.js";
import { createAccessRepository } from "../portal/access/access-repository.js";
import { renderAccessPage } from "../portal/ui/access-page.js";

function createSharePointFake({ resolvedList = { status: "missing" }, items = [] } = {}) {
  const calls = [];
  return {
    calls,
    async resolveList(siteKey, aliases) {
      calls.push(["resolveList", siteKey, aliases]);
      return resolvedList;
    },
    async resolveSites() {
      calls.push(["resolveSites"]);
      return { company: { id: "company-site" } };
    },
    async getItems(siteKey, listId, query) {
      calls.push(["getItems", siteKey, listId, query]);
      return items;
    },
    async createItem(siteKey, listId, fields) {
      calls.push(["createItem", siteKey, listId, fields]);
      return { id: "created", fields };
    },
    async updateItem(siteKey, listId, itemId, fields) {
      calls.push(["updateItem", siteKey, listId, itemId, fields]);
      return { id: itemId, fields };
    },
    clearCache() {
      calls.push(["clearCache"]);
    },
  };
}

function createPageRoot() {
  return {
    innerHTML: "",
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

test("o superadministrador configurado e normalizado recebe acesso total", async () => {
  const sharepoint = createSharePointFake();
  const repository = createAccessRepository({
    sharepoint,
    config: portalConfig,
    modules: MODULES,
    getCurrentEmail: () => "  BERNARDONOTINI@ENERGETICABR.COM ",
  });

  assert.equal(isSuperAdmin("  BERNARDONOTINI@ENERGETICABR.COM ", portalConfig.superAdminEmail), true);
  const access = await repository.getCurrentAccess(" BERNARDONOTINI@ENERGETICABR.COM ");

  assert.equal(access.active, true);
  assert.equal(access.email, portalConfig.superAdminEmail);
  for (const module of MODULES) {
    for (const action of ACTIONS) assert.equal(can(access, module.id, action), true);
  }
  assert.equal(sharepoint.calls.length, 0);
});

test("o modelo nega acesso inativo, ausente ou malformado", () => {
  const granted = buildDefaultAccess("ana@energeticabr.com", "Ana");
  granted.active = true;
  granted.permissions.suprimentos.view = true;

  assert.equal(can({ ...granted, active: false }, "suprimentos", "view"), false);
  assert.equal(can(granted, "financeiro", "view"), false);
  assert.equal(can(null, "suprimentos", "view"), false);
  assert.equal(can({ active: true, permissions: { suprimentos: { view: "SIM" } } }, "suprimentos", "view"), false);
  assert.equal(can(granted, "suprimentos", "apagar"), false);
});

test("o modelo concede somente a combinacao explicita de modulo e acao", () => {
  const access = buildDefaultAccess("ana@energeticabr.com", "Ana");
  access.active = true;
  access.permissions.comercial.create = true;
  access.permissions.comercial.edit = true;

  assert.equal(can(access, "comercial", "create"), true);
  assert.equal(can(access, "comercial", "edit"), true);
  assert.equal(can(access, "comercial", "approve"), false);
  assert.equal(can(access, "suprimentos", "create"), false);
  assert.equal(permissionField("rh-obras", "approve"), "MODULO_RH_OBRAS_APPROVE");
});

test("o acesso padrao nasce inativo e sem qualquer permissao", () => {
  const access = buildDefaultAccess("  ana@energeticabr.com ", "Ana");

  assert.deepEqual(
    {
      id: access.id,
      email: access.email,
      name: access.name,
      active: access.active,
      profile: access.profile,
      changedAt: access.changedAt,
      changedBy: access.changedBy,
    },
    {
      id: undefined,
      email: "ana@energeticabr.com",
      name: "Ana",
      active: false,
      profile: "USUARIO",
      changedAt: undefined,
      changedBy: "",
    },
  );
  for (const moduleId of Object.keys(access.permissions)) {
    for (const action of ACTIONS) assert.equal(access.permissions[moduleId][action], false);
  }
});

test("um usuario sem registro e negado quando a lista ainda nao foi configurada", async () => {
  const repository = createAccessRepository({
    sharepoint: createSharePointFake(),
    config: portalConfig,
    modules: MODULES,
    getCurrentEmail: () => "ana@energeticabr.com",
  });

  const access = await repository.getCurrentAccess("ana@energeticabr.com");

  assert.equal(access.active, false);
  assert.equal(can(access, "dashboard", "view"), false);
});

test("a consulta do acesso atual limita a leitura ao e-mail da conta conectada", async () => {
  const sharepoint = createSharePointFake({ resolvedList: { status: "resolved", id: "access-list" } });
  const repository = createAccessRepository({
    sharepoint,
    config: portalConfig,
    modules: MODULES,
    getCurrentEmail: () => "ana@energeticabr.com",
  });

  await repository.getCurrentAccess("ana@energeticabr.com");

  const getItemsCall = sharepoint.calls.find(([operation]) => operation === "getItems");
  assert.equal(getItemsCall[3], "$expand=fields&$filter=fields/EMAIL eq 'ana@energeticabr.com'");
});

test("somente o superadministrador pode criar a lista de acesso e o escopo de gerencia e pedido apenas nessa criacao", async () => {
  const sharepoint = createSharePointFake();
  const graphCalls = [];
  const graph = {
    async request(path, options) {
      graphCalls.push([path, options]);
      return { id: "portal-access-list", displayName: "PORTAL_ACESSOS" };
    },
  };
  const repository = createAccessRepository({
    sharepoint,
    graph,
    config: portalConfig,
    modules: MODULES,
    getCurrentEmail: () => portalConfig.superAdminEmail,
  });

  await assert.rejects(repository.ensureList("ana@energeticabr.com"), /superadministrador/i);
  assert.equal(graphCalls.length, 0);

  const result = await repository.ensureList(portalConfig.superAdminEmail);
  assert.equal(result.status, "created");
  assert.equal(graphCalls.length, 1);
  assert.equal(graphCalls[0][0], "/sites/company-site/lists");
  assert.deepEqual(graphCalls[0][1].scopes, ["Sites.Manage.All"]);
  assert.equal(graphCalls[0][1].body.displayName, "PORTAL_ACESSOS");
  assert.equal(graphCalls[0][1].body.columns.some(column => column.name === "EMAIL"), true);
  assert.equal(graphCalls[0][1].body.columns.some(column => column.name === "MODULO_SUPRIMENTOS_VIEW"), true);
});

test("o repositorio le, grava e inativa usuarios pelos campos do SharePoint", async () => {
  const sharepoint = createSharePointFake({
    resolvedList: { status: "resolved", id: "access-list" },
    items: [{
      id: "12",
      fields: {
        EMAIL: "ANA@ENERGETICABR.COM",
        NOME: "ANA",
        STATUS: "ATIVO",
        PERFIL: "OPERACAO",
        DATAALTERACAO: "2026-08-26T12:00:00Z",
        ALTERADOPOR: "bernardonotini@energeticabr.com",
        MODULO_SUPRIMENTOS_VIEW: "SIM",
      },
    }],
  });
  const repository = createAccessRepository({
    sharepoint,
    config: portalConfig,
    modules: MODULES,
    getCurrentEmail: () => portalConfig.superAdminEmail,
    now: () => "2026-08-26T15:00:00.000Z",
  });

  const [user] = await repository.listUsers();
  assert.equal(user.email, "ana@energeticabr.com");
  assert.equal(user.active, true);
  assert.equal(can(user, "suprimentos", "view"), true);
  assert.equal(can(user, "suprimentos", "edit"), false);

  user.permissions.suprimentos.edit = true;
  await repository.saveUserAccess(user);
  await repository.setUserActive("12", false);

  const updateCalls = sharepoint.calls.filter(([operation]) => operation === "updateItem");
  assert.deepEqual(updateCalls[0].slice(1, 3), ["company", "access-list"]);
  assert.equal(updateCalls[0][4].EMAIL, "ANA@ENERGETICABR.COM");
  assert.equal(updateCalls[0][4].MODULO_SUPRIMENTOS_EDIT, "SIM");
  assert.equal(updateCalls[0][4].DATAALTERACAO, "2026-08-26T15:00:00.000Z");
  assert.deepEqual(updateCalls[1][4], {
    STATUS: "INATIVO",
    DATAALTERACAO: "2026-08-26T15:00:00.000Z",
    ALTERADOPOR: portalConfig.superAdminEmail,
  });
});

test("a pagina de acessos mantem o formulario fechado ate selecionar ou adicionar um usuario", () => {
  const root = createPageRoot();
  renderAccessPage(root, {
    modules: MODULES,
    actorEmail: portalConfig.superAdminEmail,
    repository: {
      async listUsers() {
        return [];
      },
      async ensureList() {},
    },
  });

  assert.match(root.innerHTML, /data-access-add/);
  assert.match(root.innerHTML, /Selecione um usuário/);
  assert.match(root.innerHTML, /data-access-setup/);
  assert.doesNotMatch(root.innerHTML, /data-access-name/);
});
