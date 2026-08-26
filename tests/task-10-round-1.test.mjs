import assert from "node:assert/strict";
import test from "node:test";
import portalConfig from "../portal/config.js";
import { can } from "../portal/access/access-model.js";
import {
  AccessIdentityResolutionError,
  createAccessRepository,
} from "../portal/access/access-repository.js";
import { createSharePointRestTransport } from "../portal/data/attachments.js";
import { createSharePointRepository } from "../portal/data/sharepoint-repository.js";

const site = portalConfig.sharepointSites.company;
const listId = "12345678-1234-1234-1234-123456789abc";
const userOid = "11111111-2222-4333-8444-555555555555";

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 403 ? "Forbidden" : "",
    async json() { return payload; },
  };
}

function permissionMask(...permissionKinds) {
  let mask = 0n;
  for (const kind of permissionKinds) mask |= 1n << BigInt(kind - 1);
  return {
    High: String(mask >> 32n),
    Low: String(mask & 0xffffffffn),
  };
}

function commonReadPermissions() {
  return permissionMask(1, 6, 7, 13, 17, 18, 28, 37, 38);
}

function role(email, kind, name) {
  return {
    Member: { PrincipalType: 1, Email: email },
    RoleDefinitionBindings: [{ RoleTypeKind: kind, Name: name }],
  };
}

test("C1 usuario comum permanece bloqueado quando EffectiveBasePermissions nao comprova exclusividade global", async () => {
  const calls = [];
  const sharepoint = {
    async resolveList() { return { status: "resolved", id: listId }; },
    async getListEffectivePermissions(siteKey, id) {
      calls.push(["effective", siteKey, id]);
      return { HasUniqueRoleAssignments: true, EffectiveBasePermissions: commonReadPermissions() };
    },
    async getListAdministrativeSecurity() {
      calls.push(["roles"]);
      const error = new Error("Forbidden");
      error.status = 403;
      throw error;
    },
    async getItems(_siteKey, _id, query) {
      calls.push(["items", query]);
      return [{ id: "8", eTag: '"8,1"', fields: { EMAIL: "ANA@ENERGETICABR.COM", MICROSOFT_OID: userOid, STATUS: "ATIVO", MODULO_SUPRIMENTOS_VIEW: "SIM" } }];
    },
  };
  const repository = createAccessRepository({ sharepoint, getCurrentIdentity: () => ({ oid: userOid, email: "ana@energeticabr.com" }) });

  const access = await repository.getCurrentAccess({ oid: userOid, email: "ana@energeticabr.com" });

  assert.equal(access.security.status, "indeterminate");
  assert.equal(can(access, "suprimentos", "view"), false);
  const itemQueries = calls.filter(([operation]) => operation === "items").map(([, query]) => query);
  assert.equal(itemQueries.length, 1, "somente o manifesto de seguranca pode ser consultado antes da liberacao");
  assert.match(itemQueries[0], /__PORTAL_SECURITY_V2__/);
  assert.equal(calls.some(([operation]) => operation === "roles"), false);
});

test("C1 permissoes efetivas com escrita ou formato incerto falham fechadas", async () => {
  for (const effective of [
    { HasUniqueRoleAssignments: true, EffectiveBasePermissions: permissionMask(1, 2) },
    { HasUniqueRoleAssignments: true, EffectiveBasePermissions: { High: "x", Low: "1" } },
    { HasUniqueRoleAssignments: false, EffectiveBasePermissions: commonReadPermissions() },
  ]) {
    const sharepoint = {
      async resolveList() { return { status: "resolved", id: listId }; },
      async getListEffectivePermissions() { return effective; },
      async getItems() { throw new Error("Nao deve ler cadastro sem seguranca comprovada"); },
    };
    const repository = createAccessRepository({ sharepoint, getCurrentIdentity: () => ({ oid: userOid, email: "ana@energeticabr.com" }) });
    const access = await repository.getCurrentAccess({ oid: userOid, email: "ana@energeticabr.com" });
    assert.equal(access.active, false);
    assert.notEqual(access.security.status, "secure");
  }
});

