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
    assert.deepEqual(scopes, ["Sites.Read.All"]);
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

test("a espera de retry por 429 e cancelada pelo AbortSignal sem nova requisicao", async () => {
  const controller = new AbortController();
  let fetchCalls = 0;
  let retryStarted;
  const started = new Promise(resolve => { retryStarted = resolve; });
  const graph = createGraphClient(async () => "delegated-token", {
    sleep: async () => {
      retryStarted();
      return new Promise(() => {});
    },
    fetch: async () => {
      fetchCalls += 1;
      return jsonResponse(429, { error: { code: "tooManyRequests", message: "Tente depois" } }, { "retry-after": "30" });
    },
  });

  const pending = graph.request("/me", { signal: controller.signal });
  await started;
  controller.abort("rota alterada");

  await assert.rejects(pending, error => error instanceof GraphRequestError && error.code === "request_aborted");
  assert.equal(fetchCalls, 1);
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

test("o cliente Graph rejeita URL absoluta externa antes de pedir token ou usar fetch", async () => {
  let tokenCalls = 0;
  let fetchCalls = 0;
  const graph = createGraphClient(async () => {
    tokenCalls += 1;
    return "delegated-token";
  }, {
    fetch: async () => {
      fetchCalls += 1;
      return jsonResponse(200, {});
    },
  });

  await assert.rejects(graph.request("https://example.com/collect"), /Microsoft Graph/);
  assert.equal(tokenCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("o cliente Graph preserva 403 quando a resposta de erro nao tem JSON", async () => {
  const graph = createGraphClient(async () => "delegated-token", {
    fetch: async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      headers: new Headers({ "content-type": "text/html" }),
      async json() {
        throw new SyntaxError("Unexpected token '<'");
      },
    }),
  });

  await assert.rejects(graph.request("/me"), error => {
    assert.ok(error instanceof GraphRequestError);
    assert.deepEqual(
      [error.status, error.code, error.message, error.retryAfter],
      [403, "http_403", "Forbidden", undefined],
    );
    return true;
  });
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

test("o paginador generico rejeita nextLink fora do host site ou colecao autorizados", async () => {
  const invalidCursors = [
    "https://evil.example/v1.0/sites/company-site/lists?$skiptoken=next",
    "https://graph.microsoft.com/v1.0/sites/other-site/lists?$skiptoken=next",
    "https://graph.microsoft.com/v1.0/sites/company-site/lists/tickets/items?$skiptoken=next",
  ];

  for (const nextLink of invalidCursors) {
    let followed = false;
    const graph = createFakeGraph([
      { id: "company-site" },
      { value: [], "@odata.nextLink": nextLink },
      () => { followed = true; return { value: [] }; },
    ]);
    const repository = createSharePointRepository(graph, { company: sites.company });

    await assert.rejects(
      repository.listLists("company"),
      error => error?.code === "graph_pagination_cursor_invalid",
    );
    assert.equal(followed, false);
    assert.equal(graph.calls.length, 2);
  }
});

test("o paginador generico detecta cursor repetido e falha fechado", async () => {
  const nextLink = "https://graph.microsoft.com/v1.0/sites/company-site/lists?$skiptoken=next";
  const graph = createFakeGraph([
    { id: "company-site" },
    { value: [], "@odata.nextLink": nextLink },
    { value: [], "@odata.nextLink": nextLink },
  ]);
  const repository = createSharePointRepository(graph, { company: sites.company });

  await assert.rejects(
    repository.listLists("company"),
    error => error?.code === "graph_pagination_cursor_repeated",
  );
  assert.equal(graph.calls.length, 3);
});

test("o paginador generico interrompe antes de ultrapassar cem paginas", async () => {
  const pages = Array.from({ length: 101 }, (_, index) => ({
    value: [],
    ...(index < 100 ? {
      "@odata.nextLink": `https://graph.microsoft.com/v1.0/sites/company-site/lists?$skiptoken=${index + 1}`,
    } : {}),
  }));
  const graph = createFakeGraph([{ id: "company-site" }, ...pages]);
  const repository = createSharePointRepository(graph, { company: sites.company });

  await assert.rejects(
    repository.listLists("company"),
    error => error?.code === "graph_pagination_limit",
  );
  assert.equal(graph.calls.length, 101, "o site e no maximo cem paginas podem ser solicitados");
});

test("resolveList e getColumns encaminham AbortSignal a cada leitura Graph", async () => {
  const controller = new AbortController();
  const graph = createFakeGraph([
    (_path, options) => {
      assert.equal(options.signal, controller.signal);
      return { id: "company-site" };
    },
    (_path, options) => {
      assert.equal(options.signal, controller.signal);
      return { value: [{ id: "tickets", displayName: "TICKETS CLIENTES", list: { template: "genericList" } }] };
    },
    (_path, options) => {
      assert.equal(options.signal, controller.signal);
      return { value: [{ name: "Title", displayName: "Titulo" }] };
    },
  ]);
  const repository = createSharePointRepository(graph, { company: sites.company });

  const list = await repository.resolveList("company", ["TICKETS CLIENTES"], { signal: controller.signal });
  await repository.getColumns("company", list.id, { signal: controller.signal });

  assert.equal(graph.calls.length, 3);
});

test("cancelamento interrompe a descoberta antes de consultar listas", async () => {
  const controller = new AbortController();
  let discoveryStarted;
  const started = new Promise(resolve => { discoveryStarted = resolve; });
  const graph = createFakeGraph([
    (_path, options) => new Promise((resolve, reject) => {
      discoveryStarted();
      const timer = setTimeout(() => resolve({ id: "company-site" }), 100);
      options.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Cancelado", "AbortError"));
      }, { once: true });
    }),
    { value: [] },
  ]);
  const repository = createSharePointRepository(graph, { company: sites.company });

  const pending = repository.resolveList("company", ["TICKETS CLIENTES"], { signal: controller.signal });
  await started;
  controller.abort("rota alterada");

  await assert.rejects(pending, error => error?.name === "AbortError");
  assert.equal(graph.calls.length, 1);
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
    { Titulo: "Atualizado", "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#fieldValueSet/$entity" },
    { id: "3", eTag: '"3,2"', fields: { Titulo: "Atualizado" } },
    () => undefined,
  ]);
  const repository = createSharePointRepository(graph, { company: sites.company });

  assert.deepEqual(await repository.getItems("company", "tickets", "$expand=fields&$top=1"), [
    { id: "1", fields: { Titulo: "Primeiro" } },
    { id: "2", fields: { Titulo: "Segundo" } },
  ]);
  assert.deepEqual(await repository.createItem("company", "tickets", { Titulo: "Novo" }), { id: "3", fields: { Titulo: "Novo" } });
  assert.deepEqual(await repository.updateItem("company", "tickets", "3", { Titulo: "Atualizado" }, { eTag: '"3,1"' }), { id: "3", eTag: '"3,2"', fields: { Titulo: "Atualizado" } });
  assert.equal(await repository.deleteItem("company", "tickets", "3", { eTag: '"3,2"' }), undefined);
  assert.deepEqual(graph.calls.slice(3).map(call => call.options.scopes), [
    ["Sites.ReadWrite.All"],
    ["Sites.ReadWrite.All"],
    undefined,
    ["Sites.ReadWrite.All"],
  ]);
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
      options: { method: "POST", scopes: ["Sites.ReadWrite.All"], body: { fields: { Titulo: "Novo" } } },
    },
    {
      path: "/sites/company-site/lists/tickets/items/3/fields",
      options: { method: "PATCH", scopes: ["Sites.ReadWrite.All"], headers: { "If-Match": '"3,1"' }, body: { Titulo: "Atualizado" } },
    },
    {
      path: "/sites/company-site/lists/tickets/items/3?$expand=fields",
      options: { method: "GET" },
    },
    {
      path: "/sites/company-site/lists/tickets/items/3",
      options: { method: "DELETE", scopes: ["Sites.ReadWrite.All"], headers: { "If-Match": '"3,2"' } },
    },
  ]);
});

