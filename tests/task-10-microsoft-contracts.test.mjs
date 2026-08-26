import assert from "node:assert/strict";
import test from "node:test";
import portalConfig from "../portal/config.js";
import { can } from "../portal/access/access-model.js";
import { createAccessRepository } from "../portal/access/access-repository.js";
import { createMicrosoftAuth } from "../portal/auth/microsoft-auth.js";
import { createSharePointAttachmentTransport } from "../portal/data/attachments.js";
import { GraphRequestError } from "../portal/data/graph-client.js";
import { createSharePointRepository } from "../portal/data/sharepoint-repository.js";
import { formMarkup } from "../portal/ui/dynamic-form.js";

const sites = portalConfig.sharepointSites;
const list = { status: "resolved", id: "12345678-1234-1234-1234-123456789abc" };
const anaOid = "11111111-2222-4333-8444-555555555555";

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, statusText: status === 412 ? "Precondition Failed" : "", async json() { return payload; } };
}

function acl(unique = true) {
  return { HasUniqueRoleAssignments: unique, RoleAssignments: [
    { Member: { PrincipalType: 1, Email: portalConfig.superAdminEmail }, RoleDefinitionBindings: [{ Name: "Full Control", RoleTypeKind: 5 }] },
    { Member: { PrincipalType: 1, Email: "ana@energeticabr.com" }, RoleDefinitionBindings: [{ Name: "Read", RoleTypeKind: 2 }] },
  ] };
}

function sharepointFake({ items = [], security = acl(), columns = [] } = {}) {
  const calls = [];
  return {
    calls,
    async resolveList() { return list; },
    async resolveSites() { return { company: { id: "company-site" } }; },
    async getListSecurity(siteKey, listId) { calls.push(["getListSecurity", siteKey, listId]); return security; },
    async getItems(siteKey, listId, query) { calls.push(["getItems", siteKey, listId, query]); return items; },
    async getColumns() { return columns; },
    async createItem(siteKey, listId, fields) { calls.push(["createItem", siteKey, listId, fields]); return { id: "90", eTag: "\"90,1\"", fields }; },
    async updateItem(siteKey, listId, itemId, fields, options) { calls.push(["updateItem", siteKey, listId, itemId, fields, options]); return { id: itemId, eTag: "\"updated,2\"", fields }; },
    clearCache() {},
  };
}

test("C1 usa ACL REST real e nunca Graph beta para autorizar usuario comum", async () => {
  const sharepoint = sharepointFake({ items: [{ id: "12", eTag: "\"12,3\"", fields: { EMAIL: "ANA@ENERGETICABR.COM", MICROSOFT_OID: anaOid, STATUS: "ATIVO", MODULO_SUPRIMENTOS_VIEW: "SIM" } }] });
  const graphCalls = [];
  const repository = createAccessRepository({ sharepoint, graph: { async request(...args) { graphCalls.push(args); throw new Error("Graph nao deve validar ACL"); } }, getCurrentIdentity: () => ({ oid: anaOid, email: "ana@energeticabr.com" }) });
  const access = await repository.getCurrentAccess({ oid: anaOid, email: "ana@energeticabr.com" });
  assert.equal(access.security.status, "secure");
  assert.equal(can(access, "suprimentos", "view"), true);
  assert.deepEqual(sharepoint.calls[0], ["getListSecurity", "company", list.id]);
  assert.equal(graphCalls.some(([path]) => String(path).includes("/permissions")), false);
});

test("C1 nega ACL herdada ou desconhecida e mantem recuperacao do superadmin", async () => {
  for (const security of [acl(false), { HasUniqueRoleAssignments: true, RoleAssignments: [{ Member: { PrincipalType: 4 }, RoleDefinitionBindings: [{ Name: "Read", RoleTypeKind: 2 }] }] }, { HasUniqueRoleAssignments: true, RoleAssignments: [{ Member: { PrincipalType: 1, Email: "ana@energeticabr.com" } }] }]) {
    const repository = createAccessRepository({ sharepoint: sharepointFake({ security }), getCurrentIdentity: () => ({ oid: anaOid, email: "ana@energeticabr.com" }) });
    const access = await repository.getCurrentAccess({ oid: anaOid, email: "ana@energeticabr.com" });
    assert.equal(access.active, false);
    assert.notEqual(access.security.status, "secure");
  }
  const recovery = createAccessRepository({ sharepoint: sharepointFake({ security: { invalid: true } }), getCurrentIdentity: () => ({ email: portalConfig.superAdminEmail }) });
  assert.equal((await recovery.getCurrentAccess({ email: portalConfig.superAdminEmail })).security.status, "superadmin");
});

