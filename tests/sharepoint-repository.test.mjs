import assert from "node:assert/strict";
import test from "node:test";
import { createGraphClient, GraphRequestError } from "../portal/data/graph-client.js";
import { createSharePointRepository } from "../portal/data/sharepoint-repository.js";

const sites = {
  personal: {
    host: "energeticaltda-my.sharepoint.com",
    path: "/personal/bernardonotini_energeticabr_com",
  },
  company: {
    host: "energeticaltda.sharepoint.com",
    path: "/sites/energetica",
  },
};

function jsonResponse(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json", ...headers }),
    async json() {
      return payload;
    },
  };
}

function createFakeGraph(routes) {
  const calls = [];
  return {
    calls,
    async request(path, options = {}) {
      calls.push({ path, options });
      const route = routes.shift();
      if (!route) throw new Error(`Rota Graph inesperada: ${path}`);
      if (typeof route === "function") return route(path, options);
      return route;
    },
  };
}

test("o cliente Graph envia JSON, expira a requisicao e repete somente um 429", async () => {
  const calls = [];
  const delays = [];
  const graph = createGraphClient(async scopes => {
    assert.deepEqual(scopes, ["Sites.ReadWrite.All"]);
    return "delegated-token";
  }, {
    timeoutMs: 250,
    sleep: async milliseconds => delays.push(milliseconds),
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) {
        return jsonResponse(429, { error: { code: "tooManyRequests", message: "Tente depois" } }, { "retry-after": "1" });
      }
      return jsonResponse(201, { id: "created", fields: { Titulo: "Nova" } });
    },
  });

  const created = await graph.request("/sites/company/lists/items", {
    method: "POST",
    body: { fields: { Titulo: "Nova" } },
  });

  assert.deepEqual(created, { id: "created", fields: { Titulo: "Nova" } });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://graph.microsoft.com/v1.0/sites/company/lists/items");
  assert.equal(calls[0].options.headers.Authorization, "Bearer delegated-token");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.equal(calls[0].options.body, '{"fields":{"Titulo":"Nova"}}');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.deepEqual(delays, [1000]);
});

test("o cliente Graph devolve erros tipados de autenticacao, autorizacao, ausencia e limite", async () => {
  const responses = [
    jsonResponse(401, { error: { code: "InvalidAuthenticationToken", message: "Token invalido" } }),
    jsonResponse(403, { error: { code: "accessDenied", message: "Sem permissao" } }),
    jsonResponse(404, { error: { code: "itemNotFound", message: "Nao encontrado" } }),
    jsonResponse(429, { error: { code: "tooManyRequests", message: "Tente depois" } }, { "retry-after": "9" }),
    jsonResponse(429, { error: { code: "tooManyRequests", message: "Tente depois" } }, { "retry-after": "9" }),
  ];
  const graph = createGraphClient(async () => "delegated-token", {
    sleep: async () => {},
    fetch: async () => responses.shift(),
  });

  for (const expected of [
    [401, "InvalidAuthenticationToken", "Token invalido", undefined],
    [403, "accessDenied", "Sem permissao", undefined],
    [404, "itemNotFound", "Nao encontrado", undefined],
    [429, "tooManyRequests", "Tente depois", 9],
  ]) {
    await assert.rejects(graph.request("/me"), error => {
      assert.ok(error instanceof GraphRequestError);
      assert.deepEqual(
        [error.status, error.code, error.message, error.retryAfter],
        expected,
      );
      return true;
    });
  }
});

test("o cliente Graph aborta requisicoes que ultrapassam o tempo limite", async () => {
  let aborted = false;
  const graph = createGraphClient(async () => "delegated-token", {
    timeoutMs: 1,
    fetch: async (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("aborted"));
      }, { once: true });
    }),
  });

  await assert.rejects(graph.request("/me"), error => {
    assert.ok(error instanceof GraphRequestError);
    assert.equal(error.status, 0);
    assert.equal(error.code, "request_timeout");
    return true;
  });
  assert.equal(aborted, true);
});

test("o repositorio resolve os dois sites, aliases sem acentos e paginas de listas", async () => {
  const graph = createFakeGraph([
    { id: "personal-site" },
    { id: "company-site" },
    {
      value: [{ id: "tickets", displayName: "TICKETS CLIENTES", list: { template: "genericList" } }],
      "@odata.nextLink": "https://graph.microsoft.com/v1.0/sites/company-site/lists?$skiptoken=next",
    },
    {
      value: [{ id: "urgencia", displayName: "CADASTROURGÊNCIA", list: { template: "genericList" } }],
    },
  ]);
  const repository = createSharePointRepository(graph, sites);

  const resolvedSites = await repository.resolveSites();
  const resolvedList = await repository.resolveList("company", ["cadastrourgencia"]);

  assert.deepEqual(resolvedSites, {
    personal: { id: "personal-site" },
    company: { id: "company-site" },
  });
  assert.deepEqual(resolvedList, {
    id: "urgencia",
    displayName: "CADASTROURGÊNCIA",
    list: { template: "genericList" },
    status: "resolved",
  });
  assert.deepEqual(graph.calls.map(call => call.path), [
    "/sites/energeticaltda-my.sharepoint.com:/personal/bernardonotini_energeticabr_com",
    "/sites/energeticaltda.sharepoint.com:/sites/energetica",
    "/sites/company-site/lists?$select=id,displayName,webUrl,list",
    "https://graph.microsoft.com/v1.0/sites/company-site/lists?$skiptoken=next",
  ]);
});