test("a galeria recebe somente um lote Graph e conserva o cursor validado", async () => {
  const nextLink = "https://graph.microsoft.com/v1.0/sites/company-site/lists/tickets/items?$skiptoken=LOTE-2";
  const graph = createFakeGraph([
    { id: "company-site" },
    { value: Array.from({ length: 50 }, (_, index) => ({ id: String(index + 1) })), "@odata.nextLink": nextLink },
  ]);
  const checks = [];
  const controller = new AbortController();
  const repository = createSharePointRepository(graph, { company: sites.company });
  repository.setAuthorizationProvider({ async authorize(request) { checks.push(request); } });

  const page = await repository.getItemsPage("company", "tickets", "$expand=fields&$top=50", {
    signal: controller.signal,
    pageNumber: 1,
    maxPages: 25,
  });

  assert.equal(page.items.length, 50);
  assert.equal(page.nextLink, nextLink);
  assert.equal(page.hasMore, true);
  assert.equal(page.batchCount, 50);
  assert.equal(graph.calls.length, 2, "o repositorio nao pode consumir o segundo lote automaticamente");
  assert.equal(graph.calls[1].options.signal, controller.signal);
  assert.deepEqual(checks.map(check => check.action), ["view"]);
});

test("a pagina incremental rejeita nextLink externo e limite excessivo sem segui-los", async () => {
  const graph = createFakeGraph([
    { id: "company-site" },
    { value: [{ id: "1" }], "@odata.nextLink": "https://example.com/roubar?token=segredo" },
  ]);
  const repository = createSharePointRepository(graph, { company: sites.company });

  await assert.rejects(
    repository.getItemsPage("company", "tickets", "$expand=fields&$top=20", { pageNumber: 1, maxPages: 5 }),
    /cursor.*inv[aá]lido|Microsoft Graph/i,
  );
  assert.equal(graph.calls.length, 2);

  await assert.rejects(
    repository.getItemsPage("company", "tickets", "$expand=fields&$top=20", { pageNumber: 6, maxPages: 5 }),
    /limite.*p[aá]ginas/i,
  );
  assert.equal(graph.calls.length, 2, "o limite deve falhar antes de uma nova leitura Graph");
});

test("a pagina incremental falha fechada se o Graph ignora top e devolve registros demais", async () => {
  const graph = createFakeGraph([
    { id: "company-site" },
    { value: Array.from({ length: 21 }, (_, index) => ({ id: String(index + 1) })) },
  ]);
  const repository = createSharePointRepository(graph, { company: sites.company });

  await assert.rejects(
    repository.getItemsPage("company", "tickets", "$expand=fields&$top=20", { pageNumber: 1 }),
    /mais registros.*limite|lote.*recusado/i,
  );
});