test("C2 transporte rejeita traversal codificado, duplo encoding e caminhos fora do site", async () => {
  let tokenCalls = 0;
  let fetchCalls = 0;
  const transport = createSharePointRestTransport({
    allowedSites: [site],
    tokenProvider: async () => { tokenCalls += 1; return "token"; },
    fetch: async () => { fetchCalls += 1; return response(200, {}); },
  });
  const hostile = [
    "/_api/%2e%2e/%2e%2e/_api/web",
    "/_api/%252e%252e/%252f_api/web",
    "/_api/web/%5c..%5c_api/web",
    "/_api/%EF%BC%8E%EF%BC%8E/web",
    `https://${site.host}/_api/web`,
    `https://${site.host}${site.path}/_api/%2E%2E/web`,
    `https://${site.host}.evil.example${site.path}/_api/web`,
  ];
  for (const target of hostile) await assert.rejects(transport.request(site, target), /destino/i);
  assert.equal(tokenCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("C2 aceita nextLink absoluto somente sob origin, site.path e _api exatos", async () => {
  const urls = [];
  const transport = createSharePointRestTransport({
    allowedSites: [site],
    tokenProvider: async () => "token",
    fetch: async url => { urls.push(url); return response(200, { value: [] }); },
  });
  const nextLink = `https://${site.host}${site.path}/_api/web/lists?$skiptoken=abc`;
  await transport.request(site, nextLink);
  assert.deepEqual(urls, [nextLink]);
});

test("C1 ACL administrativa pagina RoleAssignments e detecta escrita na pagina 2", async () => {
  const nextLink = `https://${site.host}${site.path}/_api/web/lists(guid'${listId}')/RoleAssignments?$skiptoken=page2`;
  const calls = [];
  const restTransport = {
    async request(_site, path) {
      calls.push(path);
      if (String(path).includes("?$select=HasUniqueRoleAssignments")) return { HasUniqueRoleAssignments: true };
      if (path === nextLink) return { value: [role("intruso@energeticabr.com", 3, "Edit")] };
      return { value: [role(portalConfig.superAdminEmail, 5, "Full Control")], "odata.nextLink": nextLink };
    },
  };
  const graph = { async request(path) {
    if (path.includes("/lists?")) return { value: [{ id: listId, displayName: "PORTAL_ACESSOS", list: { template: "genericList" } }] };
    return { id: "company-site" };
  } };
  const sharepoint = createSharePointRepository(graph, { company: site }, { restTransport });
  const repository = createAccessRepository({ sharepoint, getCurrentIdentity: () => ({ email: portalConfig.superAdminEmail }) });

  const security = await repository.getAccessListSecurity();

  assert.equal(security.status, "insecure");
  assert.equal(calls.includes(nextLink), true);
});

test("C1 nextLink externo em RoleAssignments e rejeitado", async () => {
  let fetchCalls = 0;
  const transport = createSharePointRestTransport({
    allowedSites: [site],
    tokenProvider: async () => "token",
    fetch: async url => {
      fetchCalls += 1;
      if (String(url).includes("?$select=HasUniqueRoleAssignments")) return response(200, { HasUniqueRoleAssignments: true });
      return response(200, { value: [role(portalConfig.superAdminEmail, 5, "Full Control")], "odata.nextLink": "https://evil.example/sites/energetica/_api/web/lists" });
    },
  });
  const graph = { async request() { return { id: "company-site" }; } };
  const sharepoint = createSharePointRepository(graph, { company: site }, { restTransport: transport });
  await assert.rejects(
    sharepoint.getListAdministrativeSecurity("company", listId),
    /destino/i,
  );
  assert.equal(fetchCalls, 2);
});

test("I6 cadastro sem OID resolve conta Graph com escopo incremental e grava id imutavel", async () => {
  const calls = [];
  const created = [];
  const sharepoint = {
    async resolveList() { return { status: "resolved", id: listId }; },
    async getItems() { return []; },
    async createItem(_siteKey, _listId, fields) { created.push(fields); return { id: "21", eTag: '"21,1"', fields }; },
  };
  const graph = {
    async request(path, options) {
      calls.push([path, options]);
      return { value: [{ id: userOid, displayName: "Ana", mail: "ana@energeticabr.com", userPrincipalName: "ana@energeticabr.com" }] };
    },
  };
  const repository = createAccessRepository({ sharepoint, graph, getCurrentIdentity: () => ({ email: portalConfig.superAdminEmail }) });

  const saved = await repository.saveUserAccess({ email: "ana@energeticabr.com", name: "Ana" });

  assert.equal(saved.oid, userOid);
  assert.equal(created[0].MICROSOFT_OID, userOid);
  assert.deepEqual(calls[0][1].scopes, ["User.ReadBasic.All"]);
  assert.match(calls[0][0], /^\/users\?/);
});

test("I6 resolucao ausente ou ambigua nao autoriza por email", async () => {
  for (const users of [[], [
    { id: userOid, mail: "ana@energeticabr.com", userPrincipalName: "ana@energeticabr.com" },
    { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", mail: "ana@energeticabr.com", userPrincipalName: "ana2@energeticabr.com" },
  ]]) {
    const sharepoint = { async resolveList() { return { status: "resolved", id: listId }; }, async getItems() { return []; }, async createItem() { throw new Error("Nao deve criar"); } };
    const graph = { async request() { return { value: users }; } };
    const repository = createAccessRepository({ sharepoint, graph, getCurrentIdentity: () => ({ email: portalConfig.superAdminEmail }) });
    await assert.rejects(repository.saveUserAccess({ email: "ana@energeticabr.com" }), error => error instanceof AccessIdentityResolutionError);
  }
});

test("I6 OID resolvido nunca substitui OID imutavel ja gravado", async () => {
  const otherOid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const existing = { id: "8", eTag: '"8,1"', fields: { EMAIL: "ANA@ENERGETICABR.COM", MICROSOFT_OID: otherOid, STATUS: "ATIVO" } };
  const sharepoint = {
    async resolveList() { return { status: "resolved", id: listId }; },
    async getItems() { return [existing]; },
    async updateItem() { throw new Error("Nao deve substituir o OID"); },
  };
  const graph = { async request() { return { value: [{ id: userOid, mail: "ana@energeticabr.com", userPrincipalName: "ana@energeticabr.com" }] }; } };
  const repository = createAccessRepository({ sharepoint, graph, getCurrentIdentity: () => ({ email: portalConfig.superAdminEmail }) });
  await assert.rejects(
    repository.saveUserAccess({ id: "8", eTag: '"8,1"', email: "ana@energeticabr.com" }),
    error => error?.name === "AccessIdentityConflictError",
  );
});

test("I6 registro legado sem OID nega login e exige migracao explicita", async () => {
  const legacy = { id: "8", eTag: '"8,1"', fields: { EMAIL: "ANA@ENERGETICABR.COM", STATUS: "ATIVO", MODULO_SUPRIMENTOS_VIEW: "SIM" } };
  const sharepoint = {
    async resolveList() { return { status: "resolved", id: listId }; },
    async getListEffectivePermissions() { return { HasUniqueRoleAssignments: true, EffectiveBasePermissions: commonReadPermissions() }; },
    async getItems() { return [legacy]; },
    async updateItem(_siteKey, _listId, _itemId, fields) { return { ...legacy, eTag: '"8,2"', fields: { ...legacy.fields, ...fields } }; },
  };
  const common = createAccessRepository({ sharepoint, getCurrentIdentity: () => ({ oid: userOid, email: "ana@energeticabr.com" }) });
  const access = await common.getCurrentAccess({ oid: userOid, email: "ana@energeticabr.com" });
  assert.equal(access.active, false);
  assert.equal(access.security.status, "indeterminate");

  const graph = { async request() { return { value: [{ id: userOid, mail: "ana@energeticabr.com", userPrincipalName: "ana@energeticabr.com" }] }; } };
  const admin = createAccessRepository({ sharepoint, graph, getCurrentIdentity: () => ({ email: portalConfig.superAdminEmail }) });
  await assert.rejects(admin.saveUserAccess({ id: "8", eTag: '"8,1"', email: "ana@energeticabr.com" }), /migra/i);
  const migrated = await admin.saveUserAccess({ id: "8", eTag: '"8,1"', email: "ana@energeticabr.com", migrateLegacyIdentity: true });
  assert.equal(migrated.oid, userOid);
});

test("I2 updateItem rele item e save seguido de revoke usa o ETag novo", async () => {
  const calls = [];
  let item = {
    id: "8",
    eTag: '"8,1"',
    fields: { EMAIL: "ANA@ENERGETICABR.COM", MICROSOFT_OID: userOid, STATUS: "ATIVO" },
  };
  const graph = {
    async request(path, options = {}) {
      calls.push([path, options]);
      if (path.includes("/fields") && options.method === "PATCH") {
        item = { ...item, eTag: item.eTag === '"8,1"' ? '"8,2"' : '"8,3"', fields: { ...item.fields, ...options.body } };
        return { ...options.body, "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#fieldValueSet/$entity" };
      }
      if (path.endsWith("/items/8?$expand=fields")) return item;
      return { id: "company-site" };
    },
  };
  const sharepoint = createSharePointRepository(graph, { company: site });
  const first = await sharepoint.updateItem("company", listId, "8", { NOME: "ANA" }, { eTag: '"8,1"' });
  await sharepoint.updateItem("company", listId, "8", { STATUS: "INATIVO" }, { eTag: first.eTag });

  const patches = calls.filter(([, options]) => options.method === "PATCH");
  assert.equal(first.eTag, '"8,2"');
  assert.equal(patches[0][1].headers["If-Match"], '"8,1"');
  assert.equal(patches[1][1].headers["If-Match"], '"8,2"');
});

test("I2 save e revoke priorizam o ETag relido, nunca a versao obsoleta da tela", async () => {
  const updates = [];
  let current = { id: "8", eTag: '"8,2"', fields: { EMAIL: "ANA@ENERGETICABR.COM", MICROSOFT_OID: userOid, STATUS: "ATIVO" } };
  const sharepoint = {
    async resolveList() { return { status: "resolved", id: listId }; },
    async getItems() { return [current]; },
    async updateItem(_siteKey, _listId, _itemId, fields, options) {
      updates.push(options.eTag);
      current = { ...current, eTag: updates.length === 1 ? '"8,3"' : '"8,4"', fields: { ...current.fields, ...fields } };
      return current;
    },
  };
  const repository = createAccessRepository({ sharepoint, getCurrentIdentity: () => ({ email: portalConfig.superAdminEmail }) });
  const stale = { id: "8", eTag: '"8,1"', oid: userOid, email: "ana@energeticabr.com", name: "Ana" };
  const saved = await repository.saveUserAccess(stale);
  await repository.setUserActive(saved, false);
  assert.deepEqual(updates, ['"8,2"', '"8,3"']);
});
