import test from "node:test";
import assert from "node:assert/strict";
import { createSharePointRepository } from "../../../portal/data/sharepoint-repository.js";

const dataModule = await import("../src/chat/attendance-summary-data.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const create = options => {
  assert.equal(typeof dataModule.createAttendanceSummaryData, "function", "createAttendanceSummaryData must be implemented");
  return dataModule.createAttendanceSummaryData(options);
};
const names = { FORNECEDORES: ["CADASTRO", "STATUS"],
  DESCRITIVOPRESENCA: ["DATA", "FILIAL", "FORNECEDOR", "PROFISSAO", "PRESENCA", "STATUS", "VLORDIARIO", "IDPGTO"] };
const columns = list => names[list].map((displayName, i) => ({ name: `field_${i}`, displayName }));
const presence = (id = 1, value = "R$ 1.234,56") => ({ id: String(id), fields: { field_0: "2026-10-03T00:00:00-03:00",
  field_1: "B", field_2: { LookupValue: "Ana" }, field_3: "PEDREIRO", field_4: "PRESENTE",
  field_5: "PAGO", field_6: value, field_7: 91 } });
const supplier = { id: "1", fields: { field_0: "Ana", field_1: { Value: "ATIVO" } } };
function fixture(overrides = {}) {
  const calls = [];
  const repository = {
    async resolveList(site, aliases, options) {
      calls.push(["resolve", aliases[0]]); assert.equal(site, "personal"); assert.ok(options.signal);
      return { status: "resolved", id: aliases[0] };
    },
    async getColumns(_site, list) { return columns(list); },
    async getItemsPage(_site, list, query, options) {
      calls.push(["page", list, options.pageNumber, options.cursor || ""]);
      assert.equal(new URLSearchParams(query).get("$top"), "100");
      assert.equal(new URLSearchParams(query).get("$expand"), "fields");
      assert.ok(options.pageNumber >= 1 && options.pageNumber <= options.maxPages && options.maxPages <= 100);
      return { items: [list === "FORNECEDORES" ? supplier : presence()], hasMore: false, nextLink: "", batchCount: 1 };
    }, ...overrides,
  };
  return { repository, calls };
}

test("loadSnapshot returns complete frozen RH-normalized supplier and presence data", async () => {
  const { repository, calls } = fixture();
  const source = await create({ repository }).loadSnapshot();
  assert.equal(source.complete, true); assert.ok(Object.isFrozen(source));
  assert.ok(Object.isFrozen(source.presences)); assert.ok(Object.isFrozen(source.suppliers));
  assert.equal(source.suppliers[0].name, "Ana"); assert.equal(source.suppliers[0].status, "ATIVO");
  assert.equal(source.presences[0].supplier, "Ana"); assert.equal(source.presences[0].date, "2026-10-03");
  assert.equal(source.presences[0].dailyValue, 1234.56); assert.equal(source.presences[0].paymentId, "91");
  assert.deepEqual(calls.filter(call => call[0] === "resolve").map(call => call[1]).sort(), ["DESCRITIVOPRESENCA", "FORNECEDORES"]);
});

test("pagination traverses beyond 2000 records and beyond the repository's 100-page window", async () => {
  let pages = 0;
  const { repository } = fixture({ async getItemsPage(_site, list, _query, options) {
    if (list === "FORNECEDORES") return { items: [supplier], hasMore: false };
    pages++;
    assert.equal(options.maxPages, 100); assert.equal(options.pageNumber, (pages - 1) % 100 + 1);
    assert.equal(options.cursor || "", pages === 1 ? "" : `cursor-${pages}`);
    return { items: Array.from({ length: 21 }, (_, i) => presence((pages - 1) * 21 + i + 1)),
      hasMore: pages < 101, nextLink: pages < 101 ? `cursor-${pages + 1}` : "" };
  } });
  const source = await create({ repository }).loadSnapshot();
  assert.equal(source.presences.length, 2121); assert.equal(source.presences.at(-1).id, "2121");
});

test("schema failure and unavailable lists reject even empty datasets", async () => {
  for (const overrides of [
    { async resolveList() { return { status: "missing" }; } },
    { async getColumns() { return []; } },
    { async getColumns(_site, list) { return columns(list).slice(1); } },
    { async getColumns(_site, list) { return [...columns(list), { name: "conflict", displayName: names[list][0] }]; } },
  ]) {
    const { repository } = fixture(overrides);
    await assert.rejects(create({ repository }).loadSnapshot(), /lista|coluna|schema|esquema/i);
  }
});

test("corrupt pages, contradictory completion, duplicate IDs and cursor cycles reject partial data", async () => {
  const cases = [null, { items: [], nextLink: "" }, { items: {}, hasMore: false },
    { items: [], hasMore: true, nextLink: "" }, { items: [], hasMore: false, nextLink: "next" },
    { items: [presence()], hasMore: false, batchCount: 2 },
    { items: Array.from({ length: 101 }, (_, i) => presence(i + 1)), hasMore: false },
    { items: [presence(), presence()], hasMore: false },
    { items: [{ fields: {} }], hasMore: false },
    { items: [{ id: "1", fields: null }], hasMore: false },
    { items: [presence()], hasMore: true, nextLink: "repeat" },
  ];
  for (const page of cases) {
    const { repository } = fixture({ async getItemsPage() { return page; } });
    await assert.rejects(create({ repository }).loadSnapshot(), /página|pagin|duplicad|cursor|inválid/i);
  }
  const repeated = fixture({ async getItemsPage(_site, list, _query, options) {
    if (list === "FORNECEDORES") return { items: [supplier], hasMore: false };
    return { items: [presence(1)], hasMore: options.pageNumber === 1, nextLink: options.pageNumber === 1 ? "next" : "" };
  } });
  await assert.rejects(create({ repository: repeated.repository }).loadSnapshot(), /duplicad/i);
});