test("a pesquisa em varios campos usa fan-out Graph estruturado, limitado e sem filtro arbitrario", async () => {
  const graph = createFakeGraph([
    { id: "company-site" },
    { value: [{ id: "1", fields: { Title: "ANA" } }] },
    { value: [{ id: "1", fields: { Title: "ANA" } }, { id: "2", fields: { CLIENTE: "ANA MARIA" } }] },
  ]);
  const repository = createSharePointRepository(graph, { company: sites.company });

  const page = await repository.searchItemsPage("company", "tickets", {
    fields: ["Title", "CLIENTE"],
    term: "ANA",
    pageSize: 20,
  });

  assert.deepEqual(page.items.map(item => item.id), ["1", "2"]);
  assert.equal(page.hasMore, false);
  const itemCalls = graph.calls.slice(1).map(call => new URL(`https://local.invalid/?${call.path.split("?")[1]}`).searchParams);
  assert.deepEqual(itemCalls.map(params => params.get("$filter")), [
    "startswith(fields/Title,'ANA')",
    "startswith(fields/CLIENTE,'ANA')",
  ]);
  assert.ok(itemCalls.every(params => params.get("$top") === "20"));

  await assert.rejects(
    repository.searchItemsPage("company", "tickets", { fields: ["Title) or fields/STATUS eq 'ATIVO'"], term: "ANA", pageSize: 20 }),
    /campo.*inv[aá]lido/i,
  );
  assert.equal(graph.calls.length, 3, "campo arbitrario deve falhar antes de consultar o Graph");
});

test("a pesquisa multi-campo pede refinamento em vez de omitir uma continuacao", async () => {
  const graph = createFakeGraph([
    { id: "company-site" },
    {
      value: [{ id: "1", fields: { Title: "A" } }],
      "@odata.nextLink": "https://graph.microsoft.com/v1.0/sites/company-site/lists/tickets/items?$skiptoken=MAIS",
    },
  ]);
  const repository = createSharePointRepository(graph, { company: sites.company });

  await assert.rejects(
    repository.searchItemsPage("company", "tickets", { fields: ["Title"], term: "A", pageSize: 20 }),
    /refine.*pesquisa|resultado.*lote/i,
  );
});

test("os anexos usam somente a URL REST do item SharePoint informado", async () => {
  const transportCalls = [];
  const graph = createFakeGraph([{ id: "company-site" }]);
  const repository = createSharePointRepository(graph, { company: sites.company }, {
    attachmentTransport: {
      async request(site, path, options) {
        transportCalls.push({ site, path, options });
        if (options.method === "GET") return { value: [{ FileName: "CONTRATO.pdf", Length: 2048, TimeLastModified: "2026-08-26T12:00:00Z", Author: { Title: "ANA" } }] };
        return {};
      },
    },
  });
  const listId = "12345678-1234-1234-1234-123456789abc";

  assert.deepEqual(await repository.listAttachments("company", listId, "42"), [{
    name: "CONTRATO.pdf", type: "", size: 2048, author: "ANA", uploadedAt: "2026-08-26T12:00:00Z",
  }]);
  await repository.uploadAttachment("company", listId, "42", { type: "application/pdf", arrayBuffer: async () => new Uint8Array([1]).buffer }, "CONTRATO.pdf");
  await repository.deleteAttachment("company", listId, "42", "CONTRATO.pdf");
  await repository.downloadAttachment("company", listId, "42", "CONTRATO D'AVILA.pdf");
  assert.deepEqual(transportCalls.map(call => [call.site.host, call.path, call.options.method]), [
    ["energeticaltda.sharepoint.com", "/_api/web/lists(guid'12345678-1234-1234-1234-123456789abc')/items(42)/AttachmentFiles?$select=FileName,ServerRelativeUrl,Length,TimeLastModified,Author/Title&$expand=Author", "GET"],
    ["energeticaltda.sharepoint.com", "/_api/web/lists(guid'12345678-1234-1234-1234-123456789abc')/items(42)/AttachmentFiles/add(FileName='CONTRATO.pdf')", "POST"],
    ["energeticaltda.sharepoint.com", "/_api/web/lists(guid'12345678-1234-1234-1234-123456789abc')/items(42)/AttachmentFiles('CONTRATO.pdf')", "POST"],
    ["energeticaltda.sharepoint.com", "/_api/web/lists(guid'12345678-1234-1234-1234-123456789abc')/items(42)/AttachmentFiles('CONTRATO%20D''AVILA.pdf')/$value", "GET"],
  ]);
  assert.deepEqual(transportCalls.map(call => call.options.permission || "read"), ["read", "write", "write", "read"]);
  assert.equal(transportCalls[1].options.headers["Content-Type"], "application/pdf");
  assert.equal(transportCalls[2].options.headers["X-HTTP-Method"], "DELETE");
  assert.equal(transportCalls[3].options.responseType, "arrayBuffer");
});

test("a autoridade bloqueia create update delete e approve antes da requisicao de escrita", async () => {
  const graph = createFakeGraph([]);
  const repository = createSharePointRepository(graph, { company: sites.company });
  const checkedActions = [];
  repository.setAuthorizationProvider({
    async authorize(request) {
      checkedActions.push(request.action);
      throw Object.assign(new Error("NEGADO PELA ACL"), { code: "sharepoint_grant_denied" });
    },
  });
  const listId = "12345678-1234-1234-1234-123456789abc";

  await assert.rejects(repository.createItem("company", listId, { Title: "NOVO" }), /NEGADO PELA ACL/);
  await assert.rejects(repository.updateItem("company", listId, "1", { Title: "EDITADO" }, { eTag: '"1,1"' }), /NEGADO PELA ACL/);
  await assert.rejects(repository.deleteItem("company", listId, "1", { eTag: '"1,1"' }), /NEGADO PELA ACL/);
  await assert.rejects(repository.approveItem("company", listId, "1", { STATUS: "APROVADO" }, { eTag: '"1,1"' }), /NEGADO PELA ACL/);

  assert.deepEqual(checkedActions, ["create", "edit", "delete", "approve"]);
  assert.equal(graph.calls.length, 0, "nenhuma escrita pode chegar ao Graph apos a negativa");
});

