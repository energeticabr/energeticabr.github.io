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
import { createAccessPage, renderAccessPage } from "../portal/ui/access-page.js";

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

function createGraphFake(permissions = []) {
  const calls = [];
  return {
    calls,
    async request(path, options = {}) {
      calls.push([path, options]);
      return { value: permissions };
    },
  };
}

function directPermission(role, email, inheritedFrom = null) {
  return {
    inheritedFrom,
    roles: [role],
    grantedToIdentitiesV2: [{ user: { email } }],
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

test("getCurrentAccess nao permite que uma conta comum se passe pelo superadministrador por argumento", async () => {
  const repository = createAccessRepository({
    sharepoint: createSharePointFake(),
    config: portalConfig,
    modules: MODULES,
    getCurrentEmail: () => "ana@energeticabr.com",
  });

  const access = await repository.getCurrentAccess(portalConfig.superAdminEmail);

  assert.equal(access.active, false);
  assert.equal(access.security.status, "identity_mismatch");
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
    graph: createGraphFake([
      directPermission("write", portalConfig.superAdminEmail),
      directPermission("read", "ana@energeticabr.com"),
    ]),
    config: portalConfig,
    modules: MODULES,
    getCurrentEmail: () => "ana@energeticabr.com",
  });

  await repository.getCurrentAccess("ana@energeticabr.com");

  const getItemsCall = sharepoint.calls.find(([operation]) => operation === "getItems");
  assert.equal(getItemsCall[3], "$expand=fields&$filter=fields/EMAIL eq 'ana@energeticabr.com'");
});

test("somente a sessao real do superadministrador pode criar a lista de acesso e o escopo de gerencia e pedido apenas nessa criacao", async () => {
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

  const nonAdminRepository = createAccessRepository({
    sharepoint: createSharePointFake(),
    graph,
    config: portalConfig,
    modules: MODULES,
    getCurrentEmail: () => "ana@energeticabr.com",
  });
  await assert.rejects(nonAdminRepository.ensureList(portalConfig.superAdminEmail), /superadministrador/i);
  assert.equal(graphCalls.length, 0, "um argumento forjado nao pode elevar a identidade da sessao");

  const result = await repository.ensureList();
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
      lastModifiedDateTime: "2026-08-26T14:00:00Z",
      lastModifiedBy: { user: { email: "auditoria@energeticabr.com", displayName: "Auditoria" } },
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
  assert.equal(user.changedAt, "2026-08-26T14:00:00Z");
  assert.equal(user.changedBy, "auditoria@energeticabr.com");

  user.permissions.suprimentos.edit = true;
  await repository.saveUserAccess(user);
  await repository.setUserActive("12", false);

  const updateCalls = sharepoint.calls.filter(([operation]) => operation === "updateItem");
  assert.deepEqual(updateCalls[0].slice(1, 3), ["company", "access-list"]);
  assert.equal(updateCalls[0][4].EMAIL, "ANA@ENERGETICABR.COM");
  assert.equal(updateCalls[0][4].Title, "ANA@ENERGETICABR.COM");
  assert.equal(updateCalls[0][4].MODULO_SUPRIMENTOS_EDIT, "SIM");
  assert.equal(updateCalls[0][4].DATAALTERACAO, "2026-08-26T15:00:00.000Z");
  assert.deepEqual(updateCalls[1][4], {
    STATUS: "INATIVO",
    DATAALTERACAO: "2026-08-26T15:00:00.000Z",
    ALTERADOPOR: portalConfig.superAdminEmail,
  });
});

test("a criacao de usuario inclui o Title obrigatorio da genericList", async () => {
  const sharepoint = createSharePointFake({ resolvedList: { status: "resolved", id: "access-list" } });
  const repository = createAccessRepository({
    sharepoint,
    config: portalConfig,
    modules: MODULES,
    getCurrentEmail: () => portalConfig.superAdminEmail,
    now: () => "2026-08-26T15:00:00.000Z",
  });
  const user = buildDefaultAccess("novo@energeticabr.com", "Novo Usuario");

  await repository.saveUserAccess(user);

  const createCall = sharepoint.calls.find(([operation]) => operation === "createItem");
  assert.equal(createCall[3].Title, "NOVO@ENERGETICABR.COM");
});