test("invalid financial text remains unknown while explicit zero and locale amounts stay valid", async () => {
  const values = ["garbage 20", "1,2,3", "", null, Infinity, "R$ 0,00", "1.234,56", "1234.56"];
  const { repository } = fixture({ async getItemsPage(_site, list) {
    return { items: list === "FORNECEDORES" ? [supplier] : values.map((value, i) => presence(i + 1, value)), hasMore: false };
  } });
  assert.deepEqual((await create({ repository }).loadSnapshot()).presences.map(item => item.dailyValue),
    [null, null, null, null, null, 0, 1234.56, 1234.56]);
});

test("page failure markers and cycles with distinct row IDs cannot produce a complete snapshot", async () => {
  for (const marker of [{ partial: true }, { error: new Error("failure") }, { aborted: true }, { truncated: true }]) {
    const { repository } = fixture({ async getItemsPage(_site, list) {
      return { items: [list === "FORNECEDORES" ? supplier : presence()], hasMore: false, ...marker };
    } });
    await assert.rejects(create({ repository }).loadSnapshot(), /página|incomplet|pagin/i);
  }
  for (const cycle of [["repeat", "repeat"], ["a", "b", "a"]]) {
    let pages = 0;
    const { repository } = fixture({ async getItemsPage(_site, list) {
      if (list === "FORNECEDORES") return { items: [supplier], hasMore: false };
      return { items: [presence(++pages)], hasMore: true, nextLink: cycle[pages - 1] };
    } });
    await assert.rejects(create({ repository }).loadSnapshot(), /cursor.*ciclo/i);
  }
});

test("abort before loading starts no query and abort during ignored transport rejects immediately", async () => {
  const before = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(create({ repository: before.repository }).loadSnapshot({ signal: controller.signal }), /abort|cancel/i);
  assert.equal(before.calls.length, 0);
  let started;
  const start = new Promise(resolve => { started = resolve; });
  const during = fixture({ async getItemsPage() { started(); return new Promise(() => {}); } });
  const ongoing = new AbortController();
  const pending = create({ repository: during.repository }).loadSnapshot({ signal: ongoing.signal });
  await start; ongoing.abort();
  await assert.rejects(pending, /abort|cancel/i);
});

test("late abort and a later remote failure never return a partial snapshot", async () => {
  const controller = new AbortController();
  const aborted = fixture({ async getItemsPage() { controller.abort(); return { items: [], hasMore: false }; } });
  await assert.rejects(create({ repository: aborted.repository }).loadSnapshot({ signal: controller.signal }), /abort|cancel/i);
  const failed = fixture({ async getItemsPage(_site, list, _query, options) {
    if (list === "FORNECEDORES") return { items: [supplier], hasMore: false };
    if (options.cursor) throw new Error("429 SharePoint");
    return { items: [presence()], hasMore: true, nextLink: "next" };
  } });
  await assert.rejects(create({ repository: failed.repository }).loadSnapshot(), /429/);
});

test("real Graph repository read traversal produces a complete snapshot with validated cursors", async () => {
  const graph = { async request(path, options) {
    assert.equal(options.method || "GET", "GET");
    if (path.includes("/columns")) return { value: columns(path.includes("/FORNECEDORES/") ? "FORNECEDORES" : "DESCRITIVOPRESENCA") };
    if (path.includes("/FORNECEDORES/items")) return { value: [supplier] };
    if (path.includes("/DESCRITIVOPRESENCA/items")) return { value: [presence()] };
    if (path.includes("/lists?")) return { value: Object.keys(names).map(id => ({ id, displayName: id, list: { template: "genericList" } })) };
    return { id: "site" };
  } };
  const repository = createSharePointRepository(graph, { personal: { host: "example.sharepoint.com", path: "/sites/test" } });
  assert.equal((await create({ repository }).loadSnapshot()).presences.length, 1);
});

test("finite overall pagination guard rejects a perpetually growing traversal without partial totals", async () => {
  let pages = 0;
  const { repository } = fixture({ async getItemsPage(_site, list, _query, options) {
    if (list === "FORNECEDORES") return { items: [supplier], hasMore: false };
    assert.ok(options.pageNumber <= 100 && options.maxPages <= 100);
    pages++;
    return { items: [presence(pages)], hasMore: true, nextLink: `next-${pages}` };
  } });
  await assert.rejects(create({ repository }).loadSnapshot(), /limite seguro/i);
  assert.ok(pages > 100 && pages <= 10_000);
});

test("authenticated token retrieval receives read scopes and aborts before network access", async () => {
  let started;
  const start = new Promise(resolve => { started = resolve; });
  const controller = new AbortController();
  let tokenSignal;
  const data = create({ tokenProvider(scopes, options) {
    assert.deepEqual(scopes, ["Sites.Read.All"]);
    tokenSignal = options.signal; started();
    return new Promise(() => {});
  } });
  const pending = data.loadSnapshot({ signal: controller.signal });
  await start; controller.abort();
  await assert.rejects(pending, /abort|cancel/i);
  assert.equal(tokenSignal.aborted, true);
});