test("a autoridade tambem protege leitura de itens e anexos", async () => {
  const graph = createFakeGraph([]);
  const repository = createSharePointRepository(graph, { company: sites.company }, {
    attachmentTransport: { async request() { throw new Error("nao deve chegar ao transporte"); } },
  });
  const checks = [];
  repository.setAuthorizationProvider({
    async authorize(request) {
      checks.push(request.action);
      throw new Error("LEITURA NEGADA");
    },
  });
  const listId = "12345678-1234-1234-1234-123456789abc";

  await assert.rejects(repository.getItems("company", listId), /LEITURA NEGADA/);
  await assert.rejects(repository.getItem("company", listId, "1"), /LEITURA NEGADA/);
  await assert.rejects(repository.listAttachments("company", listId, "1"), /LEITURA NEGADA/);
  await assert.rejects(repository.downloadAttachment("company", listId, "1", "arquivo.pdf"), /LEITURA NEGADA/);

  assert.deepEqual(checks, ["view", "view", "view", "view"]);
  assert.equal(graph.calls.length, 0);
});

test("o provisionamento de ACL usa somente o site exato e operacoes REST idempotentes", async () => {
  const restCalls = [];
  const missingGroups = new Set(["ENERGETICA_PORTAL_SUPRIMENTOS_EDIT"]);
  const restTransport = {
    async request(site, path, options = {}) {
      restCalls.push({ site, path, options });
      if (path.includes("sitegroups/getbyname") && missingGroups.size) {
        missingGroups.clear();
        throw Object.assign(new Error("nao encontrado"), { status: 404 });
      }
      if (path === "/_api/web/sitegroups" && options.method === "POST") return { Id: 21, Title: "ENERGETICA_PORTAL_SUPRIMENTOS_EDIT" };
      if (path.includes("roledefinitions/getbyname")) return {
        Id: 1073741830,
        Name: "ENERGETICA PORTAL - EDICAO",
        RoleTypeKind: 0,
        BasePermissions: { High: "0", Low: "5" },
      };
      if (path === "/_api/web/ensureuser") return { Id: 7, LoginName: "i:0#.f|membership|bernardonotini@energeticabr.com" };
      return {};
    },
  };
  const repository = createSharePointRepository(createFakeGraph([]), { company: sites.company }, { restTransport });

  const group = await repository.ensurePortalGroup("company", { title: "ENERGETICA_PORTAL_SUPRIMENTOS_EDIT", description: "Suprimentos" });
  const role = await repository.ensurePortalRoleDefinition("company", { name: "ENERGETICA PORTAL - EDICAO", permissions: ["view", "edit"] });
  const user = await repository.ensureSiteUser("company", "bernardonotini@energeticabr.com");

  assert.deepEqual(group, { id: 21, title: "ENERGETICA_PORTAL_SUPRIMENTOS_EDIT" });
  assert.deepEqual(role, {
    id: 1073741830,
    name: "ENERGETICA PORTAL - EDICAO",
    roleTypeKind: 0,
    basePermissions: { High: "0", Low: "5" },
  });
  assert.deepEqual(user, { id: 7, loginName: "i:0#.f|membership|bernardonotini@energeticabr.com" });
  assert.equal(restCalls.every(call => call.site.host === "energeticaltda.sharepoint.com" && call.site.path === "/sites/energetica"), true);
  assert.equal(restCalls.every(call => call.options.permission === "manage"), true);
  assert.equal(restCalls.find(call => call.path === "/_api/web/sitegroups").options.headers["Content-Type"], "application/json;odata=verbose");
});

test("funcao existente com BasePermissions incorreto e atualizada e relida", async () => {
  const calls = [];
  let corrected = false;
  const repository = createSharePointRepository(createFakeGraph([]), { company: sites.company }, {
    restTransport: {
      async request(_site, path, options = {}) {
        calls.push([path, options]);
        if (path.includes("roledefinitions/getbyname")) {
          return {
            Id: 44,
            Name: "ENERGETICA PORTAL - LEITURA",
            RoleTypeKind: 0,
            BasePermissions: corrected ? { High: "48", Low: "134418529" } : { High: "0", Low: "1" },
          };
        }
        if (path === "/_api/web/roledefinitions(44)") {
          corrected = true;
          return {};
        }
        return {};
      },
    },
  });

  const role = await repository.ensurePortalRoleDefinition("company", {
    name: "ENERGETICA PORTAL - LEITURA",
    permissions: ["view", "openItems", "viewVersions", "viewFormPages", "open", "viewPages", "browseUserInfo", "useClientIntegration", "useRemoteAPIs"],
  });

  assert.equal(role.id, 44);
  const update = calls.find(([path]) => path === "/_api/web/roledefinitions(44)");
  assert.equal(update[1].method, "POST");
  assert.equal(update[1].headers["X-HTTP-Method"], "MERGE");
  assert.equal(corrected, true);
});

