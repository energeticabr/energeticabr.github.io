import test from "node:test";
import assert from "node:assert/strict";
import { createSharePointRepository } from "../../../portal/data/sharepoint-repository.js";

const data = await import("../src/chat/depreciation-report-data.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
function create(options) {
  assert.equal(typeof data.createDepreciationReportData, "function", "createDepreciationReportData must be implemented");
  return data.createDepreciationReportData(options);
}
const headers = ["FILIAL", "DATA DEPRECIAÇÃO", "NÚMEROIMOBILIZADO", "GRUPO IMOBILIZADO", "IMOBILIZADO", "VALOR ESTIMADO", "VALOR RESIDUAL", "QTD", "% DEPRECIACAO"];
const columns = () => headers.map((displayName, index) => ({ name: `field_${index}`, displayName }));
const values = [" A ", "06/10/2026", " PAT-1 ", { LookupValue: "Equipamentos" }, ["Betoneira"], "R$ 1.234,567", "1.000,005", "2,5", "2,75"];
const item = (id = 1, extra = {}) => ({ id: String(id), fields: { ...Object.fromEntries(values.map((value, index) => [`field_${index}`, value])), ...extra } });
function fixture(overrides = {}) {
  return { repository: {
    async resolveList(site, aliases, { signal }) {
      assert.equal(site, "personal"); assert.deepEqual(aliases, ["IMOBILIZADOS"]); assert.ok(signal);
      return { status: "resolved", id: "IMOBILIZADOS" };
    },
    async getColumns(site, list, { signal }) { assert.equal(site, "personal"); assert.equal(list, "IMOBILIZADOS"); assert.ok(signal); return columns(); },
    async getItemsPage(site, list, query, { signal }) {
      assert.equal(site, "personal"); assert.equal(list, "IMOBILIZADOS"); assert.ok(signal);
      const parameters = new URLSearchParams(query);
      assert.equal(parameters.get("$expand"), "fields($select=field_0,field_1,field_2,field_3,field_4,field_5,field_6,field_7,field_8)");
      assert.equal(parameters.get("$top"), "100");
      assert.equal(parameters.has("$filter"), false); assert.equal(parameters.has("$select"), false);
      return { items: [item()], hasMore: false, batchCount: 1 };
    },
    createItem() { assert.fail("writes forbidden"); }, updateItem() { assert.fail("writes forbidden"); }, deleteItem() { assert.fail("writes forbidden"); },
    ...overrides,
  } };
}

test("full personal IMOBILIZADOS data resolves real headers into the atomic numeric contract", async () => {
  const result = await create(fixture()).loadSnapshot();
  assert.deepEqual(result, { assets: [{ id: 1, branch: "A", depreciationDate: "2026-10-06", patrimony: "PAT-1", group: "Equipamentos", asset: "Betoneira",
    estimatedUnit: 1234.567, residualUnit: 1000.005, quantity: 2.5, rate: 2.75 }] });
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.assets)); assert.ok(Object.isFrozen(result.assets[0]));
});

test("normalizing SharePoint rows and then the whole snapshot preserves exact decimal products", async () => {
  const result = await create(fixture({ async getItemsPage() {
    return { items: [item(1, { field_5: "0,004999999999999999999", field_6: 0, field_7: 1 })], hasMore: false };
  } })).loadSnapshot();
  const { buildDepreciationOverview } = await import("../src/chat/depreciation-report-model.js");
  assert.equal(buildDepreciationOverview(result, "2026-10-06").metrics.total, 0);
});

test("encoded accents registration aliases and generated OData rate fields resolve without display names", async () => {
  const names = ["FILIAL", "DATADEPRECIA_x00c7__x00c3_O", "N_x00da_MEROIMOBILIZADO", "GRUPO_x0020_IMOBILIZADO", "ITEM",
    "VALORESTIMADO", "VALORRESIDUAL", "QTD", "OData__x0025_DEPRECIACAO"];
  const result = await create(fixture({ async getColumns() { return names.map(name => ({ name })); },
    async getItemsPage() { return { items: [{ id: "1", fields: Object.fromEntries(values.map((value, index) => [names[index], value])) }], hasMore: false }; },
  })).loadSnapshot();
  assert.equal(result.assets[0].rate, 2.75); assert.equal(result.assets[0].asset, "Betoneira");
  assert.equal(result.assets[0].patrimony, "PAT-1"); assert.equal(result.assets[0].depreciationDate, "2026-10-06");
});

