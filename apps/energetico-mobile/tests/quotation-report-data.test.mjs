import test from "node:test";
import assert from "node:assert/strict";
import { createSharePointRepository } from "../../../portal/data/sharepoint-repository.js";

const data = await import("../src/chat/quotation-report-data.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
function create(options) {
  assert.equal(typeof data.createQuotationReportData, "function", "createQuotationReportData must be implemented");
  return data.createQuotationReportData(options);
}
const names = { NOVACOTACAO: ["FILIAL", "ETAPA", "DESCRICAO", "STATUS"],
  ORCAMENTOS: ["IDCOTACAO", "FILIAL", "ETAPA", "FORNECEDOR", "DATAFINALIZADO", "VALORTOTAL", "STATUS", "OBS"] };
const columns = list => names[list].map((displayName, i) => ({ name: `field_${i}`, displayName }));
const values = { NOVACOTACAO: [" A ", { Value: "Obra" }, "Materiais", "ATIVA"],
  ORCAMENTOS: ["001", "A", "Obra", ["Fornecedor"], "29/02/2024", "R$ 1.234,50", "PENDENTE SOLICITAÇÃO", "linha 1\nlinha 2"] };
const item = (list, id = 1, extra = {}) => ({ id: String(id), fields: {
  ...Object.fromEntries(values[list].map((value, i) => [`field_${i}`, value])), ...extra } });
function fixture(overrides = {}) {
  return { repository: {
    async resolveList(site, aliases, { signal }) {
      assert.equal(site, "personal"); assert.ok(signal); assert.equal(aliases.length, 1); assert.ok(names[aliases[0]]);
      return { status: "resolved", id: aliases[0] };
    },
    async getColumns(site, list, { signal }) { assert.equal(site, "personal"); assert.ok(signal); return columns(list); },
    async getItemsPage(site, list, query, options) {
      assert.equal(site, "personal"); assert.ok(options.signal);
      const parameters = new URLSearchParams(query);
      assert.equal(parameters.get("$expand"), "fields"); assert.equal(parameters.get("$top"), "100");
      assert.equal(parameters.has("$filter"), false);
      return { items: [item(list)], hasMore: false, batchCount: 1 };
    },
    createItem() { assert.fail("writes forbidden"); }, updateItem() { assert.fail("writes forbidden"); }, deleteItem() { assert.fail("writes forbidden"); },
    ...overrides,
  } };
}

test("both actual PowerFx lists and discovered internal columns produce a normalized atomic snapshot", async () => {
  const result = await create(fixture()).loadSnapshot();
  assert.deepEqual(result, { quotes: [{ id: 1, branch: "A", stage: "Obra", description: "Materiais", status: "ATIVA" }],
    budgets: [{ id: 1, quotationId: 1, branch: "A", stage: "Obra", supplier: "Fornecedor", finalizedDate: "2024-02-29",
      total: 1234.5, status: "PENDENTE SOLICITAÇÃO", observation: "linha 1\nlinha 2" }] });
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.budgets)); assert.ok(Object.isFrozen(result.budgets[0]));
});

test("confirmed live headers and three pending suppliers keep empty money and dates unknown", async () => {
  const result = await create(fixture({ async getColumns(_site, list) {
    return [...names[list].map(name => ({ name, displayName: name })), { name: "OTHER", displayName: "Other column" }];
  }, async getItemsPage(_site, list) {
    return { items: list === "NOVACOTACAO" ? [
      { id: "4", fields: { FILIAL: "004EDIFICIOXAVANTE", ETAPA: "ALVENARIA,PREPARAÇÃOELÉTRICA E HIDRÁULICA", DESCRICAO: "", STATUS: "ATIVA" } },
      { id: "5", fields: { STATUS: "PENDENTE SOLICITAÇÃO" } },
    ] : ["GERDAU", "ARCELOR MITTAL", "MARCOS RODRIGO DE CARVALHO"].map((supplier, i) => ({ id: String(i + 1), fields: {
      IDCOTACAO: 4, VALORTOTAL: "", FORNECEDOR: supplier, STATUS: "PENDENTE SOLICITAÇÃO", FILIAL: "004EDIFICIOXAVANTE",
      ETAPA: "ALVENARIA,PREPARAÇÃOELÉTRICA E HIDRÁULICA", OBS: "", DATAFINALIZADO: "" } })), hasMore: false };
  } })).loadSnapshot();
  const { buildQuotationOverview } = await import("../src/chat/quotation-report-model.js");
  const overview = buildQuotationOverview(result);
  assert.deepEqual(overview.metrics, { active: 1, inactive: 0, total: 2, pending: 3 });
  assert.equal(overview.quotes[0].id, 5); assert.equal(overview.quotes[0].branch, ""); assert.equal(overview.quotes[0].budgetCount, 0);
  assert.equal(overview.quotes[1].supplierCount, 3); assert.equal(overview.quotes[1].budgetCount, 3);
  assert.ok(result.budgets.every(row => row.total === null && row.finalizedDate === null));
});

