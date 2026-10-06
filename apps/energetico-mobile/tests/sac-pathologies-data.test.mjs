import test from "node:test";
import assert from "node:assert/strict";
import { createSharePointRepository } from "../../../portal/data/sharepoint-repository.js";

const module = await import("../src/chat/sac-pathologies-data.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
function create(options) {
  assert.equal(typeof module.createSacPathologiesData, "function", "createSacPathologiesData must be implemented");
  return module.createSacPathologiesData(options);
}
const names = ["FILIAL", "IMOVEL", "CLIENTE", "TIPOPATOLOGIA", "STATUS", "DESCRICAO", "DATAAPONTADO", "DATASOLUCAO", "CUSTO"];
const columns = () => names.map((displayName, i) => ({ name: `field_${i}`, displayName }));
const values = [" A ", { LookupValue: "Casa" }, { Value: "Ana" }, ["Infiltração"], "ATIVO", "Parede úmida", "29/02/2024", "2024-03-01T23:30:00-03:00", "R$ 1.234,50"];
const item = (id = 1, extra = {}) => ({ id: String(id), fields: { ...Object.fromEntries(values.map((value, i) => [`field_${i}`, value])), ...extra } });
function fixture(overrides = {}) {
  return { repository: {
    async resolveList(site, aliases, { signal }) {
      assert.equal(site, "personal"); assert.ok(signal); assert.deepEqual(aliases, ["SACPATOLOGIAS"]);
      return { status: "resolved", id: "sac" };
    },
    async getColumns(site, list, { signal }) { assert.equal(site, "personal"); assert.equal(list, "sac"); assert.ok(signal); return columns(); },
    async getItemsPage(site, list, query, options) {
      assert.equal(site, "personal"); assert.equal(list, "sac"); assert.ok(options.signal);
      const parameters = new URLSearchParams(query);
      assert.equal(parameters.get("$expand"), "fields"); assert.equal(parameters.get("$top"), "100");
      assert.equal(parameters.has("$filter"), false);
      return { items: [item()], hasMore: false, batchCount: 1 };
    },
    createItem() { assert.fail("writes forbidden"); }, updateItem() { assert.fail("writes forbidden"); }, deleteItem() { assert.fail("writes forbidden"); },
    ...overrides,
  } };
}

test("complete read-only snapshot normalizes the nine consumed fields and builtin item ID", async () => {
  const result = await create(fixture()).loadSnapshot();
  assert.deepEqual(result, { complete: true, rows: [{ id: "1", branch: "A", property: "Casa", client: "Ana", type: "Infiltração",
    status: "ATIVO", description: "Parede úmida", startDate: "2024-02-29", endDate: "2024-03-01", cost: 1234.5 }] });
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.rows)); assert.ok(Object.isFrozen(result.rows[0]));
});

test("confirmed internal text-cost and date-only schema reaches the UI indicators without coercion", async () => {
  const source = fixture({ async getColumns() {
    return names.map(name => ({ name, displayName: name,
      ...(["DATAAPONTADO", "DATASOLUCAO"].includes(name) ? { dateTime: { format: "dateOnly" } }
        : { text: { allowMultipleLines: name === "DESCRICAO" } }) }));
  }, async getItemsPage() {
    return { items: [
      { id: "5", fields: { FILIAL: "A", IMOVEL: "Casa", CLIENTE: "Ana", TIPOPATOLOGIA: "Infiltração", STATUS: "ATIVO",
        DESCRICAO: "Linha 1\nLinha 2", DATAAPONTADO: "2026-09-12T23:30:00-03:00", DATASOLUCAO: "", CUSTO: "0" } },
      { id: "3", fields: { FILIAL: "A", IMOVEL: "Casa", CLIENTE: "Ana", TIPOPATOLOGIA: "Infiltração", STATUS: "ATIVO",
        DESCRICAO: "", DATAAPONTADO: "2026-08-15T00:00:00Z", DATASOLUCAO: "", CUSTO: "0" } },
      { id: "2", fields: { STATUS: "INATIVO", CUSTO: "12" } }, { id: "4", fields: { STATUS: "INATIVO", CUSTO: "300" } },
    ], hasMore: false };
  } });
  const snapshot = await create(source).loadSnapshot();
  const { buildSacPathologies } = await import("../src/chat/sac-pathologies-model.js");
  const all = buildSacPathologies(snapshot, {}, "2026-10-05");
  assert.deepEqual([all.total, all.active, all.inactive, all.costTotal], [4, 2, 2, 312]);
  const active = buildSacPathologies(snapshot, { status: "ATIVO" }, "2026-10-05");
  assert.deepEqual([active.total, active.active, active.inactive, active.costTotal], [2, 2, 0, 0]);
  assert.deepEqual(active.rows.map(row => [row.id, row.startDate, row.elapsedDays]), [["5", "2026-09-12", 23], ["3", "2026-08-15", 51]]);
  assert.equal(active.rows[0].description, "Linha 1\nLinha 2");
});