test("renamed Title accented display names and hidden columns ignore computed link-title duplicates", async () => {
  const result = await create(fixture({ async getColumns() {
    return [{ name: "LinkTitle", displayName: "FILIAL" }, { name: "computed", displayName: "FILIAL", computed: {} },
      ...columns().map((column, i) => i === 0 ? { ...column, name: "Title" }
        : i === 8 ? { ...column, displayName: "% Depreciação", hidden: true } : column)];
  }, async getItemsPage() { return { items: [item(1, { Title: "B" })], hasMore: false }; } })).loadSnapshot();
  assert.equal(result.assets[0].branch, "B"); assert.equal(result.assets[0].rate, 2.75);
});

test("every consumed column is required even for a truly empty list", async () => {
  for (const missing of headers) {
    await assert.rejects(create(fixture({ async getColumns() { return columns().filter(column => column.displayName !== missing); },
      async getItemsPage() { return { items: [], hasMore: false }; } })).loadSnapshot(), error => /coluna|esquema/i.test(error.message) && error.message.includes(missing));
  }
});

test("ambiguous unsafe reused computed and malformed schema cannot return empty success", async () => {
  for (const mutate of [() => null, list => [...list, { name: "duplicate", displayName: "FILIAL" }],
    list => list.map((column, i) => i === 1 ? { ...column, name: "bad/name" } : column),
    list => list.map((column, i) => i === 1 ? { ...column, computed: true } : column),
    list => list.map((column, i) => i === 1 ? { ...column, name: "field_0" } : column)]) {
    await assert.rejects(create(fixture({ async getColumns() { return mutate(columns()); } })).loadSnapshot(), /coluna|esquema/i);
  }
});

test("full source keeps overdue SIM NÃO and every status then sorts residual units descending", async () => {
  const result = await create(fixture({ async getItemsPage(_site, _list, query) {
    assert.equal(new URLSearchParams(query).has("$filter"), false);
    return { items: [item(1, { field_1: "1990-01-01", field_6: 5, STATUS: "INATIVO", DEPRECIAR: "NÃO" }),
      item(2, { field_1: "2099-01-01", field_6: 8, STATUS: "ATIVO", DEPRECIAR: "SIM" }),
      item(3, { field_1: null, field_6: "bad", DEPRECIAR: "NÃO" })], hasMore: false };
  } })).loadSnapshot();
  assert.deepEqual(result.assets.map(row => [row.id, row.depreciationDate, row.residualUnit]), [[2, "2099-01-01", 8], [1, "1990-01-01", 5], [3, null, 0]]);
});

test("paging crosses the 100-page repository window and 2000 records without a partial snapshot", async () => {
  let count = 0;
  const result = await create(fixture({ async getItemsPage(_site, _list, _query, options) {
    const page = ++count;
    assert.equal(options.pageNumber, (page - 1) % 100 + 1); assert.equal(options.maxPages, 100);
    assert.equal(options.cursor || "", page === 1 ? "" : `page-${page}`);
    return { items: Array.from({ length: 21 }, (_, i) => item((page - 1) * 21 + i + 1)), hasMore: page < 102,
      nextLink: page < 102 ? `page-${page + 1}` : "", batchCount: 21 };
  } })).loadSnapshot();
  assert.equal(result.assets.length, 2142); assert.equal(result.assets[2141].id, 2142);
});

test("malformed partial inconsistent empty-continuation and oversized pages reject instead of totals", async () => {
  for (const page of [{ items: null, hasMore: false }, { items: [], hasMore: "false" }, { items: [], hasMore: true, nextLink: "next" },
    { items: [], hasMore: false, nextLink: "next" }, { items: [item()], hasMore: true },
    ...["error", "partial", "incomplete", "truncated", "aborted"].map(flag => ({ items: [], hasMore: false, [flag]: true })),
    { items: [], hasMore: false, complete: false }, { items: [], hasMore: false, batchCount: 1 },
    { items: [], hasMore: false, nextLink: {} }, { items: Array.from({ length: 101 }, (_, i) => item(i + 1)), hasMore: false }]) {
    await assert.rejects(create(fixture({ async getItemsPage() { return page; } })).loadSnapshot(), /página|pagin|incomplet|inválid/i);
  }
});