test("C2 transporte REST inclui host e caminho exatos dos dois sites", async () => {
  const calls = [];
  const transport = createSharePointAttachmentTransport({ tokenProvider: async () => "token", allowedSites: Object.values(sites), fetch: async (url, options) => { calls.push([url, options]); return response(200, { value: [] }); } });
  await transport.request(sites.company, "/_api/web/lists", { method: "GET" });
  await transport.request(sites.personal, "/_api/web/lists", { method: "GET" });
  await assert.rejects(transport.request({ host: sites.company.host, path: "/sites/outro" }, "/_api/web/lists"), /destino/i);
  assert.deepEqual(calls.map(([url]) => url), ["https://energeticaltda.sharepoint.com/sites/energetica/_api/web/lists", "https://energeticaltda-my.sharepoint.com/personal/bernardonotini_energeticabr_com/_api/web/lists"]);
});

test("C1 e C2 repositorio consulta ACL na web corporativa exata", async () => {
  const calls = [];
  const repository = createSharePointRepository({ async request() { return { id: "company-site" }; } }, { company: sites.company }, { restTransport: { async request(site, path) { calls.push([site.host, site.path, path]); return path.includes("/RoleAssignments?") ? { value: acl().RoleAssignments } : { HasUniqueRoleAssignments: true }; } } });
  const result = await repository.getListSecurity("company", list.id);
  assert.equal(result.HasUniqueRoleAssignments, true);
  assert.equal(result.RoleAssignments.length, 2);
  assert.ok(calls.every(([host, path, rest]) => host === sites.company.host && path === sites.company.path && rest.startsWith(`/_api/web/lists(guid'${list.id}')`)));
});

test("I1 usa InteractionRequiredAuthError oficial para consentimento e sessao", async () => {
  class InteractionRequiredAuthError extends Error { constructor(errorCode) { super(errorCode); this.errorCode = errorCode; } }
  const account = { username: "ana@energeticabr.com" };
  for (const code of ["consent_required", "login_required", "interaction_required"]) {
    let redirects = 0;
    class PublicClientApplication { async handleRedirectPromise() { return { account }; } setActiveAccount() {} async acquireTokenSilent() { throw new InteractionRequiredAuthError(code); } async acquireTokenRedirect() { redirects += 1; } }
    const auth = createMicrosoftAuth(portalConfig.microsoft, { PublicClientApplication, InteractionRequiredAuthError });
    await auth.initialize();
    assert.equal(await auth.getToken(["Sites.Read.All"]), undefined);
    assert.equal(redirects, 1);
  }
});

test("I1 devolve falha silenciosa comum sem redirect", async () => {
  class InteractionRequiredAuthError extends Error {}
  let redirects = 0;
  class PublicClientApplication { async handleRedirectPromise() { return { account: { username: "ana@energeticabr.com" } }; } setActiveAccount() {} async acquireTokenSilent() { throw new Error("network_error"); } async acquireTokenRedirect() { redirects += 1; } }
  const auth = createMicrosoftAuth(portalConfig.microsoft, { PublicClientApplication, InteractionRequiredAuthError });
  await auth.initialize();
  await assert.rejects(auth.getToken(["Sites.Read.All"]), /network_error/);
  assert.equal(redirects, 0);
});

test("I2 update e delete usam If-Match e 412 vira conflito tipado", async () => {
  const calls = [];
  const graph = { async request(path, options = {}) { calls.push([path, options]); if (path.includes("/fields")) return { Title: "NOVO" }; if (options.method === "DELETE") throw new GraphRequestError({ status: 412, code: "preconditionFailed", message: "ETag antigo" }); return { id: "company-site" }; } };
  const repository = createSharePointRepository(graph, { company: sites.company });
  await repository.updateItem("company", "tickets", "7", { Title: "NOVO" }, { eTag: "\"7,4\"" });
  await assert.rejects(repository.deleteItem("company", "tickets", "7", { eTag: "\"7,4\"" }), error => error?.name === "SharePointConflictError" && error.status === 412 && error.code === "concurrent_change");
  assert.equal(calls[1][1].headers["If-Match"], "\"7,4\"");
  assert.equal(calls[2][1].headers["If-Match"], "\"7,4\"");
});

