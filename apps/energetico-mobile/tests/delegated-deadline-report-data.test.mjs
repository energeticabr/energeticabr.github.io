import test from "node:test";
import assert from "node:assert/strict";
import { createSharePointRepository } from "../../../portal/data/sharepoint-repository.js";
import { buildDelegatedDeadlineOverview } from "../src/chat/delegated-deadline-report-model.js";

const data = await import("../src/chat/delegated-deadline-report-data.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
function create(options) {
  assert.equal(typeof data.createDelegatedDeadlineReportData, "function", "createDelegatedDeadlineReportData must be implemented");
  return data.createDelegatedDeadlineReportData(options);
}
const names = ["DATAIDENTIFICACAO", "DATAFATAL", "TAREFA", "ASSOCIACAO", "CONCLU_x00cd_DO", "PRIORIT_x00c1_RIA", "DIFICULDADE", "RESPONS_x00c1_VEL"];
const titles = ["DATA IDENTIFICAÇÃO", "DATA FATAL", "TAREFA", "ASSOCIAÇÃO", "CONCLUÍDO", "PRIORITÁRIA", "DIFICULDADE", "RESPONSÁVEL"];
const columns = () => names.map((name, i) => ({ name, displayName: titles[i] }));
const values = ["2026-10-01T23:30:00-03:00", "07/10/2026", " Revisar projeto ", " Engenharia ",
  { Value: " atividade criada " }, ["atividade emergencial"], "MÉDIA", { LookupValue: " José " }];
const item = (id = 1, extra = {}) => ({ id: String(id), fields: { ID2: 999,
  ...Object.fromEntries(names.map((name, i) => [name, values[i]])), ...extra } });
function fixture(overrides = {}) {
  return { repository: {
    async resolveList(site, aliases, { signal }) {
      assert.equal(site, "personal"); assert.deepEqual(aliases, ["TAREFASDELEGADAS"]); assert.ok(signal);
      return { status: "resolved", id: "delegated" };
    },
    async getColumns(site, list, { signal }) { assert.equal(site, "personal"); assert.equal(list, "delegated"); assert.ok(signal); return columns(); },
    async getItemsPage(site, list, query, { signal, headers }) {
      assert.equal(site, "personal"); assert.equal(list, "delegated"); assert.ok(signal);
      assert.deepEqual(headers, { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" });
      const params = new URLSearchParams(query);
      assert.equal(params.get("$expand"), `fields($select=${names.join(",")})`);
      assert.equal(params.get("$top"), "100"); assert.equal(params.has("$filter"), false);
      return { items: [item()], hasMore: false, batchCount: 1 };
    },
    createItem() { assert.fail("writes forbidden"); }, updateItem() { assert.fail("writes forbidden"); }, deleteItem() { assert.fail("writes forbidden"); },
    ...overrides,
  } };
}

test("loads actual delegated list schema and item ID into the frozen model contract", async () => {
  const result = await create(fixture()).loadSnapshot();
  assert.deepEqual(result, { tasks: [{ id: 1, createdDate: "2026-10-01", dueDate: "2026-10-07", description: "Revisar projeto",
    association: "Engenharia", status: "ATIVIDADE CRIADA", priority: "ATIVIDADE EMERGENCIAL", difficulty: "MÉDIA", responsible: "JOSÉ",
    createdSort: Date.UTC(2026, 9, 2, 2, 30) }] });
  for (const value of [result, result.tasks, result.tasks[0]]) assert.ok(Object.isFrozen(value));
});

test("resolves encoded internal aliases, renamed Title and ignores all computed LinkTitle auxiliaries", async () => {
  const aliases = ["OData_DATAIDENTIFICACAO", "DATA_x0020_FATAL", "Title", "ASSOCIA_x00c7__x00c3_O", "CONCLU_x00cd_DO", "PRIORIT_x00c1_RIA", "DIFICULDADE", "RESPONS_x00c1_VEL"];
  const result = await create(fixture({ async getColumns() {
    return [...["LinkTitle", "LinkTitleNoMenu", "LinkTitle2", "LinkTitle7"].map(name => ({ name, displayName: "TAREFA" })),
      { name: "computed", displayName: "DATA FATAL", computed: {} },
      ...aliases.map((name, i) => ({ name, ...(i === 2 ? { displayName: "TAREFA", hidden: true } : {}) }))];
  }, async getItemsPage(_site, _list, query) {
    assert.equal(new URLSearchParams(query).get("$expand"), `fields($select=${aliases.join(",")})`);
    return { items: [{ id: "42", fields: Object.fromEntries(aliases.map((name, i) => [name, values[i]])) }], hasMore: false };
  } })).loadSnapshot();
  assert.equal(result.tasks[0].id, 42); assert.equal(result.tasks[0].responsible, "JOSÉ");
});

test("requires all eight fields and rejects real ambiguity or unsafe shared columns before rows", async () => {
  for (const missing of names) await assert.rejects(create(fixture({ async getColumns() { return columns().filter(column => column.name !== missing); } })).loadSnapshot(), /coluna|esquema/i);
  for (const mutate of [() => null, list => [...list, { name: "duplicate", displayName: "RESPONSÁVEL" }],
    list => list.map((column, i) => i === 0 ? { ...column, name: "bad/name" } : column),
    list => list.map((column, i) => i === 0 ? { ...column, computed: true } : column),
    list => list.map((column, i) => i === 0 ? { ...column, name: names[1] } : column)]) {
    await assert.rejects(create(fixture({ async getColumns() { return mutate(columns()); } })).loadSnapshot(), /coluna|esquema/i);
  }
});

test("complete pagination crosses 2000 tasks and 100 page windows without a source cutoff", async () => {
  let calls = 0;
  const result = await create(fixture({ async getItemsPage(_site, _list, _query, options) {
    const page = ++calls;
    assert.equal(options.pageNumber, (page - 1) % 100 + 1); assert.equal(options.maxPages, 100);
    assert.equal(options.cursor || "", page === 1 ? "" : `page-${page}`);
    return { items: Array.from({ length: 21 }, (_, i) => item((page - 1) * 21 + i + 1)), hasMore: page < 102,
      nextLink: page < 102 ? `page-${page + 1}` : "", batchCount: 21 };
  } })).loadSnapshot();
  assert.equal(result.tasks.length, 2142); assert.equal(result.tasks.at(-1).id, 2142);
});

test("malformed, incomplete or inconsistent pagination cannot return a snapshot", async () => {
  for (const page of [{ items: null, hasMore: false }, { items: Array(1), hasMore: false }, { items: [], hasMore: "false" },
    { items: [], hasMore: true, nextLink: "next" }, { items: [], hasMore: false, nextLink: "next" }, { items: [item()], hasMore: true },
    ...["error", "partial", "incomplete", "truncated", "aborted"].map(flag => ({ items: [], hasMore: false, [flag]: true })),
    { items: [], hasMore: false, complete: false }, { items: [], hasMore: false, batchCount: 1 }, { items: [], hasMore: false, nextLink: {} },
    { items: Array.from({ length: 101 }, (_, i) => item(i + 1)), hasMore: false }]) {
    await assert.rejects(create(fixture({ async getItemsPage() { return page; } })).loadSnapshot(), /página|pagin|incomplet|inválid|registro/i);
  }
});

test("duplicate item IDs, cursor cycles and runaway pagination reject atomically", async () => {
  for (const mode of ["same-page", "cross-page", "cycle", "runaway"]) {
    let calls = 0;
    await assert.rejects(create(fixture({ async getItemsPage() {
      calls++;
      if (mode === "same-page") return { items: [item(1), item("01")], hasMore: false };
      return { items: [item(mode === "cross-page" ? 1 : calls)], hasMore: true, nextLink: mode === "runaway" ? `next-${calls}` : "same" };
    } })).loadSnapshot(), /duplic|ciclo|cursor|limite|parcial/i);
    if (mode === "runaway") assert.equal(calls, 10000);
  }
});

test("accepts blanks, label wrappers, unknown statuses and genuine 1900 dates", async () => {
  const result = await create(fixture({ async getItemsPage() {
    return { items: [{ id: "1", fields: {} }, item(2, { DATAFATAL: "1900-01-01", CONCLU_x00cd_DO: "CANCELADO" })], hasMore: false };
  } })).loadSnapshot();
  assert.equal(result.tasks[0].association, ""); assert.equal(result.tasks[0].dueDate, null); assert.equal(result.tasks[0].responsible, "SEM RESPONSÁVEL");
  assert.equal(result.tasks[1].dueDate, "1900-01-01"); assert.equal(result.tasks[1].status, "CANCELADO");
  for (const blank of [{ Value: "" }, { LookupValue: null }, { LookupId: null }, []]) {
    const snapshot = await create(fixture({ async getItemsPage() { return { items: [item(1, { RESPONS_x00c1_VEL: blank })], hasMore: false }; } })).loadSnapshot();
    assert.equal(snapshot.tasks[0].responsible, "SEM RESPONSÁVEL");
  }
});

test("rejects invalid records, dates and unresolved lookups instead of presenting empty labels", async () => {
  for (const bad of [null, { id: 1, fields: null }, { id: 1, fields: [] }, item(0), item(1, { DATAIDENTIFICACAO: "2026-02-30" }),
    item(1, { DATAFATAL: "31/04/2026" }), item(1, { TAREFA: {} }), item(1, { CONCLU_x00cd_DO: ["A", "B"] }),
    item(1, { RESPONS_x00c1_VEL: { LookupId: 42 } }), item(1, { RESPONS_x00c1_VEL: { Value: "", LookupId: 42 } }),
    { fields: { ID2: 42, ...item().fields } }]) {
    await assert.rejects(create(fixture({ async getItemsPage() { return { items: [bad], hasMore: false }; } })).loadSnapshot(), /ID|registro|campo|data|lookup/i);
  }
  for (const name of names) await assert.rejects(create(fixture({ async getItemsPage() {
    return { items: [item(1, { [name]: "", [`${name}LookupId`]: "42" })], hasMore: false };
  } })).loadSnapshot(), /lookup/i);
});

test("later page failure exposes no partial data and a subsequent load can recover", async () => {
  for (const mode of ["error", "date"]) {
    let fail = true;
    const service = create(fixture({ async getItemsPage(_site, _list, _query, { cursor }) {
      if (cursor && fail && mode === "error") throw new Error("503 source unavailable");
      return { items: [item(cursor ? 2 : 1, cursor && fail ? { DATAFATAL: "2026-02-30" } : {})], hasMore: !cursor, nextLink: cursor ? "" : "next" };
    } }));
    await assert.rejects(service.loadSnapshot(), /503|data/i); fail = false;
    assert.deepEqual((await service.loadSnapshot()).tasks.map(row => row.id), [1, 2]);
  }
});

test("source datetime survives item and full-base normalization for same-day descending detail", async () => {
  const snapshot = await create(fixture({ async getItemsPage(_site, _list, _query, { cursor }) {
    return { items: [item(cursor ? 2 : 1, { DATAIDENTIFICACAO: cursor ? "2026-10-07T18:00:00Z" : "2026-10-07T08:00:00Z" })],
      hasMore: !cursor, nextLink: cursor ? "" : "next" };
  } })).loadSnapshot();
  assert.deepEqual(snapshot.tasks.map(row => [row.createdDate, row.createdSort]), [
    ["2026-10-07", Date.UTC(2026, 9, 7, 8)], ["2026-10-07", Date.UTC(2026, 9, 7, 18)],
  ]);
  const result = buildDelegatedDeadlineOverview(snapshot, {}, "2026-10-07");
  assert.deepEqual(result.groups[0].responsibles[0].tasks.map(row => row.id), [2, 1]);
});

test("abort settles pre-cancelled and stalled repository and token operations with exact reason", { timeout: 2000 }, async () => {
  const pre = new AbortController(); pre.abort(); await assert.rejects(create(fixture()).loadSnapshot({ signal: pre.signal }), /abort|cancel/i);
  for (const method of ["resolveList", "getColumns", "getItemsPage", "tokenProvider"]) {
    let started; const ready = new Promise(resolve => { started = resolve; }); const controller = new AbortController();
    const stalled = () => { started(); return new Promise(() => {}); };
    const pending = create(method === "tokenProvider" ? { tokenProvider: stalled } : fixture({ [method]: stalled })).loadSnapshot({ signal: controller.signal });
    await ready; const reason = new Error("caller cancellation"); controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
  }
});

test("cancellation on the last page rejects instead of returning the loaded rows", async () => {
  const controller = new AbortController(); const reason = new Error("late cancellation");
  await assert.rejects(create(fixture({ async getItemsPage() { controller.abort(reason); return { items: [item()], hasMore: false }; } })).loadSnapshot({ signal: controller.signal }), error => error === reason);
});

test("missing session, invalid repository, missing list and spaced list alias are explicit", async () => {
  assert.throws(() => create(), /sessão/i); assert.throws(() => create({ repository: {} }), /repositório/i);
  const aliasesRead = [];
  const result = await create(fixture({ async resolveList(_site, aliases) {
    aliasesRead.push(aliases); return aliases[0] === "TAREFAS DELEGADAS" ? { status: "resolved", id: "delegated" } : { status: "missing" };
  } })).loadSnapshot();
  assert.equal(result.tasks.length, 1); assert.deepEqual(aliasesRead, [["TAREFASDELEGADAS"], ["TAREFAS DELEGADAS"]]);
  for (const list of [null, { status: "missing" }, { status: "resolved" }]) {
    await assert.rejects(create(fixture({ async resolveList() { return list; } })).loadSnapshot(), /lista/i);
  }
});

function graphFixture(foreign) {
  const requests = [];
  const root = "https://graph.microsoft.com/v1.0/sites/site/lists/delegated";
  const graph = { async request(path, options = {}) {
    requests.push(path); assert.equal(options.method || "GET", "GET");
    if (path.includes("columns?$skiptoken")) return { value: columns().slice(4) };
    if (path.endsWith("/columns")) return { value: columns().slice(0, 4), "@odata.nextLink": `${root}/columns?$skiptoken=metadata` };
    if (path.includes("items?$skiptoken")) return { value: [item(2)] };
    if (path.includes("/items?")) return { value: [item()], "@odata.nextLink": foreign || `${root}/items?$skiptoken=items` };
    if (path.includes("/lists?")) return { value: [{ id: "delegated", displayName: "TAREFASDELEGADAS", list: { template: "genericList" } }] };
    return { id: "site" };
  } };
  return { repository: createSharePointRepository(graph, { personal: { host: "tenant.sharepoint.com", path: "/personal/owner" } }), requests };
}

test("real repository reads two pages of column metadata and item data using GET only", async () => {
  const source = graphFixture(); const result = await create(source).loadSnapshot();
  assert.deepEqual(result.tasks.map(row => row.id), [1, 2]);
  assert.ok(source.requests.some(path => path.includes("columns?$skiptoken")));
  assert.ok(source.requests.some(path => path.includes("items?$skiptoken")));
});

test("real repository rejects cursors to a foreign host, site, list or collection", async () => {
  for (const foreign of ["https://evil.example/items", "https://graph.microsoft.com/v1.0/sites/other/lists/delegated/items?$skiptoken=x",
    "https://graph.microsoft.com/v1.0/sites/site/lists/other/items?$skiptoken=x", "https://graph.microsoft.com/v1.0/sites/site/lists/delegated/columns?$skiptoken=x"]) {
    await assert.rejects(create(graphFixture(foreign)).loadSnapshot(), /nextLink|pagin|inválid|invalido/i);
  }
});

test("default authenticated transport reads SHAREPOINT_SITES.personal with GET and Sites.Read.All", async t => {
  const scopes = []; const urls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.method, "GET"); assert.equal(options.headers.Authorization, "Bearer test-token"); urls.push(url);
    const path = new URL(url).pathname;
    const payload = path.endsWith("/columns") ? { value: columns() } : path.endsWith("/items") ? { value: [item()] }
      : path.endsWith("/lists") ? { value: [{ id: "delegated", displayName: "TAREFASDELEGADAS", list: { template: "genericList" } }] } : { id: "site" };
    return { ok: true, status: 200, async json() { return payload; } };
  });
  const result = await create({ async tokenProvider(requested, { signal }) { assert.ok(signal); scopes.push(requested); return "test-token"; } }).loadSnapshot();
  assert.equal(result.tasks[0].id, 1);
  assert.ok(scopes.length); assert.ok(scopes.every(value => JSON.stringify(value) === '["Sites.Read.All"]'));
  assert.ok(urls.some(url => url.includes("energeticaltda-my.sharepoint.com") && url.includes("bernardonotini_energeticabr_com")));
  assert.ok(urls.filter(url => /\/(items|columns)/.test(url)).every(url => url.includes("/lists/delegated/")));
});

test("authentication failure never issues an unauthenticated network request", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("no request without a token"));
  for (const tokenProvider of [async () => "", async () => { throw new Error("session expired"); }]) {
    await assert.rejects(create({ tokenProvider }).loadSnapshot(), /token|session expired/i);
  }
});