test("normalized duplicate IDs and cursor cycles reject across pages and within a page", async () => {
  for (const mode of ["same-page", "cross-page", "cycle"]) {
    let count = 0;
    await assert.rejects(create(fixture({ async getItemsPage() {
      if (mode === "same-page") return { items: [item(1), item("01")], hasMore: false };
      return { items: [item(mode === "cross-page" ? 1 : ++count)], hasMore: true, nextLink: "same" };
    } })).loadSnapshot(), /duplic|ciclo|cursor/i);
  }
});

test("runaway paging reaches a safe error bound rather than returning truncated assets", async () => {
  let count = 0;
  await assert.rejects(create(fixture({ async getItemsPage() {
    return { items: [item(++count)], hasMore: true, nextLink: `page-${count}` };
  } })).loadSnapshot(), /limite|parcial/i);
  assert.equal(count, 10000);
});

test("failed later page cannot expose earlier rows and an independent reload can succeed", async () => {
  let calls = 0; let fail = true;
  const service = create(fixture({ async getItemsPage() {
    if (++calls === 2 && fail) throw new Error("503 source unavailable");
    return { items: [item(calls)], hasMore: calls === 1, nextLink: calls === 1 ? "next" : "" };
  } }));
  await assert.rejects(service.loadSnapshot(), /503 source unavailable/);
  fail = false;
  assert.equal((await service.loadSnapshot()).assets.length, 1);
});

test("invalid records dates scalar collections and non-residual numbers reject", async () => {
  for (const bad of [{ id: 0, fields: {} }, { id: 1, fields: null }, { id: 1, fields: [] }, item(1, { field_0: {} }),
    item(1, { field_3: ["A", "B"] }), item(1, { field_1: "2026-02-30" }), item(1, { field_5: "ISENTO" }),
    item(1, { field_7: "NaN" }), item(1, { field_8: "bad" })]) {
    await assert.rejects(create(fixture({ async getItemsPage() { return { items: [bad], hasMore: false }; } })).loadSnapshot(), /ID|registro|campo|data|valor|numéric/i);
  }
});

test("missing SharePoint values differ from missing schema and residual invalid text becomes explicit zero", async () => {
  const result = await create(fixture({ async getItemsPage() {
    return { items: [{ id: "9", fields: {} }, item(10, { field_6: "ISENTO" })], hasMore: false };
  } })).loadSnapshot();
  assert.deepEqual(result.assets[0], { id: 9, branch: "SEM FILIAL", depreciationDate: null, patrimony: "", group: "", asset: "",
    estimatedUnit: 0, residualUnit: 0, quantity: 0, rate: 0 });
  assert.equal(result.assets[1].residualUnit, 0);
});

test("pre-abort and any stalled repository operation settle even when the transport ignores signal", { timeout: 2000 }, async () => {
  const pre = new AbortController(); pre.abort();
  await assert.rejects(create(fixture()).loadSnapshot({ signal: pre.signal }), /abort|cancel/i);
  for (const method of ["resolveList", "getColumns", "getItemsPage"]) {
    let started; const ready = new Promise(resolve => { started = resolve; }); const controller = new AbortController();
    const pending = create(fixture({ [method]() { started(); return new Promise(() => {}); } })).loadSnapshot({ signal: controller.signal });
    await ready; controller.abort(); await assert.rejects(pending, /abort|cancel/i);
  }
});

test("a token provider ignoring cancellation settles immediately with the caller reason", { timeout: 2000 }, async () => {
  let started; const ready = new Promise(resolve => { started = resolve; }); const controller = new AbortController();
  const pending = create({ tokenProvider(_scopes, { signal }) {
    assert.ok(signal); started(); return new Promise(() => {});
  } }).loadSnapshot({ signal: controller.signal });
  await ready; const reason = new Error("caller cancellation"); controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
});