test("every consumed schema column is required even when the list is empty", async () => {
  for (const missing of names) {
    const source = fixture({ async getColumns() { return columns().filter(column => column.displayName !== missing); },
      async getItemsPage() { assert.fail("missing schema must fail before reading items"); } });
    await assert.rejects(create(source).loadSnapshot(), error => /coluna|esquema/i.test(error.message) && error.message.includes(missing));
  }
});

test("renamed Title encoded names hidden fields and display accents resolve unambiguously", async () => {
  const source = fixture({ async getColumns() { return [{ name: "LinkTitle", displayName: "FILIAL" },
    { name: "Computed", displayName: "FILIAL", computed: {} }, ...columns().map((column, i) => i === 0
      ? { ...column, name: "Title" } : i === 5 ? { ...column, name: "DESCRI_x00c7__x00c3_O", displayName: "Descrição", hidden: true } : column)]; },
    async getItemsPage() { return { items: [item(7, { Title: "B", DESCRI_x00c7__x00c3_O: "Texto" })], hasMore: false }; } });
  const result = await create(source).loadSnapshot();
  assert.equal(result.rows[0].id, "7"); assert.equal(result.rows[0].branch, "B"); assert.equal(result.rows[0].description, "Texto");
});

test("ambiguous unsafe computed reused and malformed column metadata cannot produce totals", async () => {
  for (const mutate of [() => null, list => [...list, { name: "duplicate", displayName: "FILIAL" }],
    list => list.map((column, i) => i === 0 ? { ...column, name: "bad/name" } : column),
    list => list.map((column, i) => i === 0 ? { ...column, computed: true } : column),
    list => list.map((column, i) => i === 1 ? { ...column, name: "field_0" } : column)]) {
    await assert.rejects(create(fixture({ async getColumns() { return mutate(columns()); } })).loadSnapshot(), /coluna|esquema/i);
  }
});

test("full pagination crosses 100-page repository windows without losing records", async () => {
  let count = 0;
  const source = fixture({ async getItemsPage(_site, _list, _query, options) {
    const page = ++count;
    assert.equal(options.pageNumber, (page - 1) % 100 + 1); assert.equal(options.maxPages, 100);
    assert.equal(options.cursor || "", page === 1 ? "" : `next-${page}`);
    return { items: Array.from({ length: 21 }, (_, i) => item((page - 1) * 21 + i + 1)), hasMore: page < 102,
      nextLink: page < 102 ? `next-${page + 1}` : "" };
  } });
  const result = await create(source).loadSnapshot(); assert.equal(result.complete, true);
  assert.equal(result.rows.length, 2142); assert.equal(result.rows[2141].id, "2142");
});