test("every consumed field requires schema even for empty lists", async () => {
  for (const [target, fields] of Object.entries(names)) for (const missing of fields) {
    await assert.rejects(create(fixture({ async getColumns(_site, list) {
      return columns(list).filter(column => list !== target || column.displayName !== missing);
    }, async getItemsPage() { return { items: [], hasMore: false }; } })).loadSnapshot(),
    error => error.message.includes(missing) && /coluna|esquema/i.test(error.message));
  }
});

test("renamed Title and encoded accented hidden fields resolve without computed-column ambiguity", async () => {
  const result = await create(fixture({ async getColumns(_site, list) {
    return [{ name: "LinkTitle", displayName: "FILIAL" }, { name: "computed", displayName: "FILIAL", computed: {} },
      ...columns(list).map(column => column.displayName === "FILIAL" ? { ...column, name: "Title" }
        : column.displayName === "DESCRICAO" ? { name: "DESCRI_x00c7__x00c3_O", displayName: "Descrição", hidden: true } : column)];
  }, async getItemsPage(_site, list) {
    return { items: [item(list, 10, { Title: "B", DESCRI_x00c7__x00c3_O: "Texto" })], hasMore: false };
  } })).loadSnapshot();
  assert.equal(result.quotes[0].branch, "B"); assert.equal(result.quotes[0].description, "Texto"); assert.equal(result.budgets[0].branch, "B");
});

test("lookup quotation references use lookup IDs instead of display text", async () => {
  const result = await create(fixture({ async getColumns(_site, list) {
    return columns(list).map(column => column.displayName === "IDCOTACAO" ? { ...column, lookup: { listId: "quotes" } } : column);
  }, async getItemsPage(_site, list) {
    return { items: [item(list, 1, list === "ORCAMENTOS" ? { field_0: "Display title", field_0LookupId: "10" } : {})], hasMore: false };
  } })).loadSnapshot();
  assert.equal(result.budgets[0].quotationId, 10);
  const object = await create(fixture({ async getItemsPage(_site, list) {
    return { items: [item(list, 1, list === "ORCAMENTOS" ? { field_0: { LookupId: "2", LookupValue: "Display title" } } : {})], hasMore: false };
  } })).loadSnapshot();
  assert.equal(object.budgets[0].quotationId, 2);
});

test("missing ambiguous computed unsafe and reused schema fields reject", async () => {
  for (const mutate of [() => null, list => [...list, { name: "duplicate", displayName: "FILIAL" }],
    list => list.map((column, i) => i === 1 ? { ...column, name: "bad/name" } : column),
    list => list.map((column, i) => i === 1 ? { ...column, computed: true } : column),
    list => list.map((column, i) => i === 1 ? { ...column, name: "field_0" } : column)]) {
    await assert.rejects(create(fixture({ async getColumns(_site, list) { return mutate(columns(list)); } })).loadSnapshot(), /coluna|esquema/i);
  }
});

test("pagination reads both lists beyond 100-page windows and 2000 records without truncation", async () => {
  const counts = { NOVACOTACAO: 0, ORCAMENTOS: 0 };
  const result = await create(fixture({ async getItemsPage(_site, list, _query, options) {
    const page = ++counts[list]; assert.equal(options.pageNumber, (page - 1) % 100 + 1); assert.equal(options.maxPages, 100);
    assert.equal(options.cursor || "", page === 1 ? "" : `${list}-${page}`);
    return { items: Array.from({ length: 21 }, (_, i) => item(list, (page - 1) * 21 + i + 1)), hasMore: page < 102,
      nextLink: page < 102 ? `${list}-${page + 1}` : "" };
  } })).loadSnapshot();
  assert.equal(result.quotes.length, 2142); assert.equal(result.budgets.length, 2142); assert.equal(result.budgets[2141].id, 2142);
});