test("late abort discards a completed page and preserves the exact caller reason", async () => {
  const controller = new AbortController(); const reason = new Error("caller late cancellation");
  await assert.rejects(create(fixture({ async getItemsPage() { controller.abort(reason); return { items: [item()], hasMore: false }; } }))
    .loadSnapshot({ signal: controller.signal }), error => error === reason);
});

test("missing list no session and an invalid repository fail explicitly", async () => {
  await assert.rejects(create(fixture({ async resolveList() { return { status: "missing" }; } })).loadSnapshot(), /IMOBILIZADOS/);
  assert.throws(() => create(), /sessão/i); assert.throws(() => create({ repository: {} }), /repositório/i);
});

function graphFixture(foreign = "") {
  const requests = [];
  const repository = createSharePointRepository({ async request(path, options = {}) {
    assert.equal(options.method || "GET", "GET"); requests.push(path);
    if (path.includes("/lists?")) return { value: [{ id: "assets", displayName: "IMOBILIZADOS", list: { template: "genericList" } }] };
    if (path.includes("/columns")) return { value: path.includes("skiptoken") ? columns().slice(2) : columns().slice(0, 2),
      ...(path.includes("skiptoken") ? {} : { "@odata.nextLink": "https://graph.microsoft.com/v1.0/sites/site/lists/assets/columns?$skiptoken=next" }) };
    if (path.includes("/items")) return { value: [item(path.includes("skiptoken") ? 2 : 1)],
      ...(path.includes("skiptoken") ? {} : { "@odata.nextLink": foreign || "https://graph.microsoft.com/v1.0/sites/site/lists/assets/items?$skiptoken=next" }) };
    return { id: "site" };
  } }, { personal: { host: "example.sharepoint.com", path: "/personal/test", readTransport: "graph" } });
  return { repository, requests };
}

test("real repository reads all paginated metadata and records using GET only", async () => {
  const source = graphFixture(); const result = await create(source).loadSnapshot();
  assert.deepEqual(result.assets.map(row => row.id), [1, 2]);
  assert.ok(source.requests.some(path => path.includes("columns?$skiptoken")));
});

function lookupGraphFixture(scenario = {}) {
  const requests = [];
  const names = ["f0", "DATADEPRECIA_x00c7__x00c3_O", "N_x00da_MEROIMOBILIZADO", "GRUPO_x0020_IMOBILIZADO", "ITEM",
    "VALORESTIMADO", "VALORRESIDUAL", "QTD", "OData__x0025_DEPRECIACAO"];
  const repository = createSharePointRepository({ async request(path, options = {}) {
    assert.equal(options.method || "GET", "GET"); requests.push(path);
    if (path.includes("/lists?")) return { value: [{ id: "assets", displayName: "IMOBILIZADOS", list: { template: "genericList" } }] };
    if (path.includes("/columns")) return { value: names.map((name, index) => ({ name, displayName: headers[index],
      ...(index === 0 ? { lookup: { listId: "branches", columnName: "Title", allowMultipleValues: false } } : {}) })) };
    if (path.includes("/items")) {
      const secondPage = path.includes("skiptoken");
      const fields = { DATADEPRECIA_x00c7__x00c3_O: "2026-10-06T00:00:00Z", N_x00da_MEROIMOBILIZADO: "PAT-1",
        GRUPO_x0020_IMOBILIZADO: "Equipamentos", ITEM: "Betoneira", VALORESTIMADO: 1200, VALORRESIDUAL: "1e3",
        QTD: 2, OData__x0025_DEPRECIACAO: 10, f0LookupId: "42" };
      const expand = new URL(path, "https://graph.microsoft.com/v1.0").searchParams.get("$expand");
      if (secondPage ? !scenario.unresolved : expand?.includes("$select=f0,")) fields.f0 = "Filial 42";
      return { value: [{ id: secondPage ? "2" : "1", fields }], ...(secondPage ? {} : {
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/sites/site/lists/assets/items?$skiptoken=next",
      }) };
    }
    return { id: "site" };
  } }, { personal: { host: "example.sharepoint.com", path: "/personal/test", readTransport: "graph" } });
  return { repository, requests };
}

