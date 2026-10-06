import test from "node:test";
import assert from "node:assert/strict";
import { createSharePointRepository } from "../../../portal/data/sharepoint-repository.js";

const data = await import("../src/chat/document-control-report-data.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
function create(options) {
  assert.equal(typeof data.createDocumentControlReportData, "function", "createDocumentControlReportData must be implemented");
  return data.createDocumentControlReportData(options);
}
const headers = ["DATA SUBMETIDO", "DATA", "DATAVALIDADE", "FILIAL", "TIPOHOMOLOGACAO", "TIPODOCUMENTO", "PESSOA RELACIONADA", "ETAPA", "IMÓVEL", "STATUS"];
const columns = () => headers.map((displayName, index) => ({ name: `field_${index}`, displayName }));
const values = ["2026-10-05T23:30:00-03:00", "30/09/2026", "2026-10-21", " A ", { LookupValue: "FEDERAL" }, ["CERTIDÃO"], { Value: "José" }, "Obra", "Casa 1", "SUBMETIDO"];
const item = (id = 1, extra = {}) => ({ id: String(id), fields: { ...Object.fromEntries(values.map((value, index) => [`field_${index}`, value])), ...extra } });
function fixture(overrides = {}) {
  return { repository: {
    async resolveList(site, aliases, { signal }) {
      assert.equal(site, "personal"); assert.deepEqual(aliases, ["DOCUMENTOS_1"]); assert.ok(signal);
      return { status: "resolved", id: "documents" };
    },
    async getColumns(site, list, { signal }) { assert.equal(site, "personal"); assert.equal(list, "documents"); assert.ok(signal); return columns(); },
    async getItemsPage(site, list, query, { signal }) {
      assert.equal(site, "personal"); assert.equal(list, "documents"); assert.ok(signal);
      const parameters = new URLSearchParams(query);
      assert.equal(parameters.get("$expand"), "fields($select=field_0,field_1,field_2,field_3,field_4,field_5,field_6,field_7,field_8,field_9)");
      assert.equal(parameters.get("$top"), "100"); assert.equal(parameters.has("$filter"), false);
      return { items: [item()], hasMore: false, batchCount: 1 };
    },
    createItem() { assert.fail("writes forbidden"); }, updateItem() { assert.fail("writes forbidden"); }, deleteItem() { assert.fail("writes forbidden"); },
    ...overrides,
  } };
}

test("personal documents schema loads a complete immutable normalized metadata snapshot", async () => {
  const result = await create(fixture()).loadSnapshot();
  assert.deepEqual(result, { documents: [{ id: 1, submittedDate: "2026-10-05", issuedDate: "2026-09-30", expirationDate: "2026-10-21",
    branch: "A", homologation: "FEDERAL", documentType: "CERTIDÃO", person: "José", stage: "Obra", property: "Casa 1", status: "SUBMETIDO" }] });
  for (const value of [result, result.documents, result.documents[0]]) assert.ok(Object.isFrozen(value));
});

test("registration aliases encoded accents and renamed Title resolve the actual internal columns", async () => {
  const names = ["DATASUBMETIDO", "DATA", "DATAVALIDADE", "Title", "TIPOHOMOLOGACAO", "TIPODOCUMENTO", "PESSOARELACIONADA", "ETAPA", "IM_x00d3_VEL", "STATUS"];
  const result = await create(fixture({ async getColumns() { return [
    { name: "LinkTitle", displayName: "FILIAL" }, { name: "computed", displayName: "DATA", computed: {} },
    ...names.map((name, index) => ({ name, ...(index === 3 ? { displayName: "FILIAL", hidden: true } : {}) })),
  ]; }, async getItemsPage(_site, _list, query) {
    assert.equal(new URLSearchParams(query).get("$expand"), `fields($select=${names.join(",")})`);
    return { items: [{ id: "2", fields: Object.fromEntries(names.map((name, index) => [name, values[index]])) }], hasMore: false };
  } })).loadSnapshot();
  assert.equal(result.documents[0].branch, "A"); assert.equal(result.documents[0].property, "Casa 1");
});

test("all ten fields are mandatory even for an empty list and ambiguous unsafe computed schemas reject", async () => {
  for (const missing of headers) {
    await assert.rejects(create(fixture({ async getColumns() { return columns().filter(column => column.displayName !== missing); },
      async getItemsPage() { return { items: [], hasMore: false }; } })).loadSnapshot(), /coluna|esquema/i);
  }
  for (const mutate of [() => null, list => [...list, { name: "duplicate", displayName: "FILIAL" }],
    list => list.map((column, i) => i === 0 ? { ...column, name: "bad/name" } : column),
    list => list.map((column, i) => i === 0 ? { ...column, computed: true } : column),
    list => list.map((column, i) => i === 0 ? { ...column, name: "field_1" } : column)]) {
    await assert.rejects(create(fixture({ async getColumns() { return mutate(columns()); } })).loadSnapshot(), /coluna|esquema/i);
  }
});

test("missing source values are blanks while all statuses and expired or future documents remain in the base", async () => {
  const result = await create(fixture({ async getItemsPage() { return { items: [{ id: "1", fields: {} },
    item(2, { field_9: "CANCELADO", field_2: "1990-01-01" }), item(3, { field_9: "APROVADO", field_2: "2099-01-01" })], hasMore: false }; } })).loadSnapshot();
  assert.ok(Object.values(result.documents[0]).slice(1).every(value => value === ""));
  assert.deepEqual(result.documents.map(value => [value.id, value.status]), [[1, ""], [2, "CANCELADO"], [3, "APROVADO"]]);
});

test("empty choice or lookup labels stay blank while populated unresolved IDs reject", async () => {
  for (const blank of [{ Value: "" }, { LookupValue: null }, { LookupId: null }, { LookupValue: "", LookupId: "" }, []]) {
    const result = await create(fixture({ async getItemsPage() { return { items: [item(1, { field_6: blank })], hasMore: false }; } })).loadSnapshot();
    assert.equal(result.documents[0].person, "");
  }
  for (const unresolved of [{ Value: "", LookupId: "42" }, { LookupValue: null, LookupId: 42 }]) {
    await assert.rejects(create(fixture({ async getItemsPage() {
      return { items: [item(1, { field_6: unresolved })], hasMore: false };
    } })).loadSnapshot(), /lookup/i);
  }
});

test("pagination crosses repository windows and 2000 records without a truncated snapshot", async () => {
  let calls = 0;
  const result = await create(fixture({ async getItemsPage(_site, _list, _query, options) {
    const page = ++calls;
    assert.equal(options.pageNumber, (page - 1) % 100 + 1); assert.equal(options.maxPages, 100);
    assert.equal(options.cursor || "", page === 1 ? "" : `page-${page}`);
    return { items: Array.from({ length: 21 }, (_, i) => item((page - 1) * 21 + i + 1)), hasMore: page < 102,
      nextLink: page < 102 ? `page-${page + 1}` : "", batchCount: 21 };
  } })).loadSnapshot();
  assert.equal(result.documents.length, 2142); assert.equal(result.documents[2141].id, 2142);
});

test("malformed partial inconsistent empty continuation and oversized pages reject atomically", async () => {
  for (const page of [{ items: null, hasMore: false }, { items: Array(1), hasMore: false }, { items: [], hasMore: "false" },
    { items: [], hasMore: true, nextLink: "next" }, { items: [], hasMore: false, nextLink: "next" }, { items: [item()], hasMore: true },
    ...["error", "partial", "incomplete", "truncated", "aborted"].map(flag => ({ items: [], hasMore: false, [flag]: true })),
    { items: [], hasMore: false, complete: false }, { items: [], hasMore: false, batchCount: 1 }, { items: [], hasMore: false, nextLink: {} },
    { items: Array.from({ length: 101 }, (_, i) => item(i + 1)), hasMore: false }]) {
    await assert.rejects(create(fixture({ async getItemsPage() { return page; } })).loadSnapshot(), /página|pagin|incomplet|inválid|registro/i);
  }
});

test("duplicate normalized IDs cursor cycles and runaway pagination never expose partial records", async () => {
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

test("invalid dates records scalar arrays and unresolved lookup-only objects reject", async () => {
  for (const bad of [null, { id: 1, fields: null }, { id: 1, fields: [] }, item(0), item(1, { field_0: "2026-02-30" }),
    item(1, { field_1: "31/04/2026" }), item(1, { field_2: "bad" }), item(1, { field_3: {} }), item(1, { field_4: ["A", "B"] }),
    item(1, { field_6: { LookupId: 42 } }), item(1, { field_6: [{ LookupId: 42 }] })]) {
    await assert.rejects(create(fixture({ async getItemsPage() { return { items: [bad], hasMore: false }; } })).loadSnapshot(), /ID|registro|campo|data|lookup/i);
  }
  for (let index = 0; index < headers.length; index++) {
    await assert.rejects(create(fixture({ async getItemsPage() {
      return { items: [item(1, { [`field_${index}`]: "", [`field_${index}LookupId`]: "42" })], hasMore: false };
    } })).loadSnapshot(), /lookup/i);
  }
});

test("a failure or invalid date on a later page discards all rows and a new load can succeed", async () => {
  for (const mode of ["error", "date"]) {
    let calls = 0; let fail = true;
    const service = create(fixture({ async getItemsPage() {
      calls++;
      if (calls === 2 && fail && mode === "error") throw new Error("503 source unavailable");
      return { items: [item(calls, calls === 2 && fail ? { field_2: "2026-02-30" } : {})], hasMore: calls === 1, nextLink: calls === 1 ? "next" : "" };
    } }));
    await assert.rejects(service.loadSnapshot(), /503|data/i); fail = false;
    assert.equal((await service.loadSnapshot()).documents.length, 1);
  }
});

test("pre abort and stalled operations settle even when repository or token provider ignores the signal", { timeout: 2000 }, async () => {
  const pre = new AbortController(); pre.abort(); await assert.rejects(create(fixture()).loadSnapshot({ signal: pre.signal }), /abort|cancel/i);
  for (const method of ["resolveList", "getColumns", "getItemsPage", "tokenProvider"]) {
    let started; const ready = new Promise(resolve => { started = resolve; }); const controller = new AbortController();
    const stalled = () => { started(); return new Promise(() => {}); };
    const pending = create(method === "tokenProvider" ? { tokenProvider: stalled } : fixture({ [method]: stalled })).loadSnapshot({ signal: controller.signal });
    await ready; const reason = new Error("caller cancellation"); controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
  }
});

test("late cancellation rejects the completed page with the exact caller reason", async () => {
  const controller = new AbortController(); const reason = new Error("late cancellation");
  await assert.rejects(create(fixture({ async getItemsPage() { controller.abort(reason); return { items: [item()], hasMore: false }; } }))
    .loadSnapshot({ signal: controller.signal }), error => error === reason);
});

test("missing list session and invalid repository fail explicitly", async () => {
  await assert.rejects(create(fixture({ async resolveList() { return { status: "missing" }; } })).loadSnapshot(), /DOCUMENTOS/);
  assert.throws(() => create(), /sessão/i); assert.throws(() => create({ repository: {} }), /repositório/i);
});

function graphFixture({ foreign = "", unresolved = false } = {}) {
  const requests = [];
  const repository = createSharePointRepository({ async request(path, options = {}) {
    assert.equal(options.method || "GET", "GET"); requests.push(path);
    if (path.includes("/lists?")) return { value: [{ id: "documents", displayName: "DOCUMENTOS", list: { template: "genericList" } }] };
    if (path.includes("/columns")) return { value: path.includes("skiptoken") ? columns().slice(2) : columns().slice(0, 2),
      ...(path.includes("skiptoken") ? {} : { "@odata.nextLink": "https://graph.microsoft.com/v1.0/sites/site/lists/documents/columns?$skiptoken=next" }) };
    if (path.includes("/items")) {
      const second = path.includes("skiptoken"); const fields = item().fields;
      fields.field_6LookupId = "42";
      if (second && unresolved) delete fields.field_6;
      else fields.field_6 = "José";
      return { value: [{ id: second ? "2" : "1", fields }], ...(second ? {} : {
        "@odata.nextLink": foreign || "https://graph.microsoft.com/v1.0/sites/site/lists/documents/items?$skiptoken=next",
      }) };
    }
    return { id: "site" };
  } }, { personal: { host: "example.sharepoint.com", path: "/personal/test", readTransport: "graph" } });
  return { repository, requests };
}

test("PowerFx DOCUMENTOS_1 wins over physical DOCUMENTOS regardless of enumeration order", async () => {
  for (const reversed of [false, true]) {
    const lists=[{id:"physical",displayName:"DOCUMENTOS",list:{template:"genericList"}},{id:"alias",displayName:"DOCUMENTOS_1",list:{template:"genericList"}}];
    const reads=[];
    const repository=createSharePointRepository({async request(path){
      if(path.includes("/lists?"))return {value:reversed?[...lists].reverse():lists};
      if(path.includes("/columns")){reads.push(path);return {value:columns()};}
      if(path.includes("/items"))return {value:[item(path.includes("/alias/")?42:9)]};
      return {id:"site"};
    }},{personal:{host:"example.sharepoint.com",path:"/personal/test",readTransport:"graph"}});
    const result=await create({repository}).loadSnapshot();
    assert.equal(result.documents[0].id,42);
    assert.ok(reads.every(path=>path.includes("/lists/alias/")));
  }
});

test("real repository resolves DOCUMENTOS and paginated schema and lookup labels via selected fields using GET only", async () => {
  const source = graphFixture(); const result = await create(source).loadSnapshot();
  assert.deepEqual(result.documents.map(value => [value.id, value.person]), [[1, "José"], [2, "José"]]);
  assert.ok(source.requests.some(path => path.includes("columns?$skiptoken")));
  assert.equal(new URL(source.requests.find(path => path.includes("/items")), "https://graph.microsoft.com").searchParams.get("$expand"),
    "fields($select=field_0,field_1,field_2,field_3,field_4,field_5,field_6,field_7,field_8,field_9)");
  await assert.rejects(create(graphFixture({ unresolved: true })).loadSnapshot(), /lookup/i);
});

test("real repository rejects foreign host site list and collection cursors", async () => {
  for (const foreign of ["https://evil.example/items", "https://graph.microsoft.com/v1.0/sites/other/lists/documents/items?$skiptoken=x",
    "https://graph.microsoft.com/v1.0/sites/site/lists/other/items?$skiptoken=x", "https://graph.microsoft.com/v1.0/sites/site/lists/documents/columns?$skiptoken=x"]) {
    await assert.rejects(create(graphFixture({ foreign })).loadSnapshot(), /nextLink|pagin|inválid|invalido/i);
  }
});

test("default authenticated Graph reads the personal site with Sites.Read.All and GET only", async t => {
  const scopes = []; const urls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.method, "GET"); urls.push(url);
    const path = new URL(url).pathname;
    const payload = path.endsWith("/columns") ? { value: columns() } : path.endsWith("/items") ? { value: [item()] }
      : path.endsWith("/lists") ? { value: [{ id: "documents", displayName: "DOCUMENTOS", list: { template: "genericList" } }] } : { id: "site" };
    return { ok: true, status: 200, async json() { return payload; } };
  });
  const result = await create({ async tokenProvider(requested, { signal }) { assert.ok(signal); scopes.push(requested); return "test-token"; } }).loadSnapshot();
  assert.equal(result.documents[0].id, 1); assert.ok(scopes.length);
  assert.ok(scopes.every(value => JSON.stringify(value) === '["Sites.Read.All"]'));
  assert.ok(urls.some(url => url.includes("energeticaltda-my.sharepoint.com") && url.includes("bernardonotini_energeticabr_com")));
});
