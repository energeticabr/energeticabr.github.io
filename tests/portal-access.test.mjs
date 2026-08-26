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
import { accessEditorMarkup, createAccessPage, renderAccessPage, securityPlanMarkup } from "../portal/ui/access-page.js";

function restPermission(role, email, principalType = 1) {
  const write = role !== "read";
  return {
    Member: { PrincipalType: principalType, Email: email },
    RoleDefinitionBindings: [{ Name: write ? "Full Control" : "Read", RoleTypeKind: write ? 5 : 2 }],
  };
}

function secureAcl() {
  return {
    HasUniqueRoleAssignments: true,
    RoleAssignments: [restPermission("write", portalConfig.superAdminEmail), restPermission("read", "ana@energeticabr.com")],
  };
}

function secureEffectivePermissions() {
  return { HasUniqueRoleAssignments: true, EffectiveBasePermissions: { High: "48", Low: "134418529" } };
}

function createSharePointFake({ resolvedList = { status: "missing" }, items = [], security = secureAcl(), effectiveSecurity = secureEffectivePermissions() } = {}) {
  const calls = [];
  const currentItems = items.map(item => ({ ...item, fields: { ...(item.fields || {}) } }));
  let authorizationProvider;
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
      return currentItems;
    },
    async getListSecurity(siteKey, listId) {
      calls.push(["getListSecurity", siteKey, listId]);
      return security;
    },
    async getListAdministrativeSecurity(siteKey, listId) {
      calls.push(["getListAdministrativeSecurity", siteKey, listId]);
      return security;
    },
    async getListEffectivePermissions(siteKey, listId) {
      calls.push(["getListEffectivePermissions", siteKey, listId]);
      return effectiveSecurity;
    },
    async createItem(siteKey, listId, fields) {
      calls.push(["createItem", siteKey, listId, fields]);
      return { id: "created", fields };
    },
    async updateItem(siteKey, listId, itemId, fields, options) {
      calls.push(["updateItem", siteKey, listId, itemId, fields, options]);
      const existing = currentItems.find(item => String(item.id) === String(itemId));
      const updated = { ...(existing || {}), id: itemId, eTag: '"updated,2"', fields: { ...(existing?.fields || {}), ...fields } };
      if (existing) currentItems.splice(currentItems.indexOf(existing), 1, updated);
      return updated;
    },
    clearCache() {
      calls.push(["clearCache"]);
    },
    setAuthorizationProvider(provider) {
      authorizationProvider = provider;
      calls.push(["setAuthorizationProvider"]);
    },
    async invokeAuthorization(request) {
      return authorizationProvider.authorize(request);
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
  assert.deepEqual(sharepoint.calls, [["setAuthorizationProvider"]]);
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

test("a consulta comum nao le registros enquanto a exclusividade global nao foi comprovada", async () => {
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

  const itemQueries = sharepoint.calls.filter(([operation]) => operation === "getItems").map(([, , , query]) => query);
  assert.equal(itemQueries.length, 1);
  assert.match(itemQueries[0], /__PORTAL_SECURITY_V1__/);
  assert.equal(itemQueries.some(query => String(query).includes("MICROSOFT_OID")), false);
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

test("ensureList atualiza uma PORTAL_ACESSOS antiga com todas as colunas de um modulo novo", async () => {
  const sharepoint = createSharePointFake({ resolvedList: { status: "resolved", id: "access-list" } });
  sharepoint.resolveSites = async () => ({ company: { id: "company-site" } });
  const columns = [
    { id: "email", name: "EMAIL", indexed: true, enforceUniqueValues: true },
    { id: "oid", name: "MICROSOFT_OID", indexed: true, enforceUniqueValues: true },
    { id: "nome", name: "NOME" },
    { id: "status", name: "STATUS" },
    { id: "perfil", name: "PERFIL" },
    { id: "data", name: "DATAALTERACAO" },
    { id: "autor", name: "ALTERADOPOR" },
    ...ACTIONS.map(action => ({ id: `suprimentos-${action}`, name: permissionField("suprimentos", action) })),
  ];
  sharepoint.getColumns = async () => columns;
  const graphCalls = [];
  const graph = {
    async request(path, options) {
      graphCalls.push([path, options]);
      if (options?.method === "POST" && path.endsWith("/columns")) {
        columns.push({ id: options.body.name.toLowerCase(), name: options.body.name });
      }
      return {};
    },
  };
  const repository = createAccessRepository({
    sharepoint,
    graph,
    config: portalConfig,
    modules: [{ id: "suprimentos", title: "Suprimentos" }, { id: "relatorios", title: "Relatórios" }],
    entities: [],
    getCurrentEmail: () => portalConfig.superAdminEmail,
  });

  await repository.ensureList();
  await repository.ensureList();

  const createdPermissionColumns = graphCalls
    .filter(([path, options]) => path.endsWith("/columns") && options?.method === "POST")
    .map(([, options]) => options.body.name)
    .sort();
  assert.deepEqual(createdPermissionColumns, ACTIONS.map(action => permissionField("relatorios", action)).sort());
});

test("o repositorio le, grava e inativa usuarios pelos campos do SharePoint", async () => {
  const sharepoint = createSharePointFake({
    resolvedList: { status: "resolved", id: "access-list" },
    items: [{
      id: "12",
      eTag: '"12,1"',
      lastModifiedDateTime: "2026-08-26T14:00:00Z",
      lastModifiedBy: { user: { email: "auditoria@energeticabr.com", displayName: "Auditoria" } },
      fields: {
        EMAIL: "ANA@ENERGETICABR.COM",
        MICROSOFT_OID: "11111111-2222-4333-8444-555555555555",
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
    aclService: {
      async reconcileUserAccess() { return { status: "verified" }; },
      async denyUser() { return { status: "verified" }; },
    },
  });

  const [user] = await repository.listUsers();
  assert.equal(user.email, "ana@energeticabr.com");
  assert.equal(user.active, true);
  assert.equal(can(user, "suprimentos", "view"), true);
  assert.equal(can(user, "suprimentos", "edit"), false);
  assert.equal(user.changedAt, "2026-08-26T14:00:00Z");
  assert.equal(user.changedBy, "auditoria@energeticabr.com");

  user.permissions.suprimentos.edit = true;
  const savedUser = await repository.saveUserAccess(user);
  await repository.setUserActive(savedUser, false);

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
  assert.deepEqual(updateCalls[0][5], { eTag: '"12,1"' });
  assert.deepEqual(updateCalls[1][5], { eTag: '"updated,2"' });
});

test("a criacao de usuario inclui o Title obrigatorio da genericList", async () => {
  const sharepoint = createSharePointFake({ resolvedList: { status: "resolved", id: "access-list" } });
  const repository = createAccessRepository({
    sharepoint,
    graph: { async request() { return { value: [{ id: "11111111-2222-4333-8444-555555555555", displayName: "Novo Usuario", mail: "novo@energeticabr.com", userPrincipalName: "novo@energeticabr.com" }] }; } },
    config: portalConfig,
    modules: MODULES,
    getCurrentEmail: () => portalConfig.superAdminEmail,
    now: () => "2026-08-26T15:00:00.000Z",
    aclService: {
      async reconcileUserAccess() { return { status: "verified" }; },
      async denyUser() { return { status: "verified" }; },
    },
  });
  const user = buildDefaultAccess("novo@energeticabr.com", "Novo Usuario");

  await repository.saveUserAccess(user);

  const createCall = sharepoint.calls.find(([operation]) => operation === "createItem");
  assert.equal(createCall[3].Title, "NOVO@ENERGETICABR.COM");
});

test("um usuario comum permanece bloqueado ate a exclusividade global da ACL ser comprovada", async () => {
  const sharepoint = createSharePointFake({
    resolvedList: { status: "resolved", id: "access-list" },
    items: [{
      id: "12",
      fields: { EMAIL: "ANA@ENERGETICABR.COM", MICROSOFT_OID: "11111111-2222-4333-8444-555555555555", STATUS: "ATIVO", MODULO_SUPRIMENTOS_VIEW: "SIM" },
    }],
  });
  const repository = createAccessRepository({
    sharepoint,
    config: portalConfig,
    modules: MODULES,
    getCurrentIdentity: () => ({ oid: "11111111-2222-4333-8444-555555555555", email: "ana@energeticabr.com" }),
  });

  const access = await repository.getCurrentAccess("ana@energeticabr.com");

  assert.equal(can(access, "suprimentos", "view"), false);
  assert.equal(access.security.status, "indeterminate");
  assert.equal(sharepoint.calls.some(([operation]) => operation === "getListEffectivePermissions"), true);
});

test("um usuario comum e liberado somente apos manifesto verificado e continua sujeito a ACL por lista", async () => {
  const sharepoint = createSharePointFake({
    resolvedList: { status: "resolved", id: "access-list" },
    effectiveSecurity: { HasUniqueRoleAssignments: true, EffectiveBasePermissions: { High: "0", Low: "1" } },
    items: [{
      id: "12",
      fields: {
        EMAIL: "ANA@ENERGETICABR.COM",
        MICROSOFT_OID: "11111111-2222-4333-8444-555555555555",
        STATUS: "ATIVO",
        MODULO_SUPRIMENTOS_VIEW: "SIM",
      },
    }, {
      id: "99",
      fields: {
        Title: "__PORTAL_SECURITY_V1__",
        STATUS: "ATIVO",
        PERFIL: "SECURITY_MANIFEST",
        NOME: "a1b2c3d4",
        ALTERADOPOR: portalConfig.superAdminEmail,
      },
    }],
  });
  const repository = createAccessRepository({
    sharepoint,
    config: portalConfig,
    modules: [{ id: "suprimentos", title: "Suprimentos" }],
    entities: [],
    getCurrentIdentity: () => ({ oid: "11111111-2222-4333-8444-555555555555", email: "ana@energeticabr.com" }),
  });

  const access = await repository.getCurrentAccess({ oid: "11111111-2222-4333-8444-555555555555", email: "ana@energeticabr.com" });

  assert.equal(access.active, true);
  assert.equal(access.security.status, "secure");
  assert.equal(can(access, "suprimentos", "view"), true);
});

test("ACL herdada com escrita ampla e ACL sem identidade comprovavel negam usuarios comuns", async () => {
  for (const effectiveSecurity of [
    { HasUniqueRoleAssignments: false, EffectiveBasePermissions: { High: "48", Low: "134418529" } },
    { HasUniqueRoleAssignments: true, EffectiveBasePermissions: { High: "0", Low: "3" } },
    { HasUniqueRoleAssignments: true, EffectiveBasePermissions: { High: "INVALIDO", Low: "1" } },
  ]) {
    const repository = createAccessRepository({
      sharepoint: createSharePointFake({ resolvedList: { status: "resolved", id: "access-list" }, effectiveSecurity }),
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
    sharepoint: createSharePointFake({
      resolvedList: { status: "resolved", id: "access-list" },
      security: { HasUniqueRoleAssignments: true, RoleAssignments: [restPermission("write", portalConfig.superAdminEmail), restPermission("read", "", 4)] },
    }),
    config: portalConfig,
    modules: MODULES,
    getCurrentEmail: () => portalConfig.superAdminEmail,
  });

  const security = await repository.getAccessListSecurity();

  assert.equal(security.status, "indeterminate");
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

test("a interface exige confirmacao visivel para migrar identidade legada", () => {
  const legacy = buildDefaultAccess("ana@energeticabr.com", "Ana", MODULES);
  legacy.id = "12";
  const legacyMarkup = accessEditorMarkup(legacy, MODULES);
  assert.match(legacyMarkup, /data-access-migrate-identity/);
  assert.match(legacyMarkup, /Vincular explicitamente/i);

  legacy.oid = "11111111-2222-4333-8444-555555555555";
  assert.doesNotMatch(accessEditorMarkup(legacy, MODULES), /data-access-migrate-identity/);
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

test("a pre-visualizacao de seguranca mostra impacto e exige aplicacao separada", () => {
  const markup = securityPlanMarkup({
    planHash: "a1b2c3d4",
    lists: [{ displayName: "FORNECEDORES" }, { displayName: "PORTAL_ACESSOS" }],
    groups: [{ name: "ENERGETICA_PORTAL_SUPRIMENTOS_VIEW" }],
    missing: [],
  });

  assert.match(markup, /2 listas/);
  assert.match(markup, /1 grupo/);
  assert.match(markup, /a1b2c3d4/);
  assert.match(markup, /data-access-security-confirmation/);
  assert.match(markup, /data-access-security-apply/);
  assert.doesNotMatch(securityPlanMarkup(null), /data-access-security-apply/);
});

test("o repositorio de acessos instala a autoridade efetiva no repositorio usado pela interface", async () => {
  const targetList = "22222222-2222-2222-2222-222222222222";
  const accessList = "11111111-1111-1111-1111-111111111111";
  const sharepoint = createSharePointFake({
    resolvedList: { status: "resolved", id: accessList },
    items: [{
      id: "12",
      fields: {
        EMAIL: "ANA@ENERGETICABR.COM",
        MICROSOFT_OID: "11111111-2222-4333-8444-555555555555",
        STATUS: "ATIVO",
        MODULO_SUPRIMENTOS_VIEW: "SIM",
        MODULO_SUPRIMENTOS_EDIT: "SIM",
      },
    }],
    effectiveSecurity: { HasUniqueRoleAssignments: true, EffectiveBasePermissions: { High: "0", Low: "5" } },
  });
  sharepoint.resolveList = async (_siteKey, aliases) => {
    const accessAliases = Array.isArray(aliases) && aliases.some(alias => String(alias).includes("PORTAL"));
    return { status: "resolved", id: accessAliases ? accessList : targetList };
  };
  sharepoint.getListEffectivePermissions = async (_siteKey, listId) => ({
    HasUniqueRoleAssignments: true,
    EffectiveBasePermissions: listId === accessList
      ? { High: "0", Low: "1" }
      : { High: "0", Low: "5" },
  });
  createAccessRepository({
    sharepoint,
    config: portalConfig,
    modules: [{ id: "suprimentos", title: "Suprimentos" }],
    entities: [{ id: "fornecedores", moduleId: "suprimentos", siteKey: "company", listNames: ["FORNECEDORES"] }],
    getCurrentIdentity: () => ({
      oid: "11111111-2222-4333-8444-555555555555",
      email: "ana@energeticabr.com",
    }),
  });

  const result = await sharepoint.invokeAuthorization({
    siteKey: "company",
    listId: targetList,
    action: "edit",
  });

  assert.equal(result.allowed, true);
  assert.equal(result.moduleId, "suprimentos");
});

test("salvar acesso ativo sincroniza os grupos SharePoint e verifica o resultado", async () => {
  const sharepoint = createSharePointFake({
    resolvedList: { status: "resolved", id: "access-list" },
    items: [{
      id: "12",
      eTag: '"12,1"',
      fields: {
        EMAIL: "ANA@ENERGETICABR.COM",
        MICROSOFT_OID: "11111111-2222-4333-8444-555555555555",
        NOME: "ANA",
        STATUS: "ATIVO",
        MODULO_SUPRIMENTOS_VIEW: "SIM",
      },
    }],
  });
  const reconciled = [];
  const repository = createAccessRepository({
    sharepoint,
    config: portalConfig,
    modules: [{ id: "suprimentos", title: "Suprimentos" }],
    entities: [],
    getCurrentEmail: () => portalConfig.superAdminEmail,
    aclService: {
      async reconcileUserAccess(access) { reconciled.push(access); return { status: "verified" }; },
      async denyUser() {},
    },
  });
  const [access] = await repository.listUsers();

  await repository.saveUserAccess(access);

  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].active, true);
  assert.equal(reconciled[0].email, "ana@energeticabr.com");
});

test("salvar acesso inativo tambem reconcilia para remover grupos residuais", async () => {
  const sharepoint = createSharePointFake({
    resolvedList: { status: "resolved", id: "access-list" },
    items: [{
      id: "12",
      eTag: '"12,1"',
      fields: {
        EMAIL: "ANA@ENERGETICABR.COM",
        MICROSOFT_OID: "11111111-2222-4333-8444-555555555555",
        STATUS: "INATIVO",
      },
    }],
  });
  const reconciled = [];
  const repository = createAccessRepository({
    sharepoint,
    config: portalConfig,
    modules: [{ id: "suprimentos", title: "Suprimentos" }],
    entities: [],
    getCurrentEmail: () => portalConfig.superAdminEmail,
    aclService: {
      async reconcileUserAccess(access) { reconciled.push(access); return { status: "verified" }; },
      async denyUser() {},
    },
  });
  const [access] = await repository.listUsers();

  await repository.saveUserAccess(access);

  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].active, false);
});

test("falha parcial na reconciliacao inativa o cadastro e informa a acao corretiva", async () => {
  const sharepoint = createSharePointFake({
    resolvedList: { status: "resolved", id: "access-list" },
    items: [{
      id: "12",
      eTag: '"12,1"',
      fields: {
        EMAIL: "ANA@ENERGETICABR.COM",
        MICROSOFT_OID: "11111111-2222-4333-8444-555555555555",
        STATUS: "ATIVO",
        MODULO_SUPRIMENTOS_VIEW: "SIM",
      },
    }],
  });
  let denied = false;
  const repository = createAccessRepository({
    sharepoint,
    config: portalConfig,
    modules: [{ id: "suprimentos", title: "Suprimentos" }],
    entities: [],
    getCurrentEmail: () => portalConfig.superAdminEmail,
    aclService: {
      async reconcileUserAccess() { throw new Error("grupo indisponivel"); },
      async denyUser() { denied = true; },
    },
  });
  const [access] = await repository.listUsers();

  await assert.rejects(repository.saveUserAccess(access), error => {
    assert.equal(error.code, "access_reconciliation_required");
    assert.match(error.message, /inativo/i);
    return true;
  });

  assert.equal(denied, true);
  const statusUpdates = sharepoint.calls.filter(([name, , , , fields]) => name === "updateItem" && fields?.STATUS === "INATIVO");
  assert.equal(statusUpdates.length, 1);
});

test("repositorio com autoridade mas sem transporte completo de ACL falha fechado", async () => {
  const sharepoint = createSharePointFake({
    resolvedList: { status: "resolved", id: "access-list" },
    items: [{
      id: "12",
      eTag: '"12,1"',
      fields: {
        EMAIL: "ANA@ENERGETICABR.COM",
        MICROSOFT_OID: "11111111-2222-4333-8444-555555555555",
        STATUS: "ATIVO",
        MODULO_SUPRIMENTOS_VIEW: "SIM",
      },
    }],
  });
  const repository = createAccessRepository({
    sharepoint,
    config: portalConfig,
    modules: [{ id: "suprimentos", title: "Suprimentos" }],
    entities: [],
    getCurrentEmail: () => portalConfig.superAdminEmail,
  });
  const [access] = await repository.listUsers();

  await assert.rejects(repository.saveUserAccess(access), error => {
    assert.equal(error.code, "access_reconciliation_required");
    return true;
  });

  const statusUpdates = sharepoint.calls.filter(([name, , , , fields]) => name === "updateItem" && fields?.STATUS === "INATIVO");
  assert.equal(statusUpdates.length, 1);
});

test("somente uma aplicacao verificada grava o manifesto que abre o portal comum", async () => {
  const sharepoint = createSharePointFake({ resolvedList: { status: "resolved", id: "access-list" } });
  const repository = createAccessRepository({
    sharepoint,
    config: portalConfig,
    modules: [{ id: "suprimentos", title: "Suprimentos" }],
    entities: [],
    getCurrentEmail: () => portalConfig.superAdminEmail,
    aclService: {
      async applySecuritySetup() { return { status: "verified", planHash: "a1b2c3d4" }; },
      async verifySecuritySetup() { return { verified: true, planHash: "a1b2c3d4" }; },
    },
  });

  await repository.applySecuritySetup({ planHash: "a1b2c3d4", confirmation: "APLICAR SEGURANCA SHAREPOINT" });

  const manifest = sharepoint.calls.find(([name, , , fields]) => name === "createItem" && fields?.Title === "__PORTAL_SECURITY_V1__");
  assert.ok(manifest);
  assert.equal(manifest[3].PERFIL, "SECURITY_MANIFEST");
  assert.equal(manifest[3].ALTERADOPOR, portalConfig.superAdminEmail);
});