test("malformed partial and inconsistent pages reject instead of returning partial totals", async () => {
  for (const page of [{ items: null, hasMore: false }, { items: [], hasMore: "false" }, { items: [], hasMore: true, nextLink: "next" },
    { items: [item()], hasMore: true }, { items: [], hasMore: false, nextLink: "next" },
    ...["partial", "incomplete", "aborted", "truncated", "error"].map(flag => ({ items: [], hasMore: false, [flag]: true })),
    { items: [], hasMore: false, complete: false }, { items: [], hasMore: false, batchCount: 1 },
    { items: [], hasMore: false, nextLink: {} }, { items: Array.from({ length: 101 }, (_, i) => item(i + 1)), hasMore: false }]) {
    await assert.rejects(create(fixture({ async getItemsPage() { return page; } })).loadSnapshot(), /página|pagina|incomplet|inválid/i);
  }
  let count = 0;
  await assert.rejects(create(fixture({ async getItemsPage() { if (++count === 2) throw new Error("503 after first page");
    return { items: [item()], hasMore: true, nextLink: "next" }; } })).loadSnapshot(), /503 after first page/);
});

test("duplicate IDs within and across pages and cursor cycles fail closed", async () => {
  for (const mode of ["same-page", "duplicate", "cycle"]) {
    let count = 0;
    const source = fixture({ async getItemsPage() {
      if (mode === "same-page") return { items: [item(), item()], hasMore: false };
      return { items: [item(mode === "duplicate" ? 1 : ++count)], hasMore: true, nextLink: "next" };
    } });
    await assert.rejects(create(source).loadSnapshot(), /duplic|cursor|ciclo/i);
  }
});

test("the maximum pagination bound rejects a runaway source instead of truncating", async () => {
  let count = 0;
  await assert.rejects(create(fixture({ async getItemsPage() {
    return { items: [item(++count)], hasMore: true, nextLink: `next-${count}` };
  } })).loadSnapshot(), /limite|parcial/i);
  assert.equal(count, 10000);
});

test("bad item IDs record shapes scalar fields dates and costs never become zero or blank", async () => {
  for (const badItem of [{ id: "0", fields: item().fields }, { id: "01", fields: item().fields },
    { id: "1", fields: null }, { id: "1", fields: [] }, Object.assign([], item()),
    ...[{}, ["A", "B"], true, Infinity].map(value => item(1, { field_0: value })),
    item(1, { field_6: "2026-02-30" }), item(1, { field_7: "2026-02-29" }), item(1, { field_8: "ISENTO" }),
    item(1, { field_8: "12abc" }), item(1, { field_8: true })]) {
    await assert.rejects(create(fixture({ async getItemsPage() { return { items: [badItem], hasMore: false }; } })).loadSnapshot(), /ID|campo|registro|data|valor|inválid/i);
  }
});

test("valid schema with blank row fields keeps dates blank and cost null", async () => {
  const result = await create(fixture({ async getItemsPage() { return { items: [{ id: "9", fields: {} }], hasMore: false }; } })).loadSnapshot();
  assert.equal(result.rows[0].cost, null); assert.equal(result.rows[0].startDate, ""); assert.equal(result.rows[0].endDate, "");
});

test("pre-abort and transports ignoring cancellation settle at each read stage", { timeout: 2000 }, async () => {
  const pre = new AbortController(); pre.abort(); await assert.rejects(create(fixture()).loadSnapshot({ signal: pre.signal }), /abort|cancel/i);
  for (const method of ["resolveList", "getColumns", "getItemsPage"]) {
    let started; const ready = new Promise(resolve => { started = resolve; }); const controller = new AbortController();
    const pending = create(fixture({ [method]() { started(); return new Promise(() => {}); } })).loadSnapshot({ signal: controller.signal });
    await ready; controller.abort(); await assert.rejects(pending, /abort|cancel/i);
  }
});