test("o repositorio mantem somente metadados em cache e permite limpa-los no logout", async () => {
  const graph = createFakeGraph([
    { id: "company-site" },
    { value: [{ id: "tickets", displayName: "TICKETS CLIENTES", list: { template: "genericList" } }] },
    { value: [{ name: "Titulo", displayName: "Titulo" }] },
    { id: "company-site" },
    { value: [{ id: "tickets", displayName: "TICKETS CLIENTES", list: { template: "genericList" } }] },
    { value: [{ name: "Titulo", displayName: "Titulo" }] },
  ]);
  const repository = createSharePointRepository(graph, { company: sites.company });

  await repository.listLists("company");
  await repository.listLists("company");
  await repository.getColumns("company", "tickets");
  await repository.getColumns("company", "tickets");
  assert.equal(graph.calls.length, 3);

  repository.clearCache();
  await repository.listLists("company");
  await repository.getColumns("company", "tickets");
  assert.equal(graph.calls.length, 6);
});

test("o repositorio retorna ausencia estruturada quando o site pessoal nao possui listas personalizadas", async () => {
  const graph = createFakeGraph([
    { id: "personal-site" },
    { value: [{ id: "documents", displayName: "Documentos", list: { template: "documentLibrary" } }] },
  ]);
  const repository = createSharePointRepository(graph, { personal: sites.personal });

  assert.deepEqual(await repository.resolveList("personal", ["CADASTROURGÊNCIA"]), {
    status: "missing",
    siteKey: "personal",
    aliases: ["CADASTROURGÊNCIA"],
  });
  assert.equal(graph.calls.length, 2);
});

test("um site inacessivel nao bloqueia a descoberta dos demais", async () => {
  const denied = new GraphRequestError({ status: 403, code: "accessDenied", message: "Sem permissao" });
  const graph = createFakeGraph([
    () => { throw denied; },
    { id: "company-site" },
    { value: [] },
  ]);
  const repository = createSharePointRepository(graph, sites);

  const resolvedSites = await repository.resolveSites();
  assert.equal(resolvedSites.personal.status, "unavailable");
  assert.equal(resolvedSites.personal.error, denied);
  assert.deepEqual(resolvedSites.company, { id: "company-site" });
  assert.deepEqual(await repository.listLists("company"), []);
});

test("o repositorio pagina itens e encaminha criacao, atualizacao e exclusao de campos", async () => {
  const graph = createFakeGraph([
    { id: "company-site" },
    {
      value: [{ id: "1", fields: { Titulo: "Primeiro" } }],
      "@odata.nextLink": "https://graph.microsoft.com/v1.0/sites/company-site/lists/tickets/items?$skiptoken=next",
    },
    { value: [{ id: "2", fields: { Titulo: "Segundo" } }] },
    { id: "3", fields: { Titulo: "Novo" } },
    { Titulo: "Atualizado" },
    () => undefined,
  ]);
  const repository = createSharePointRepository(graph, { company: sites.company });

  assert.deepEqual(await repository.getItems("company", "tickets", "$expand=fields&$top=1"), [
    { id: "1", fields: { Titulo: "Primeiro" } },
    { id: "2", fields: { Titulo: "Segundo" } },
  ]);
  assert.deepEqual(await repository.createItem("company", "tickets", { Titulo: "Novo" }), { id: "3", fields: { Titulo: "Novo" } });
  assert.deepEqual(await repository.updateItem("company", "tickets", "3", { Titulo: "Atualizado" }), { Titulo: "Atualizado" });
  assert.equal(await repository.deleteItem("company", "tickets", "3"), undefined);
  assert.deepEqual(graph.calls.slice(1).map(call => ({ path: call.path, options: call.options })), [
    {
      path: "/sites/company-site/lists/tickets/items?$expand=fields&$top=1",
      options: { method: "GET" },
    },
    {
      path: "https://graph.microsoft.com/v1.0/sites/company-site/lists/tickets/items?$skiptoken=next",
      options: { method: "GET" },
    },
    {
      path: "/sites/company-site/lists/tickets/items",
      options: { method: "POST", body: { fields: { Titulo: "Novo" } } },
    },
    {
      path: "/sites/company-site/lists/tickets/items/3/fields",
      options: { method: "PATCH", body: { Titulo: "Atualizado" } },
    },
    {
      path: "/sites/company-site/lists/tickets/items/3",
      options: { method: "DELETE" },
    },
  ]);
});