test("a failure after the other list succeeds never exposes a partial snapshot or fake zeros", async () => {
  let fail = true;
  const service = create(fixture({ async getItemsPage(_site, list) {
    if (fail && list === "ORCAMENTOS") throw new Error("503 budgets unavailable");
    return { items: [item(list)], hasMore: false };
  } }));
  await assert.rejects(service.loadSnapshot(), /503 budgets unavailable/);
  fail = false;
  assert.equal((await service.loadSnapshot()).budgets.length, 1);
});

test("malformed incomplete and inconsistent pagination rejects instead of exposing totals", async () => {
  for (const page of [{ items: null, hasMore: false }, { items: [], hasMore: "false" }, { items: [], hasMore: true, nextLink: "next" },
    { items: [], hasMore: false, nextLink: "next" }, { items: [item("ORCAMENTOS")], hasMore: true },
    ...["error", "partial", "incomplete", "truncated", "aborted"].map(flag => ({ items: [], hasMore: false, [flag]: true })),
    { items: [], hasMore: false, complete: false }, { items: [], hasMore: false, batchCount: 1 },
    { items: [], hasMore: false, nextLink: {} }, { items: Array.from({ length: 101 }, (_, i) => item("ORCAMENTOS", i + 1)), hasMore: false }]) {
    await assert.rejects(create(fixture({ async getItemsPage(_site, list) {
      return list === "ORCAMENTOS" ? page : { items: [], hasMore: false };
    } })).loadSnapshot(), /página|pagin|incomplet|inválid/i);
  }
});

test("numeric duplicate IDs and repeated cursors reject within each independent list", async () => {
  for (const target of Object.keys(names)) for (const mode of ["same-page", "cross-page", "cycle"]) {
    let count = 0;
    await assert.rejects(create(fixture({ async getItemsPage(_site, list) {
      if (list !== target) return { items: [], hasMore: false };
      if (mode === "same-page") return { items: [item(list, 1), item(list, "01")], hasMore: false };
      return { items: [item(list, mode === "cross-page" ? 1 : ++count)], hasMore: true, nextLink: "same" };
    } })).loadSnapshot(), /duplic|ciclo|cursor/i);
  }
});

test("runaway pagination rejects the snapshot at the safe bound", async () => {
  let count = 0;
  await assert.rejects(create(fixture({ async getItemsPage(_site, list) {
    if (list !== "ORCAMENTOS") return { items: [], hasMore: false };
    return { items: [item(list, ++count)], hasMore: true, nextLink: `page-${count}` };
  } })).loadSnapshot(), /limite|parcial/i);
  assert.equal(count, 10000);
});

test("invalid records scalar fields money and dates do not silently become blank", async () => {
  for (const bad of [{ id: 0, fields: {} }, { id: 1, fields: null }, { id: 1, fields: [] },
    item("ORCAMENTOS", 1, { field_1: {} }), item("ORCAMENTOS", 1, { field_3: ["A", "B"] }),
    item("ORCAMENTOS", 1, { field_4: "2026-02-30" }), item("ORCAMENTOS", 1, { field_5: "ISENTO" })]) {
    await assert.rejects(create(fixture({ async getItemsPage(_site, list) {
      return { items: list === "ORCAMENTOS" ? [bad] : [], hasMore: false };
    } })).loadSnapshot(), /ID|registro|campo|data|valor|monetário/i);
  }
});

test("valid schema with blank fields preserves missing references dates and totals", async () => {
  const result = await create(fixture({ async getItemsPage() { return { items: [{ id: "9", fields: {} }], hasMore: false }; } })).loadSnapshot();
  assert.deepEqual(result.budgets[0], { id: 9, quotationId: "", branch: "", stage: "", supplier: "", finalizedDate: null,
    total: null, status: "", observation: "" });
});

test("pre-abort and cancellation during any transport stage settle even when the transport ignores its signal", { timeout: 2000 }, async () => {
  const pre = new AbortController(); pre.abort(); await assert.rejects(create(fixture()).loadSnapshot({ signal: pre.signal }), /abort|cancel/i);
  for (const method of ["resolveList", "getColumns", "getItemsPage"]) {
    let started; const ready = new Promise(resolve => { started = resolve; }); const controller = new AbortController();
    const pending = create(fixture({ [method]() { started(); return new Promise(() => {}); } })).loadSnapshot({ signal: controller.signal });
    await ready; controller.abort(); await assert.rejects(pending, /abort|cancel/i);
  }
});