test("late custom abort preserves its reason and discards the completed page", async () => {
  const controller = new AbortController(); const reason = new Error("custom cancellation");
  const pending = create(fixture({ async getItemsPage() { controller.abort(reason); return { items: [], hasMore: false }; } }))
    .loadSnapshot({ signal: controller.signal });
  await assert.rejects(pending, error => error === reason);
});

test("missing list session and invalid repository fail explicitly", async () => {
  await assert.rejects(create(fixture({ async resolveList() { return { status: "missing" }; } })).loadSnapshot(), /SACPATOLOGIAS|lista/i);
  assert.throws(() => create(), /sessão/i); assert.throws(() => create({ repository: {} }), /repositório/i);
});

function graphFixture({ foreign = "", fallback = false, splitColumns = false } = {}) {
  const requests = [];
  const graph = { async request(path, options = {}) {
    assert.equal(options.method || "GET", "GET"); assert.equal(options.body, undefined); requests.push(path);
    if (path.includes("/columns")) return { value: splitColumns ? path.includes("skiptoken") ? columns().slice(4) : columns().slice(0, 4) : columns(),
      ...(splitColumns && !path.includes("skiptoken") ? { "@odata.nextLink": "https://graph.microsoft.com/v1.0/sites/site/lists/sac/columns?$skiptoken=next" } : {}) };
    if (path.includes("/items")) return { value: [item(path.includes("skiptoken") ? 2 : 1)],
      ...(path.includes("skiptoken") ? {} : { "@odata.nextLink": foreign || "https://graph.microsoft.com/v1.0/sites/site/lists/sac/items?$skiptoken=next" }) };
    if (path.includes("/lists?")) return { value: [{ id: "spaced", displayName: "SAC PATOLOGIAS", list: { template: "genericList" } },
      ...(fallback ? [] : [{ id: "sac", displayName: "SACPATOLOGIAS", list: { template: "genericList" } }])] };
    return { id: "site" };
  } };
  return { requests, repository: createSharePointRepository(graph, { personal: { host: "example.sharepoint.com", path: "/sites/test" } }) };
}

test("real repository performs only GET fully paginates metadata and prefers the PowerFx list", async () => {
  const source = graphFixture({ splitColumns: true }); const result = await create(source).loadSnapshot();
  assert.equal(result.complete, true); assert.deepEqual(result.rows.map(value => value.id), ["1", "2"]);
  assert.ok(source.requests.some(path => path.includes("/columns?$skiptoken")));
  assert.equal(source.requests.some(path => path.includes("/lists/spaced/")), false);
});

test("real repository resolves the spaced personal-list alias when the PowerFx name is absent", async () => {
  const source = graphFixture({ fallback: true });
  // Keep continuation links in the collection actually resolved by the repository.
  const repository = createSharePointRepository({ async request(path, options = {}) {
    assert.equal(options.method || "GET", "GET"); source.requests.push(path);
    if (path.includes("/lists?")) return { value: [{ id: "spaced", displayName: "SAC PATOLOGIAS", list: { template: "genericList" } }] };
    if (path.includes("/columns")) return { value: columns() };
    if (path.includes("/items")) return { value: [item()] };
    return { id: "site" };
  } }, { personal: { host: "example.sharepoint.com", path: "/sites/test" } });
  assert.equal((await create({ repository }).loadSnapshot()).rows[0].id, "1");
  assert.ok(source.requests.some(path => path.includes("/lists/spaced/items")));
});

test("real repository rejects foreign hosts sites lists and collection continuation links", async () => {
  for (const foreign of ["https://evil.example/items", "https://graph.microsoft.com/v1.0/sites/other/lists/sac/items?$skiptoken=x",
    "https://graph.microsoft.com/v1.0/sites/site/lists/other/items?$skiptoken=x",
    "https://graph.microsoft.com/v1.0/sites/site/lists/sac/columns?$skiptoken=x"]) {
    await assert.rejects(create(graphFixture({ foreign })).loadSnapshot(), /nextLink|pagin|inválid|invalido/i);
  }
});