test("configuracao de ACL rejeita Full Control nativo quando a mascara real nao e total", async () => {
  const repository = createSharePointRepository(createFakeGraph([]), { company: sites.company }, {
    restTransport: {
      async request(_site, path) {
        if (path.includes("roledefinitions/getbytype(5)")) {
          return { Id: 1073741829, Name: "Controle total", RoleTypeKind: 5, BasePermissions: { High: "0", Low: "1" } };
        }
        throw new Error("nenhuma mutacao deveria ocorrer");
      },
    },
  });

  await assert.rejects(repository.configureListRoleAssignments(
    "company",
    "12345678-1234-1234-1234-123456789abc",
    [{ principal: { id: 7 }, role: "FULL_CONTROL" }],
  ), /Full Control.*BasePermissions|mascara/i);
});

test("a consulta de permissao de outro usuario codifica o login e confirma ACL exclusiva", async () => {
  const paths = [];
  const repository = createSharePointRepository(createFakeGraph([]), { company: sites.company }, {
    restTransport: {
      async request(_site, path) {
        paths.push(path);
        if (path.includes("?$select=HasUniqueRoleAssignments")) return { HasUniqueRoleAssignments: true };
        return { High: "0", Low: "5" };
      },
    },
  });

  const result = await repository.getUserListEffectivePermissions(
    "company",
    "12345678-1234-1234-1234-123456789abc",
    "i:0#.f|membership|ana+obras@energeticabr.com",
  );

  assert.deepEqual(result, { HasUniqueRoleAssignments: true, EffectiveBasePermissions: { High: "0", Low: "5" } });
  assert.match(paths[1], /getUserEffectivePermissions\(@u\)/);
  assert.match(paths[1], /ana%2Bobras%40energeticabr\.com/);
});

test("sincronizacao de grupo rele a participacao e so retorna depois de comprovar o resultado", async () => {
  let member = false;
  let reads = 0;
  const repository = createSharePointRepository(createFakeGraph([]), { company: sites.company }, {
    restTransport: {
      async request(_site, path, options = {}) {
        if (path.includes("sitegroups/getbyname")) return { Id: 21, Title: "ENERGETICA_PORTAL_SUPRIMENTOS_VIEW" };
        if (path.includes("sitegroups(21)/users?$select")) {
          reads += 1;
          return { value: member ? [{ Id: 7, LoginName: "i:0#.f|membership|ana@energeticabr.com" }] : [] };
        }
        if (path === "/_api/web/sitegroups(21)/users" && options.method === "POST") {
          member = true;
          return {};
        }
        return {};
      },
    },
  });

  const result = await repository.syncPortalGroupMemberships(
    "company",
    { id: 7, loginName: "i:0#.f|membership|ana@energeticabr.com" },
    ["ENERGETICA_PORTAL_SUPRIMENTOS_VIEW"],
    ["ENERGETICA_PORTAL_SUPRIMENTOS_VIEW"],
  );

  assert.deepEqual(result, { verified: true, memberships: ["ENERGETICA_PORTAL_SUPRIMENTOS_VIEW"] });
  assert.equal(reads, 2);
});

test("sincronizacao encontra e remove membro na pagina posterior e verifica todas as paginas", async () => {
  const listPath = "/_api/web/sitegroups(21)/users?$select=Id,LoginName";
  const nextLink = `https://${sites.company.host}${sites.company.path}${listPath}&$skiptoken=page2`;
  let member = true;
  let removed = false;
  let pagedReads = 0;
  const repository = createSharePointRepository(createFakeGraph([]), { company: sites.company }, {
    restTransport: {
      async request(_site, path) {
        if (path.includes("sitegroups/getbyname")) return { Id: 21, Title: "ENERGETICA_PORTAL_SUPRIMENTOS_VIEW" };
        if (path === listPath) {
          return member
            ? { value: [], "odata.nextLink": nextLink }
            : { value: [] };
        }
        if (path === nextLink) {
          pagedReads += 1;
          return { value: member ? [{ Id: 7, LoginName: "i:0#.f|membership|ana@energeticabr.com" }] : [] };
        }
        if (path.includes("removeById(7)")) {
          member = false;
          removed = true;
          return {};
        }
        return {};
      },
    },
  });

  const result = await repository.syncPortalGroupMemberships(
    "company",
    { id: 7, loginName: "i:0#.f|membership|ana@energeticabr.com" },
    [],
    ["ENERGETICA_PORTAL_SUPRIMENTOS_VIEW"],
  );

  assert.equal(removed, true);
  assert.equal(pagedReads, 1);
  assert.deepEqual(result, { verified: true, memberships: [] });
});

test("sincronizacao nao duplica membro da pagina posterior e o encontra novamente na verificacao", async () => {
  const listPath = "/_api/web/sitegroups(21)/users?$select=Id,LoginName";
  const nextLink = `https://${sites.company.host}${sites.company.path}${listPath}&$skiptoken=page2`;
  let added = false;
  let secondPageReads = 0;
  const repository = createSharePointRepository(createFakeGraph([]), { company: sites.company }, {
    restTransport: {
      async request(_site, path, options = {}) {
        if (path.includes("sitegroups/getbyname")) return { Id: 21, Title: "ENERGETICA_PORTAL_SUPRIMENTOS_VIEW" };
        if (path === listPath) return { value: [], "odata.nextLink": nextLink };
        if (path === nextLink) {
          secondPageReads += 1;
          return { value: [{ Id: 7, LoginName: "i:0#.f|membership|ana@energeticabr.com" }] };
        }
        if (path === "/_api/web/sitegroups(21)/users" && options.method === "POST") {
          added = true;
          return {};
        }
        return {};
      },
    },
  });

  const result = await repository.syncPortalGroupMemberships(
    "company",
    { id: 7, loginName: "i:0#.f|membership|ana@energeticabr.com" },
    ["ENERGETICA_PORTAL_SUPRIMENTOS_VIEW"],
    ["ENERGETICA_PORTAL_SUPRIMENTOS_VIEW"],
  );

  assert.equal(added, false);
  assert.equal(secondPageReads, 2);
  assert.deepEqual(result, { verified: true, memberships: ["ENERGETICA_PORTAL_SUPRIMENTOS_VIEW"] });
});