test("I2 conflito preserva valores locais e mostra versao atual", () => {
  const markup = formMarkup({ entity: { messageFields: [], uppercaseFields: [] }, columns: [{ name: "Title", displayName: "Título", text: {} }], mode: "edit", values: { Title: "MEU VALOR AINDA NAO SALVO" }, conflict: { message: "O registro foi alterado por outra pessoa.", serverFields: { Title: "VALOR ATUAL DO SHAREPOINT" } } });
  assert.match(markup, /value="MEU VALOR AINDA NAO SALVO"/);
  assert.match(markup, /Conflito de edição/);
  assert.match(markup, /VALOR ATUAL DO SHAREPOINT/);
  assert.match(markup, /Recarregar versão do SharePoint/);
});

test("I6 usa OID e email normalizados, faz upsert e rejeita duplicata", async () => {
  const existing = { id: "12", eTag: "\"12,2\"", fields: { EMAIL: "ANA@ENERGETICABR.COM", MICROSOFT_OID: anaOid.toUpperCase(), STATUS: "ATIVO" } };
  const sharepoint = sharepointFake({ items: [existing] });
  const repository = createAccessRepository({ sharepoint, getCurrentIdentity: () => ({ email: portalConfig.superAdminEmail }) });
  await repository.saveUserAccess({ email: " ANA@ENERGETICABR.COM ", oid: anaOid.toUpperCase(), name: "Ana" });
  assert.equal(sharepoint.calls.some(([operation]) => operation === "createItem"), false);
  const update = sharepoint.calls.find(([operation]) => operation === "updateItem");
  assert.equal(update[3], "12");
  assert.equal(update[4].MICROSOFT_OID, anaOid);
  assert.deepEqual(update[5], { eTag: "\"12,2\"" });
  const duplicate = createAccessRepository({ sharepoint: sharepointFake({ items: [existing, { ...existing, id: "13" }] }), getCurrentIdentity: () => ({ email: portalConfig.superAdminEmail }) });
  await assert.rejects(duplicate.saveUserAccess({ email: "ana@energeticabr.com", oid: anaOid }), error => error?.name === "AccessIdentityConflictError" && /duplicad/i.test(error.message));
});

test("I6 identidade duplicada nega usuario comum com diagnostico", async () => {
  const item = { eTag: "\"12,1\"", fields: { EMAIL: "ANA@ENERGETICABR.COM", MICROSOFT_OID: anaOid, STATUS: "ATIVO", MODULO_SUPRIMENTOS_VIEW: "SIM" } };
  const repository = createAccessRepository({ sharepoint: sharepointFake({ items: [{ ...item, id: "12" }, { ...item, id: "13" }] }), getCurrentIdentity: () => ({ oid: anaOid, email: "ana@energeticabr.com" }) });
  const access = await repository.getCurrentAccess({ oid: anaOid, email: "ana@energeticabr.com" });
  assert.equal(access.active, false);
  assert.equal(access.security.status, "duplicate_identity");
});

test("I6 consulta OID e email em filtros indexados separados sem OR", async () => {
  const sharepoint = sharepointFake({ items: [] });
  const repository = createAccessRepository({ sharepoint, getCurrentIdentity: () => ({ oid: anaOid, email: "ana@energeticabr.com" }) });
  await repository.getCurrentAccess({ oid: anaOid, email: "ana@energeticabr.com" });
  const queries = sharepoint.calls.filter(([operation]) => operation === "getItems").map(call => call[3]);
  assert.equal(queries.length, 2);
  assert.ok(queries.some(query => query.includes("MICROSOFT_OID")));
  assert.ok(queries.some(query => query.includes("EMAIL")));
  assert.ok(queries.every(query => !/\sor\s/i.test(query)));
});

test("I6 setup cria OID e email indexados e unicos quando suportado", async () => {
  const graphCalls = [];
  const repository = createAccessRepository({ sharepoint: sharepointFake({ columns: [{ id: "email-column", name: "EMAIL", indexed: false, enforceUniqueValues: false }] }), graph: { async request(path, options) { graphCalls.push([path, options]); return { id: "column-created" }; } }, getCurrentIdentity: () => ({ email: portalConfig.superAdminEmail }) });
  await repository.ensureList();
  const emailPatch = graphCalls.find(([path]) => path.endsWith("/columns/email-column"));
  const oidCreate = graphCalls.find(([path, options]) => path.endsWith("/columns") && options.method === "POST");
  assert.deepEqual(emailPatch[1].body, { indexed: true, enforceUniqueValues: true });
  assert.equal(oidCreate[1].body.name, "MICROSOFT_OID");
  assert.equal(oidCreate[1].body.indexed, true);
  assert.equal(oidCreate[1].body.enforceUniqueValues, true);
});