test("late abort retains the caller's reason and discards the completed page", async () => {
  const controller = new AbortController(); const reason = new Error("custom cancellation");
  await assert.rejects(create(fixture({ async getItemsPage() { controller.abort(reason); return { items: [], hasMore: false }; } }))
    .loadSnapshot({ signal: controller.signal }), error => error === reason);
});

test("missing lists unavailable session and invalid repository fail explicitly", async () => {
  for (const target of Object.keys(names)) await assert.rejects(create(fixture({ async resolveList(_site, [list]) {
    return list === target ? { status: "missing" } : { status: "resolved", id: list };
  } })).loadSnapshot(), error => error.message.includes(target));
  assert.throws(() => create(), /sessão/i); assert.throws(() => create({ repository: {} }), /repositório/i);
});

function graphFixture({ foreign = "" } = {}) {
  const requests = [];
  const repository = createSharePointRepository({ async request(path, options = {}) {
    assert.equal(options.method || "GET", "GET"); requests.push(path);
    if (path.includes("/lists?")) return { value: Object.keys(names).map(id => ({ id, displayName: id, list: { template: "genericList" } })) };
    const list = path.includes("/lists/ORCAMENTOS/") ? "ORCAMENTOS" : "NOVACOTACAO";
    if (path.includes("/columns")) return { value: path.includes("skiptoken") ? columns(list).slice(2) : columns(list).slice(0, 2),
      ...(path.includes("skiptoken") ? {} : { "@odata.nextLink": `https://graph.microsoft.com/v1.0/sites/site/lists/${list}/columns?$skiptoken=next` }) };
    if (path.includes("/items")) return { value: [item(list, path.includes("skiptoken") ? 2 : 1)],
      ...(path.includes("skiptoken") ? {} : { "@odata.nextLink": foreign || `https://graph.microsoft.com/v1.0/sites/site/lists/${list}/items?$skiptoken=next` }) };
    return { id: "site" };
  } }, { personal: { host: "example.sharepoint.com", path: "/personal/test", readTransport: "graph" } });
  return { repository, requests };
}

test("real repository fully paginates both metadata and records with GET only", async () => {
  const fixture = graphFixture(); const result = await create(fixture).loadSnapshot();
  assert.deepEqual(result.quotes.map(row => row.id), [1, 2]); assert.deepEqual(result.budgets.map(row => row.id), [1, 2]);
  assert.ok(fixture.requests.some(path => path.includes("ORCAMENTOS/columns?$skiptoken")));
});

test("real repository rejects foreign hosts sites lists and collection continuations", async () => {
  for (const foreign of ["https://evil.example/items", "https://graph.microsoft.com/v1.0/sites/other/lists/NOVACOTACAO/items?$skiptoken=x",
    "https://graph.microsoft.com/v1.0/sites/site/lists/ORCAMENTOS/items?$skiptoken=x",
    "https://graph.microsoft.com/v1.0/sites/site/lists/NOVACOTACAO/columns?$skiptoken=x"]) {
    await assert.rejects(create(graphFixture({ foreign })).loadSnapshot(), /nextLink|pagin|inválid|invalido/i);
  }
});

test("default Graph boundary requests Sites.Read.All and the configured personal site without writes", async t => {
  const scopes = []; const urls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.method, "GET"); urls.push(url);
    const path = new URL(url).pathname;
    let payload;
    if (path.includes("/lists/") && path.endsWith("/columns")) payload = { value: columns(path.includes("/ORCAMENTOS/") ? "ORCAMENTOS" : "NOVACOTACAO") };
    else if (path.endsWith("/items")) payload = { value: [] };
    else if (path.endsWith("/lists")) payload = { value: Object.keys(names).map(id => ({ id, displayName: id, list: { template: "genericList" } })) };
    else payload = { id: "site" };
    return { ok: true, status: 200, async json() { return payload; } };
  });
  const result = await create({ async tokenProvider(requested, { signal }) { assert.ok(signal); scopes.push(requested); return "test-token"; } }).loadSnapshot();
  assert.deepEqual(result, { quotes: [], budgets: [] });
  assert.ok(scopes.length); assert.ok(scopes.every(value => JSON.stringify(value) === '["Sites.Read.All"]'));
  assert.ok(urls.some(url => url.includes("energeticaltda-my.sharepoint.com") && url.includes("bernardonotini_energeticabr_com")));
});