test("sincronizacao rejeita nextLink externo de membros e nunca declara sucesso", async () => {
  let externalRead = false;
  const repository = createSharePointRepository(createFakeGraph([]), { company: sites.company }, {
    restTransport: {
      async request(_site, path) {
        if (path.includes("sitegroups/getbyname")) return { Id: 21, Title: "ENERGETICA_PORTAL_SUPRIMENTOS_VIEW" };
        if (path.includes("sitegroups(21)/users?$select")) {
          return { value: [], "odata.nextLink": "https://evil.example/sites/energetica/_api/web/sitegroups(21)/users?$skiptoken=roubo" };
        }
        if (path.startsWith("https://evil.example")) externalRead = true;
        return {};
      },
    },
  });

  await assert.rejects(
    repository.syncPortalGroupMemberships(
      "company",
      { id: 7, loginName: "i:0#.f|membership|ana@energeticabr.com" },
      [],
      ["ENERGETICA_PORTAL_SUPRIMENTOS_VIEW"],
    ),
    error => error.code === "group_membership_incomplete",
  );
  assert.equal(externalRead, false);
});

test("revogacao ignora grupo ausente e ainda remove o usuario dos demais grupos", async () => {
  let member = true;
  let removed = false;
  const repository = createSharePointRepository(createFakeGraph([]), { company: sites.company }, {
    restTransport: {
      async request(_site, path) {
        if (path.includes("getbyname('ENERGETICA_PORTAL_AUSENTE_VIEW')")) throw Object.assign(new Error("ausente"), { status: 404 });
        if (path.includes("getbyname('ENERGETICA_PORTAL_SUPRIMENTOS_VIEW')")) return { Id: 21, Title: "ENERGETICA_PORTAL_SUPRIMENTOS_VIEW" };
        if (path.includes("sitegroups(21)/users?$select")) return { value: member ? [{ Id: 7 }] : [] };
        if (path.includes("removeById(7)")) {
          member = false;
          removed = true;
          return {};
        }
        return {};
      },
    },
  });

  const result = await repository.syncPortalGroupMemberships(
    "company",
    { id: 7, loginName: "i:0#.f|membership|ana@energeticabr.com" },
    [],
    ["ENERGETICA_PORTAL_AUSENTE_VIEW", "ENERGETICA_PORTAL_SUPRIMENTOS_VIEW"],
  );

  assert.equal(removed, true);
  assert.deepEqual(result, { verified: true, memberships: [] });
});

test("concessao ausente falha somente depois de processar os outros grupos desejados", async () => {
  let member = false;
  let added = false;
  const repository = createSharePointRepository(createFakeGraph([]), { company: sites.company }, {
    restTransport: {
      async request(_site, path, options = {}) {
        if (path.includes("getbyname('ENERGETICA_PORTAL_AUSENTE_VIEW')")) throw Object.assign(new Error("ausente"), { status: 404 });
        if (path.includes("getbyname('ENERGETICA_PORTAL_SUPRIMENTOS_VIEW')")) return { Id: 21, Title: "ENERGETICA_PORTAL_SUPRIMENTOS_VIEW" };
        if (path.includes("sitegroups(21)/users?$select")) return { value: member ? [{ Id: 7 }] : [] };
        if (path === "/_api/web/sitegroups(21)/users" && options.method === "POST") {
          member = true;
          added = true;
          return {};
        }
        return {};
      },
    },
  });

  await assert.rejects(
    repository.syncPortalGroupMemberships(
      "company",
      { id: 7, loginName: "i:0#.f|membership|ana@energeticabr.com" },
      ["ENERGETICA_PORTAL_AUSENTE_VIEW", "ENERGETICA_PORTAL_SUPRIMENTOS_VIEW"],
      ["ENERGETICA_PORTAL_AUSENTE_VIEW", "ENERGETICA_PORTAL_SUPRIMENTOS_VIEW"],
    ),
    error => error.code === "group_membership_incomplete",
  );
  assert.equal(added, true);
});

test("rollback restaura BasePermissions de RoleDefinition existente", async () => {
  let mask = { High: "0", Low: "1" };
  const repository = createSharePointRepository(createFakeGraph([]), { company: sites.company }, {
    restTransport: {
      async request(_site, path, options = {}) {
        if (path.includes("roledefinitions/getbyname")) return { Id: 44, Name: "ENERGETICA PORTAL - LEITURA", RoleTypeKind: 0, BasePermissions: mask };
        if (path === "/_api/web/roledefinitions(44)" && options.headers?.["X-HTTP-Method"] === "MERGE") {
          const body = JSON.parse(options.body);
          mask = { High: body.BasePermissions.High, Low: body.BasePermissions.Low };
          return {};
        }
        return {};
      },
    },
  });
  const snapshot = await repository.getPortalRoleDefinition("company", "ENERGETICA PORTAL - LEITURA");
  mask = { High: "48", Low: "134418529" };

  const result = await repository.restorePortalRoleDefinition("company", snapshot);

  assert.equal(result.restored, true);
  assert.deepEqual(mask, { High: "0", Low: "1" });
});