test("um usuario comum recebe acesso somente quando a ACL da lista e comprovadamente exclusiva e legivel para ele", async () => {
  const sharepoint = createSharePointFake({
    resolvedList: { status: "resolved", id: "access-list" },
    items: [{
      id: "12",
      fields: { EMAIL: "ANA@ENERGETICABR.COM", STATUS: "ATIVO", MODULO_SUPRIMENTOS_VIEW: "SIM" },
    }],
  });
  const graph = createGraphFake([
    directPermission("write", portalConfig.superAdminEmail),
    directPermission("read", "ana@energeticabr.com"),
  ]);
  const repository = createAccessRepository({
    sharepoint,
    graph,
    config: portalConfig,
    modules: MODULES,
    getCurrentEmail: () => "ana@energeticabr.com",
  });

  const access = await repository.getCurrentAccess("ana@energeticabr.com");

  assert.equal(can(access, "suprimentos", "view"), true);
  assert.equal(access.security.status, "secure");
  assert.deepEqual(graph.calls[0], [
    "/sites/company-site/lists/access-list/permissions",
    { method: "GET", scopes: ["Sites.Read.All"] },
  ]);
});

test("ACL herdada com escrita ampla e ACL sem identidade comprovavel negam usuarios comuns", async () => {
  for (const permissions of [
    [directPermission("write", portalConfig.superAdminEmail, { id: "company-site" })],
    [{ inheritedFrom: null, roles: ["write"], grantedToIdentitiesV2: [{}] }],
  ]) {
    const repository = createAccessRepository({
      sharepoint: createSharePointFake({ resolvedList: { status: "resolved", id: "access-list" } }),
      graph: createGraphFake(permissions),
      config: portalConfig,
      modules: MODULES,
      getCurrentEmail: () => "ana@energeticabr.com",
    });

    const access = await repository.getCurrentAccess("ana@energeticabr.com");
    assert.equal(access.active, false);
    assert.ok(["insecure", "indeterminate"].includes(access.security.status));
    assert.match(access.security.instructions, /PORTAL_ACESSOS/i);
  }
});

test("uma ACL com grupo ou outra identidade nao verificavel junto ao superadministrador permanece indeterminada", async () => {
  const repository = createAccessRepository({
    sharepoint: createSharePointFake({ resolvedList: { status: "resolved", id: "access-list" } }),
    graph: createGraphFake([{
      inheritedFrom: null,
      roles: ["write"],
      grantedToIdentitiesV2: [
        { user: { email: portalConfig.superAdminEmail } },
        { group: { id: "grupo-amplo", displayName: "Colaboradores" } },
      ],
    }]),
    config: portalConfig,
    modules: MODULES,
    getCurrentEmail: () => "ana@energeticabr.com",
  });

  const access = await repository.getCurrentAccess("ana@energeticabr.com");

  assert.equal(access.active, false);
  assert.equal(access.security.status, "indeterminate");
});

test("a pagina de acessos mantem o formulario fechado ate selecionar ou adicionar um usuario", () => {
  const root = createPageRoot();
  renderAccessPage(root, {
    modules: MODULES,
    actorEmail: portalConfig.superAdminEmail,
    config: portalConfig,
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

test("a pagina de acessos nao renderiza controles administrativos para uma conta nao-superadministradora", () => {
  const root = createPageRoot();
  createAccessPage(root, {
    modules: MODULES,
    actorEmail: "ana@energeticabr.com",
    config: portalConfig,
    repository: {
      async listUsers() {
        throw new Error("nao deve consultar usuarios");
      },
    },
  });

  assert.match(root.innerHTML, /Acesso restrito/);
  assert.doesNotMatch(root.innerHTML, /data-access-add/);
  assert.doesNotMatch(root.innerHTML, /data-access-save/);
  assert.doesNotMatch(root.innerHTML, /data-access-setup/);
});
