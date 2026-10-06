import test from "node:test";
import assert from "node:assert/strict";
import { createSharePointRepository } from "../../../portal/data/sharepoint-repository.js";

const data = await import("../src/chat/task-association-report-data.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
function create(options) {
  assert.equal(typeof data.createTaskAssociationReportData, "function", "createTaskAssociationReportData must be implemented");
  return data.createTaskAssociationReportData(options);
}
const headers = ["DATA IDENTIFICAÇÃO", "DATA FATAL", "TAREFA", "ASSOCIAÇÃO", "CONCLUÍDO", "PRIORITÁRIA", "DIFICULDADE", "REFERENTE"];
const columns = () => headers.map((displayName, i) => ({ name: `field_${i}`, displayName }));
const values = ["2026-10-01T23:30:00-03:00", "07/10/2026", " Revisar projeto ", " engenharia ", { Value: "ATIVIDADE CRIADA" }, ["ATIVIDADE EMERGENCIAL"], "MÉDIA", { LookupValue: "José" }];
const item = (id = 1, extra = {}) => ({ id: String(id), fields: { ID2: 999, ...Object.fromEntries(values.map((value, i) => [`field_${i}`, value])), ...extra } });
function fixture(overrides = {}) {
  return { repository: {
    async resolveList(site, aliases, { signal }) { assert.equal(site, "personal"); assert.deepEqual(aliases, ["LANCAMENTOTAREFAS"]); assert.ok(signal); return { status: "resolved", id: "tasks" }; },
    async getColumns(site, list, { signal }) { assert.equal(site, "personal"); assert.equal(list, "tasks"); assert.ok(signal); return columns(); },
    async getItemsPage(site, list, query, { signal }) {
      assert.equal(site, "personal"); assert.equal(list, "tasks"); assert.ok(signal);
      const params = new URLSearchParams(query);
      assert.equal(params.get("$expand"), "fields($select=field_0,field_1,field_2,field_3,field_4,field_5,field_6,field_7)");
      assert.equal(params.get("$top"), "100"); assert.equal(params.has("$filter"), false);
      return { items: [item()], hasMore: false, batchCount: 1 };
    },
    createItem() { assert.fail("writes forbidden"); }, updateItem() { assert.fail("writes forbidden"); }, deleteItem() { assert.fail("writes forbidden"); }, ...overrides,
  } };
}

test("loads the exact immutable task contract with actual SharePoint ID and resolved supplier label", async () => {
  const result = await create(fixture()).loadSnapshot();
  assert.deepEqual(result, { tasks: [{ id: 1, createdDate: "2026-10-01", dueDate: "2026-10-07", description: "Revisar projeto", association: "ENGENHARIA",
    status: "ATIVIDADE CRIADA", priority: "ATIVIDADE EMERGENCIAL", difficulty: "MÉDIA", supplier: "José" }] });
  for (const value of [result, result.tasks, result.tasks[0]]) assert.ok(Object.isFrozen(value));
});

test("schema resolves encoded accents and spaces, renamed Title and internal aliases", async () => {
  const names = ["DATAIDENTIFICACAO", "DATA_x0020_FATAL", "Title", "ASSOCIA_x00c7__x00c3_O", "CONCLU_x00cd_DO", "PRIORIT_x00c1_RIA", "DIFICULDADE", "REFERENTE"];
  const result = await create(fixture({ async getColumns() { return [{ name: "LinkTitle", displayName: "TAREFA" }, { name: "computed", displayName: "DATA FATAL", computed: {} },
    ...names.map((name, i) => ({ name, ...(i === 2 ? { displayName: "TAREFA", hidden: true } : {}) }))]; },
    async getItemsPage(_site, _list, query) { assert.equal(new URLSearchParams(query).get("$expand"), `fields($select=${names.join(",")})`);
      return { items: [{ id: "42", fields: Object.fromEntries(names.map((name, i) => [name, values[i]])) }], hasMore: false }; } })).loadSnapshot();
  assert.equal(result.tasks[0].id, 42); assert.equal(result.tasks[0].association, "ENGENHARIA");
});

test("all eight schema fields are mandatory even with an empty base and ambiguous or unsafe columns reject", async () => {
  for (const missing of headers) await assert.rejects(create(fixture({ async getColumns() { return columns().filter(column => column.displayName !== missing); } })).loadSnapshot(), /coluna|esquema/i);
  for (const mutate of [() => null, list => [...list, { name: "duplicate", displayName: "TAREFA" }],
    list => list.map((column, i) => i === 0 ? { ...column, name: "bad/name" } : column),
    list => list.map((column, i) => i === 0 ? { ...column, computed: true } : column),
    list => list.map((column, i) => i === 0 ? { ...column, name: "field_1" } : column)]) {
    await assert.rejects(create(fixture({ async getColumns() { return mutate(columns()); } })).loadSnapshot(), /coluna|esquema/i);
  }
});

test("complete pagination crosses 2000 tasks and repository windows without truncation", async () => {
  let calls = 0;
  const result = await create(fixture({ async getItemsPage(_site, _list, _query, options) {
    const page = ++calls;
    assert.equal(options.pageNumber, (page - 1) % 100 + 1); assert.equal(options.maxPages, 100);
    assert.equal(options.cursor || "", page === 1 ? "" : `page-${page}`);
    return { items: Array.from({ length: 21 }, (_, i) => item((page - 1) * 21 + i + 1)), hasMore: page < 102, nextLink: page < 102 ? `page-${page + 1}` : "", batchCount: 21 };
  } })).loadSnapshot();
  assert.equal(result.tasks.length, 2142); assert.equal(result.tasks.at(-1).id, 2142);
});

test("malformed or incomplete pages reject atomically", async () => {
  for (const page of [{ items: null, hasMore: false }, { items: Array(1), hasMore: false }, { items: [], hasMore: "false" },
    { items: [], hasMore: true, nextLink: "next" }, { items: [], hasMore: false, nextLink: "next" }, { items: [item()], hasMore: true },
    ...["error", "partial", "incomplete", "truncated", "aborted"].map(flag => ({ items: [], hasMore: false, [flag]: true })),
    { items: [], hasMore: false, complete: false }, { items: [], hasMore: false, batchCount: 1 }, { items: [], hasMore: false, nextLink: {} },
    { items: Array.from({ length: 101 }, (_, i) => item(i + 1)), hasMore: false }]) {
    await assert.rejects(create(fixture({ async getItemsPage() { return page; } })).loadSnapshot(), /página|pagin|incomplet|inválid|registro/i);
  }
});

test("duplicate IDs, repeated cursors and runaway pagination never return partial snapshots", async () => {
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

test("source blanks and 1900 dates remain valid while malformed values and unresolved lookups reject", async () => {
  const result = await create(fixture({ async getItemsPage() { return { items: [{ id: "1", fields: {} }, item(2, { field_1: "1900-01-01", field_4: "CANCELADO" })], hasMore: false }; } })).loadSnapshot();
  assert.equal(result.tasks[0].association, "SEM ASSOCIAÇÃO"); assert.equal(result.tasks[0].dueDate, "");
  assert.equal(result.tasks[1].dueDate, "1900-01-01"); assert.equal(result.tasks[1].status, "CANCELADO");
  for (const blank of [{ Value: "" }, { LookupValue: null }, { LookupId: null }, []]) {
    assert.equal((await create(fixture({ async getItemsPage() { return { items: [item(1, { field_7: blank })], hasMore: false }; } })).loadSnapshot()).tasks[0].supplier, "");
  }
  for (const bad of [null, { id: 1, fields: null }, { id: 1, fields: [] }, item(0), item(1, { field_0: "2026-02-30" }),
    item(1, { field_1: "31/04/2026" }), item(1, { field_2: {} }), item(1, { field_4: ["A", "B"] }), item(1, { field_7: { LookupId: 42 } }),
    item(1, { field_7: { Value: "", LookupId: 42 } })]) {
    await assert.rejects(create(fixture({ async getItemsPage() { return { items: [bad], hasMore: false }; } })).loadSnapshot(), /ID|registro|campo|data|lookup/i);
  }
  for (let i = 0; i < headers.length; i++) await assert.rejects(create(fixture({ async getItemsPage() {
    return { items: [item(1, { [`field_${i}`]: "", [`field_${i}LookupId`]: "42" })], hasMore: false };
  } })).loadSnapshot(), /lookup/i);
});

test("later page failure discards previous rows and subsequent loads can recover", async () => {
  for (const mode of ["error", "date"]) {
    let fail = true;
    const service = create(fixture({ async getItemsPage(_site, _list, _query, { cursor }) {
      if (cursor && fail && mode === "error") throw new Error("503 source unavailable");
      return { items: [item(cursor ? 2 : 1, cursor && fail ? { field_1: "2026-02-30" } : {})], hasMore: !cursor, nextLink: cursor ? "" : "next" };
    } }));
    await assert.rejects(service.loadSnapshot(), /503|data/i); fail = false;
    assert.deepEqual((await service.loadSnapshot()).tasks.map(row => row.id), [1, 2]);
  }
});

test("abort settles pre-cancelled and stalled repository and token operations with the exact reason", { timeout: 2000 }, async () => {
  const pre = new AbortController(); pre.abort(); await assert.rejects(create(fixture()).loadSnapshot({ signal: pre.signal }), /abort|cancel/i);
  for (const method of ["resolveList", "getColumns", "getItemsPage", "tokenProvider"]) {
    let started; const ready = new Promise(resolve => { started = resolve; }); const controller = new AbortController();
    const stalled = () => { started(); return new Promise(() => {}); };
    const pending = create(method === "tokenProvider" ? { tokenProvider: stalled } : fixture({ [method]: stalled })).loadSnapshot({ signal: controller.signal });
    await ready; const reason = new Error("caller cancellation"); controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
  }
});

test("late cancellation rejects even the final page", async () => {
  const controller = new AbortController(); const reason = new Error("late cancellation");
  await assert.rejects(create(fixture({ async getItemsPage() { controller.abort(reason); return { items: [item()], hasMore: false }; } })).loadSnapshot({ signal: controller.signal }), error => error === reason);
});

test("missing session, repository and list fail explicitly and spaced alias resolves", async () => {
  assert.throws(() => create(), /sessão/i); assert.throws(() => create({ repository: {} }), /repositório/i);
  const aliasesRead = [];
  const options = fixture({ async resolveList(site, aliases) { aliasesRead.push(aliases); return aliases[0] === "LANCAMENTO TAREFAS" ? { status: "resolved", id: "tasks" } : { status: "missing" }; } });
  assert.equal((await create(options).loadSnapshot()).tasks.length, 1);
  assert.deepEqual(aliasesRead, [["LANCAMENTOTAREFAS"], ["LANCAMENTO TAREFAS"]]);
  await assert.rejects(create(fixture({ async resolveList() { return { status: "missing" }; } })).loadSnapshot(), /TAREFAS/);
});

function graphFixture(foreign = "") {
  const requests = [];
  const repository = createSharePointRepository({ async request(path, options = {}) {
    assert.equal(options.method || "GET", "GET"); requests.push(path);
    if (path.includes("/lists?")) return { value: [{ id: "unrelated", displayName: "DOCUMENTOS" }, { id: "tasks", displayName: "LANCAMENTO TAREFAS", list: { template: "genericList" } }] };
    if (path.includes("/columns")) { assert.ok(path.includes("/lists/tasks/")); return { value: path.includes("skiptoken") ? columns().slice(2) : columns().slice(0, 2),
      ...(path.includes("skiptoken") ? {} : { "@odata.nextLink": "https://graph.microsoft.com/v1.0/sites/site/lists/tasks/columns?$skiptoken=next" }) }; }
    if (path.includes("/items")) { assert.ok(path.includes("/lists/tasks/")); const second = path.includes("skiptoken");
      return { value: [item(second ? 2 : 1)], ...(second ? {} : { "@odata.nextLink": foreign || "https://graph.microsoft.com/v1.0/sites/site/lists/tasks/items?$skiptoken=next" }) }; }
    return { id: "site" };
  } }, { personal: { host: "example.sharepoint.com", path: "/personal/test", readTransport: "graph" } });
  return { repository, requests };
}

test("real repository reads only source tasks with paginated columns and items", async () => {
  const source = graphFixture(); const result = await create(source).loadSnapshot();
  assert.deepEqual(result.tasks.map(row => row.id), [1, 2]);
  assert.ok(source.requests.some(path => path.includes("columns?$skiptoken")));
});

test("real repository rejects cursors to a foreign host, site, list or collection", async () => {
  for (const foreign of ["https://evil.example/items", "https://graph.microsoft.com/v1.0/sites/other/lists/tasks/items?$skiptoken=x",
    "https://graph.microsoft.com/v1.0/sites/site/lists/other/items?$skiptoken=x", "https://graph.microsoft.com/v1.0/sites/site/lists/tasks/columns?$skiptoken=x"]) {
    await assert.rejects(create(graphFixture(foreign)).loadSnapshot(), /nextLink|pagin|inválid|invalido/i);
  }
});

test("authenticated default transport reads the personal site using GET and Sites.Read.All only", async t => {
  const scopes = []; const urls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.method, "GET"); assert.equal(options.headers.Authorization, "Bearer test-token"); urls.push(url);
    const path = new URL(url).pathname;
    const payload = path.endsWith("/columns") ? { value: columns() } : path.endsWith("/items") ? { value: [item()] }
      : path.endsWith("/lists") ? { value: [{ id: "tasks", displayName: "LANCAMENTOTAREFAS", list: { template: "genericList" } }] } : { id: "site" };
    return { ok: true, status: 200, async json() { return payload; } };
  });
  assert.equal((await create({ async tokenProvider(requested, { signal }) { assert.ok(signal); scopes.push(requested); return "test-token"; } }).loadSnapshot()).tasks[0].id, 1);
  assert.ok(scopes.length); assert.ok(scopes.every(value => JSON.stringify(value) === '["Sites.Read.All"]'));
  assert.ok(urls.some(url => url.includes("energeticaltda-my.sharepoint.com") && url.includes("bernardonotini_energeticabr_com")));
  assert.ok(urls.every(url => !url.includes("energeticaltda.sharepoint.com")), "the company site must not be queried for a personal task report");
  assert.ok(urls.filter(url => /\/(items|columns)/.test(url)).every(url => url.includes("/lists/tasks/")));
});

test("unavailable authentication never issues an unauthenticated SharePoint request", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("no request without a token"));
  for (const tokenProvider of [async () => "", async () => { throw new Error("session expired"); }]) {
    await assert.rejects(create({ tokenProvider }).loadSnapshot(), /token|session expired/i);
  }
});