test("rollback de RoleDefinition falha se a Description exata nao foi restaurada", async () => {
  let description = "DESCRICAO ALTERADA";
  let mask = { High: "48", Low: "134418529" };
  const repository = createSharePointRepository(createFakeGraph([]), { company: sites.company }, {
    restTransport: {
      async request(_site, path, options = {}) {
        if (path.includes("roledefinitions/getbyname")) {
          return {
            Id: 44,
            Name: "ENERGETICA PORTAL - LEITURA",
            Description: description,
            RoleTypeKind: 0,
            BasePermissions: mask,
          };
        }
        if (path === "/_api/web/roledefinitions(44)" && options.headers?.["X-HTTP-Method"] === "MERGE") {
          const body = JSON.parse(options.body);
          mask = { High: body.BasePermissions.High, Low: body.BasePermissions.Low };
          return {};
        }
        return {};
      },
    },
  });

  await assert.rejects(
    repository.restorePortalRoleDefinition("company", {
      status: "resolved",
      id: 44,
      name: "ENERGETICA PORTAL - LEITURA",
      description: "DESCRICAO ORIGINAL",
      roleTypeKind: 0,
      basePermissions: { High: "0", Low: "1" },
    }),
    /restauracao exata/i,
  );
});

test("configureListRoleAssignments enumera e remove principals de todas as paginas", async () => {
  const listId = "12345678-1234-1234-1234-123456789abc";
  const listPath = `/_api/web/lists(guid'${listId}')/RoleAssignments?$select=PrincipalId,RoleDefinitionBindings/Id&$expand=RoleDefinitionBindings`;
  const nextLink = `https://${sites.company.host}${sites.company.path}${listPath}&$skiptoken=page2`;
  const deleted = [];
  const repository = createSharePointRepository(createFakeGraph([]), { company: sites.company }, {
    restTransport: {
      async request(_site, path, options = {}) {
        if (path.includes("roledefinitions/getbytype(5)")) {
          return { Id: 99, RoleTypeKind: 5, BasePermissions: { High: "2147483647", Low: "4294967295" } };
        }
        if (path.includes("?$select=HasUniqueRoleAssignments")) return { HasUniqueRoleAssignments: true };
        if (path === listPath) return { value: [], "odata.nextLink": nextLink };
        if (path === nextLink) return { value: [{ PrincipalId: 18, RoleDefinitionBindings: [{ Id: 77 }] }] };
        const removal = path.match(/getbyprincipalid\((\d+)\)/);
        if (removal && options.headers?.["X-HTTP-Method"] === "DELETE") deleted.push(Number(removal[1]));
        return {};
      },
    },
  });

  const result = await repository.configureListRoleAssignments("company", listId, []);

  assert.deepEqual(deleted, [18]);
  assert.deepEqual(result, { configured: true, assignments: 0 });
});

test("configureListRoleAssignments rejeita nextLink externo sem segui-lo", async () => {
  const listId = "12345678-1234-1234-1234-123456789abc";
  let externalRead = false;
  const repository = createSharePointRepository(createFakeGraph([]), { company: sites.company }, {
    restTransport: {
      async request(_site, path) {
        if (path.includes("roledefinitions/getbytype(5)")) {
          return { Id: 99, RoleTypeKind: 5, BasePermissions: { High: "2147483647", Low: "4294967295" } };
        }
        if (path.includes("?$select=HasUniqueRoleAssignments")) return { HasUniqueRoleAssignments: true };
        if (path.includes("/RoleAssignments?$select=PrincipalId")) {
          return { value: [], "odata.nextLink": "https://evil.example/sites/energetica/_api/web/lists/segredos" };
        }
        if (path.startsWith("https://evil.example")) externalRead = true;
        return {};
      },
    },
  });

  await assert.rejects(
    repository.configureListRoleAssignments("company", listId, []),
    /nextLink|pagina[cç][aã]o|cursor/i,
  );
  assert.equal(externalRead, false);
});

test("restoreListRoleAssignments remove principals atuais de todas as paginas antes do rollback", async () => {
  const listId = "12345678-1234-1234-1234-123456789abc";
  const operationalPath = `/_api/web/lists(guid'${listId}')/RoleAssignments?$select=PrincipalId,RoleDefinitionBindings/Id&$expand=RoleDefinitionBindings`;
  const operationalNext = `https://${sites.company.host}${sites.company.path}${operationalPath}&$skiptoken=page2`;
  const deleted = [];
  let restored = false;
  const repository = createSharePointRepository(createFakeGraph([]), { company: sites.company }, {
    restTransport: {
      async request(_site, path, options = {}) {
        if (path.includes("?$select=HasUniqueRoleAssignments")) return { HasUniqueRoleAssignments: true };
        if (path === operationalPath) {
          return { value: [{ PrincipalId: 18, RoleDefinitionBindings: [{ Id: 77 }] }], "odata.nextLink": operationalNext };
        }
        if (path === operationalNext) return { value: [{ PrincipalId: 19, RoleDefinitionBindings: [{ Id: 78 }] }] };
        const removal = path.match(/getbyprincipalid\((\d+)\)/);
        if (removal && options.headers?.["X-HTTP-Method"] === "DELETE") {
          deleted.push(Number(removal[1]));
          return {};
        }
        if (path.includes("addroleassignment(principalid=7,roledefid=10)")) {
          restored = true;
          return {};
        }
        if (path.includes("/RoleAssignments?$select=Member/Id")) {
          return {
            value: restored ? [{
              Member: { Id: 7, Title: "ENERGETICA PORTAL", PrincipalType: 8 },
              RoleDefinitionBindings: [{ Id: 10 }],
            }] : [],
          };
        }
        return {};
      },
    },
  });

  const result = await repository.restoreListRoleAssignments("company", listId, {
    HasUniqueRoleAssignments: true,
    RoleAssignments: [{
      Member: { Id: 7, Title: "ENERGETICA PORTAL", PrincipalType: 8 },
      RoleDefinitionBindings: [{ Id: 10 }],
    }],
  });

  assert.deepEqual(deleted, [18, 19]);
  assert.deepEqual(result, { restored: true, unique: true, assignments: 1 });
});