test("real Graph requests resolved column names so lookup branches are returned instead of SEM FILIAL", async () => {
  const source = lookupGraphFixture(); const result = await create(source).loadSnapshot();
  assert.deepEqual(result.assets.map(asset => asset.branch), ["Filial 42", "Filial 42"]);
  const firstItemsPath = source.requests.find(path => path.includes("/items"));
  const parameters = new URL(firstItemsPath, "https://graph.microsoft.com/v1.0").searchParams;
  assert.equal(parameters.get("$expand"), "fields($select=f0,DATADEPRECIA_x00c7__x00c3_O,N_x00da_MEROIMOBILIZADO,GRUPO_x0020_IMOBILIZADO,ITEM,VALORESTIMADO,VALORRESIDUAL,QTD,OData__x0025_DEPRECIACAO)");
  assert.equal(parameters.has("$filter"), false);
});

test("real Graph unresolved lookup on a later page rejects the entire load and allows a fresh reload", async () => {
  const options = { unresolved: true }; const source = lookupGraphFixture(options); const service = create(source);
  await assert.rejects(service.loadSnapshot(), /lookup|consulta|referência/i);
  assert.equal(source.requests.filter(path => path.includes("/items")).length, 2);
  options.unresolved = false;
  assert.deepEqual((await service.loadSnapshot()).assets.map(asset => [asset.id, asset.branch]), [[1, "Filial 42"], [2, "Filial 42"]]);
});

test("populated unresolved lookup IDs reject for every consumed field while blank lookup IDs stay blank", async () => {
  for (let index = 0; index < headers.length; index++) {
    for (const value of [undefined, null, "", "  "]) {
      const fields = item().fields; fields[`field_${index}`] = value; fields[`field_${index}LookupId`] = "42";
      if (value === undefined) delete fields[`field_${index}`];
      await assert.rejects(create(fixture({ async getItemsPage() { return { items: [{ id: "1", fields }], hasMore: false }; } }))
        .loadSnapshot(), /lookup|consulta|referência/i);
    }
  }
  for (const lookupId of [undefined, null, "", "  ", []]) {
    const result = await create(fixture({ async getItemsPage() {
      return { items: [{ id: "1", fields: { field_0LookupId: lookupId } }], hasMore: false };
    } })).loadSnapshot();
    assert.equal(result.assets[0].branch, "SEM FILIAL");
    assert.equal(result.assets[0].estimatedUnit, 0);
  }
});

test("real repository rejects foreign host site list and collection cursors", async () => {
  for (const foreign of ["https://evil.example/items", "https://graph.microsoft.com/v1.0/sites/other/lists/assets/items?$skiptoken=x",
    "https://graph.microsoft.com/v1.0/sites/site/lists/other/items?$skiptoken=x", "https://graph.microsoft.com/v1.0/sites/site/lists/assets/columns?$skiptoken=x"]) {
    await assert.rejects(create(graphFixture(foreign)).loadSnapshot(), /nextLink|pagin|inválid|invalido/i);
  }
});

test("default authenticated Graph uses the configured personal site and Sites.Read.All with GET only", async t => {
  const scopes = []; const urls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.method, "GET"); urls.push(url);
    const path = new URL(url).pathname;
    const payload = path.endsWith("/columns") ? { value: columns() } : path.endsWith("/items") ? { value: [] }
      : path.endsWith("/lists") ? { value: [{ id: "assets", displayName: "IMOBILIZADOS", list: { template: "genericList" } }] } : { id: "site" };
    return { ok: true, status: 200, async json() { return payload; } };
  });
  assert.deepEqual(await create({ async tokenProvider(requested, { signal }) { assert.ok(signal); scopes.push(requested); return "test-token"; } }).loadSnapshot(), { assets: [] });
  assert.ok(scopes.length); assert.ok(scopes.every(value => JSON.stringify(value) === '["Sites.Read.All"]'));
  assert.ok(urls.some(url => url.includes("energeticaltda-my.sharepoint.com") && url.includes("bernardonotini_energeticabr_com")));
});