test("restoreListRoleAssignments rejeita nextLink externo da enumeracao operacional", async () => {
  const listId = "12345678-1234-1234-1234-123456789abc";
  let externalRead = false;
  const repository = createSharePointRepository(createFakeGraph([]), { company: sites.company }, {
    restTransport: {
      async request(_site, path) {
        if (path.includes("?$select=HasUniqueRoleAssignments")) return { HasUniqueRoleAssignments: true };
        if (path.includes("/RoleAssignments?$select=PrincipalId")) {
          return { value: [], "odata.nextLink": "https://evil.example/sites/energetica/_api/web/lists/segredos" };
        }
        if (path.startsWith("https://evil.example")) externalRead = true;
        return {};
      },
    },
  });

  await assert.rejects(
    repository.restoreListRoleAssignments("company", listId, {
      HasUniqueRoleAssignments: true,
      RoleAssignments: [],
    }),
    /nextLink|pagina[cç][aã]o|cursor/i,
  );
  assert.equal(externalRead, false);
});

test("rollback remove RoleDefinition criada durante tentativa de setup", async () => {
  let exists = true;
  const repository = createSharePointRepository(createFakeGraph([]), { company: sites.company }, {
    restTransport: {
      async request(_site, path, options = {}) {
        if (path.includes("roledefinitions/getbyname")) {
          if (!exists) throw Object.assign(new Error("ausente"), { status: 404 });
          return { Id: 44, Name: "ENERGETICA PORTAL - LEITURA", RoleTypeKind: 0, BasePermissions: { High: "0", Low: "1" } };
        }
        if (path === "/_api/web/roledefinitions(44)" && options.headers?.["X-HTTP-Method"] === "DELETE") {
          exists = false;
          return {};
        }
        return {};
      },
    },
  });

  const result = await repository.restorePortalRoleDefinition("company", { status: "missing", name: "ENERGETICA PORTAL - LEITURA" });

  assert.equal(result.restored, true);
  assert.equal(exists, false);
});

test("rollback restaura heranca quando a lista originalmente nao tinha ACL exclusiva", async () => {
  let inherited = false;
  const calls = [];
  const repository = createSharePointRepository(createFakeGraph([]), { company: sites.company }, {
    restTransport: {
      async request(_site, path, options = {}) {
        calls.push([path, options]);
        if (path.includes("?$select=HasUniqueRoleAssignments")) return { HasUniqueRoleAssignments: !inherited };
        if (path.endsWith("/resetroleinheritance()")) {
          inherited = true;
          return {};
        }
        return {};
      },
    },
  });

  const result = await repository.restoreListRoleAssignments(
    "company",
    "12345678-1234-1234-1234-123456789abc",
    { HasUniqueRoleAssignments: false, RoleAssignments: [] },
  );

  assert.deepEqual(result, { restored: true, unique: false, assignments: 0 });
  assert.equal(calls.some(([path]) => path.endsWith("/resetroleinheritance()")), true);
});

test("rollback recompõe exatamente principals e funcoes da ACL exclusiva anterior", async () => {
  let unique = false;
  let restored = false;
  const added = [];
  const repository = createSharePointRepository(createFakeGraph([]), { company: sites.company }, {
    restTransport: {
      async request(_site, path) {
        if (path.includes("?$select=HasUniqueRoleAssignments")) return { HasUniqueRoleAssignments: unique };
        if (path.endsWith("/breakroleinheritance(false,false)")) {
          unique = true;
          return {};
        }
        if (path.includes("/RoleAssignments?$select=PrincipalId")) return { value: [] };
        const add = path.match(/addroleassignment\(principalid=(\d+),roledefid=(\d+)\)/);
        if (add) {
          added.push([Number(add[1]), Number(add[2])]);
          restored = added.length === 2;
          return {};
        }
        if (path.includes("/RoleAssignments?$select=Member/Id")) {
          return {
            value: restored ? [{
              Member: { Id: 7, Title: "ENERGETICA PORTAL", PrincipalType: 8 },
              RoleDefinitionBindings: [{ Id: 10 }, { Id: 11 }],
            }] : [],
          };
        }
        return {};
      },
    },
  });
  const snapshot = {
    HasUniqueRoleAssignments: true,
    RoleAssignments: [{
      Member: { Id: 7, Title: "ENERGETICA PORTAL", PrincipalType: 8 },
      RoleDefinitionBindings: [{ Id: 10 }, { Id: 11 }],
    }],
  };

  const result = await repository.restoreListRoleAssignments(
    "company",
    "12345678-1234-1234-1234-123456789abc",
    snapshot,
  );

  assert.deepEqual(added, [[7, 10], [7, 11]]);
  assert.deepEqual(result, { restored: true, unique: true, assignments: 2 });
});
