import test from "node:test";
import assert from "node:assert/strict";
import { createSharePointRepository } from "../../../portal/data/sharepoint-repository.js";
import { buildCommercialMilestones } from "../src/chat/commercial-milestones-model.js";

const module = await import("../src/chat/commercial-milestones-data.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const create = options => {
  assert.equal(typeof module.createCommercialMilestonesData, "function", "createCommercialMilestonesData must be implemented");
  return module.createCommercialMilestonesData(options);
};
const schemas = { "IMOVEL CADASTRADO": ["FILIAL", "IMOVEL", "STATUSVISUAL"],
  APONTAMENTOSCOMERCIAIS: ["FILIAL", "IMOVEL", "IDCONTRATO", "NOME", "TIPOMARCO", "DESCRICAO", "DATAINICIO", "DATAFATAL", "STATUS"] };
const values = { "IMOVEL CADASTRADO": [" A ", "Casa", "ATIVO"],
  APONTAMENTOSCOMERCIAIS: ["A", { LookupValue: "Casa" }, "10", { Value: "Ana" }, "ESCRITURA", "Descrição", "2026-10-01", "2026-10-05", "ATIVIDADE FINALIZADA"] };
const columns = list => schemas[list].map((displayName, i) => ({ name: `field_${i}`, displayName }));
const item = (list, id = 1, extra = {}) => ({ id: String(id), fields: { ...Object.fromEntries(values[list].map((v, i) => [`field_${i}`, v])), ...extra } });
function fixture(overrides = {}) {
  const lists = [];
  const repository = {
    async resolveList(site, aliases, { signal }) { assert.equal(site, "personal"); assert.ok(signal); lists.push(aliases); return { status: "resolved", id: aliases[0] }; },
    async getColumns(_site, list, { signal }) { assert.ok(signal); return columns(list); },
    async getItemsPage(site, list, query, options) {
      assert.equal(site, "personal"); assert.ok(options.signal);
      const parameters = new URLSearchParams(query);
      assert.equal(parameters.get("$expand"), "fields"); assert.equal(parameters.get("$top"), "100"); assert.equal(parameters.has("$filter"), false);
      return { items: [item(list)], hasMore: false, nextLink: "", batchCount: 1 };
    },
    createItem() { assert.fail("writes forbidden"); }, updateItem() { assert.fail("writes forbidden"); }, deleteItem() { assert.fail("writes forbidden"); },
    ...overrides,
  };
  return { repository, lists };
}

test("atomic read-only snapshot contains exactly two lists and normalized fixed rows", async () => {
  const { repository, lists } = fixture(); const result = await create({ repository }).loadSnapshot();
  assert.deepEqual(lists, [["IMOVEL CADASTRADO"], ["APONTAMENTOSCOMERCIAIS"]]);
  assert.deepEqual(result, { complete: true, properties: [{ id: "1", branch: "A", property: "Casa", visualStatus: "ATIVO" }],
    milestones: [{ id: "1", branch: "A", property: "Casa", contractId: "10", buyer: "Ana", type: "ESCRITURA", description: "Descrição",
      startDate: "2026-10-01", dueDate: "2026-10-05", status: "ATIVIDADE FINALIZADA" }] });
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.milestones)); assert.ok(Object.isFrozen(result.milestones[0]));
});

test("every consumed column including DATAFATAL IDCONTRATO NOME DESCRICAO required on empty source", async () => {
  for (const list of Object.keys(schemas)) for (const field of schemas[list]) {
    const { repository } = fixture({ async getColumns(_site, name) { return columns(name).filter(c => name !== list || c.displayName !== field); },
      async getItemsPage() { return { items: [], hasMore: false }; } });
    await assert.rejects(create({ repository }).loadSnapshot(), /coluna|esquema/i);
  }
});

test("schema resolves renamed Title and encoded labels while excluding computed LinkTitle aliases", async () => {
  const { repository } = fixture({
    async getColumns(_site, list) { return [{ name: "LinkTitle", displayName: "FILIAL" }, { name: "LinkTitleNoMenu", displayName: "FILIAL" },
      { name: "LinkTitle2", displayName: "FILIAL" }, { name: "Computed", displayName: "FILIAL", computed: {} },
      ...columns(list).map((c, i) => i === 0 ? { name: "Title", displayName: "FILIAL" }
        : c.displayName === "DESCRICAO" ? { name: "DESCRI_x00c7__x00c3_O", displayName: "Descrição" } : c)]; },
    async getItemsPage(_site, list) { const row = item(list); row.fields.Title = row.fields.field_0; delete row.fields.field_0;
      if (list === "APONTAMENTOSCOMERCIAIS") { row.fields.DESCRI_x00c7__x00c3_O = row.fields.field_5; delete row.fields.field_5; }
      return { items: [row], hasMore: false }; },
  });
  const row = (await create({ repository }).loadSnapshot()).milestones[0]; assert.equal(row.branch, "A"); assert.equal(row.description, "Descrição");
});

test("ambiguous unsafe computed and reused schema names reject before data is trusted", async () => {
  for (const mutate of [() => null, cols => [...cols, { name: "other", displayName: "FILIAL" }],
    cols => cols.map((c, i) => i === 0 ? { ...c, name: "bad/name" } : c),
    cols => cols.map((c, i) => i === 0 ? { ...c, computed: true } : c),
    cols => cols.map((c, i) => i === 1 ? { ...c, name: "field_0" } : c)]) {
    const { repository } = fixture({ async getColumns(_site, list) { return mutate(columns(list)); } });
    await assert.rejects(create({ repository }).loadSnapshot(), /coluna|esquema/i);
  }
});

test("complete pagination crosses repository windows and preserves source order on both lists", async () => {
  const counts = {};
  const { repository } = fixture({ async getItemsPage(_site, list, _query, options) {
    const page = counts[list] = (counts[list] || 0) + 1;
    assert.equal(options.pageNumber, (page - 1) % 100 + 1); assert.equal(options.maxPages, 100);
    assert.equal(options.cursor || "", page === 1 ? "" : `${list}-${page}`);
    return { items: [item(list, 200 - page)], hasMore: page < 102, nextLink: page < 102 ? `${list}-${page + 1}` : "" };
  } });
  const result = await create({ repository }).loadSnapshot();
  for (const name of ["properties", "milestones"]) { assert.equal(result[name].length, 102); assert.equal(result[name][0].id, "199"); assert.equal(result[name][101].id, "98"); }
});

test("malformed partial or inconsistent pages reject globally", async () => {
  for (const page of [{ items: null, hasMore: false }, { items: [], hasMore: "false" }, { items: [], hasMore: true, nextLink: "next" },
    { items: [item("APONTAMENTOSCOMERCIAIS")], hasMore: true }, { items: [], hasMore: false, nextLink: "next" },
    { items: [], hasMore: false, partial: true }, { items: [], hasMore: false, aborted: true }, { items: [], hasMore: false, truncated: true },
    { items: [], hasMore: false, error: "403" }, { items: [], hasMore: false, batchCount: 1 }, { items: [], hasMore: false, nextLink: {} },
    { items: Array.from({ length: 101 }, (_, i) => item("APONTAMENTOSCOMERCIAIS", i + 1)), hasMore: false }]) {
    const { repository } = fixture({ async getItemsPage(_site, list) { return list === "APONTAMENTOSCOMERCIAIS" ? page : { items: [], hasMore: false }; } });
    await assert.rejects(create({ repository }).loadSnapshot(), /página|pagina|incomplet|inválid/i);
  }
});

test("duplicate IDs on either list or across pages and cursor cycles reject", async () => {
  for (const target of Object.keys(schemas)) for (const mode of ["duplicate", "cycle", "same-page"]) {
    let count = 0;
    const { repository } = fixture({ async getItemsPage(_site, list) {
      if (list !== target) return { items: [], hasMore: false };
      if (mode === "same-page") return { items: [item(list), item(list)], hasMore: false };
      return { items: [item(list, mode === "duplicate" ? 1 : ++count)], hasMore: true, nextLink: "next" };
    } });
    await assert.rejects(create({ repository }).loadSnapshot(), /duplic|cursor|ciclo/i);
  }
});

test("malformed source IDs never become valid by trimming or scalar wrappers", async () => {
  for (const id of [" 1 ", "01", "0", { Value: 1 }, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const { repository } = fixture({ async getItemsPage(_site, list) { const row = item(list); row.id = id; return { items: [row], hasMore: false }; } });
    await assert.rejects(create({ repository }).loadSnapshot(), /inválid|registro/i);
  }
  for (const fields of [null, [], "bad"]) {
    const { repository } = fixture({ async getItemsPage() { return { items: [{ id: "1", fields }], hasMore: false }; } });
    await assert.rejects(create({ repository }).loadSnapshot(), /inválid|campo/i);
  }
});

test("blank scalar dates and contract are empty strings and never invented", async () => {
  for (const value of [undefined, null, "", "  ", [], { Value: "" }]) {
    const { repository } = fixture({ async getItemsPage(_site, list) { return { items: [item(list, 1, list === "APONTAMENTOSCOMERCIAIS"
      ? { field_0: value, field_1: value, field_2: value, field_3: value, field_6: value, field_7: value } : {})], hasMore: false }; } });
    const row = (await create({ repository }).loadSnapshot()).milestones[0];
    for (const name of ["branch", "property", "contractId", "buyer", "startDate", "dueDate"]) assert.equal(row[name], "");
    assert.equal(Object.hasOwn(row, "startOrder"), false);
  }
});

test("DateTime preserves calendar date plus precise chronology while BR dates normalize", async () => {
  const { repository } = fixture({ async getItemsPage(_site, list) { return { items: [item(list, 1, list === "APONTAMENTOSCOMERCIAIS"
    ? { field_6: "2026-10-01T23:30:00-03:00", field_7: "05/10/2026" } : {})], hasMore: false }; } });
  const row = (await create({ repository }).loadSnapshot()).milestones[0];
  assert.equal(row.startDate, "2026-10-01"); assert.equal(row.dueDate, "2026-10-05"); assert.equal(row.startOrder, 1790908200000);
});

test("impossible dates invalid contracts and unscalar fields reject instead of becoming blanks", async () => {
  for (const extra of [{ field_6: "2026-02-30" }, { field_7: "31/04/2026" }, { field_6: "2026-10-01T24:00:00Z" },
    { field_7: true }, { field_6: {} }, { field_3: {} }, { field_2: {} }, { field_2: false }, { field_2: Infinity },
    { field_5: ["one", "two"] }, { field_4: Infinity }, { field_8: false }]) {
    const { repository } = fixture({ async getItemsPage(_site, list) { return { items: [item(list, 1, list === "APONTAMENTOSCOMERCIAIS" ? extra : {})], hasMore: false }; } });
    await assert.rejects(create({ repository }).loadSnapshot(), /inválid|data|campo|contrato/i);
  }
});

test("runaway cursors reject complete rather than return a capped partial report", async () => {
  let count = 0;
  const { repository } = fixture({ async getItemsPage(_site, list) {
    if (list !== "APONTAMENTOSCOMERCIAIS") return { items: [], hasMore: false };
    return { items: [item(list, ++count)], hasMore: true, nextLink: `next-${count}` };
  } });
  await assert.rejects(create({ repository }).loadSnapshot(), /limite|parcial/i);
  assert.ok(count > 100 && count <= 10000);
});

test("failure after a successful page never returns accumulated partial rows", async () => {
  const { repository } = fixture({ async getItemsPage(_site, list, _query, options) {
    if (list !== "APONTAMENTOSCOMERCIAIS") return { items: [], hasMore: false };
    if (options.cursor) throw new Error("503 after page one");
    return { items: [item(list)], hasMore: true, nextLink: "next" };
  } });
  await assert.rejects(create({ repository }).loadSnapshot(), /503 after page one/);
});

test("remote failure aborts sibling transport even if its promise never settles", { timeout: 2000 }, async () => {
  let siblingSignal;
  const { repository } = fixture({ async getItemsPage(_site, list, _query, { signal }) {
    if (list === "APONTAMENTOSCOMERCIAIS") throw new Error("403 forbidden");
    siblingSignal = signal; return new Promise(() => {});
  } });
  await assert.rejects(create({ repository }).loadSnapshot(), /403/); assert.equal(siblingSignal.aborted, true);
});

test("pre-abort and ignored cancellation reject promptly at all repository stages", { timeout: 2000 }, async () => {
  const controller = new AbortController(); controller.abort(); const before = fixture();
  await assert.rejects(create({ repository: before.repository }).loadSnapshot({ signal: controller.signal }), /abort|cancel/i);
  assert.equal(before.lists.length, 0);
  for (const method of ["resolveList", "getColumns", "getItemsPage"]) {
    let started; const ready = new Promise(resolve => { started = resolve; }); const abort = new AbortController();
    const { repository } = fixture({ [method]() { started(); return new Promise(() => {}); } });
    const pending = create({ repository }).loadSnapshot({ signal: abort.signal }); await ready; abort.abort();
    await assert.rejects(pending, /abort|cancel/i);
  }
});

test("late abort custom reason missing lists and invalid construction reject", async () => {
  const controller = new AbortController(); const reason = new Error("cancel custom");
  const late = fixture({ async getItemsPage() { controller.abort(reason); return { items: [], hasMore: false }; } });
  await assert.rejects(create({ repository: late.repository }).loadSnapshot({ signal: controller.signal }), error => error === reason);
  const missing = fixture({ async resolveList() { return { status: "missing" }; } });
  await assert.rejects(create({ repository: missing.repository }).loadSnapshot(), /lista/i);
  assert.throws(() => create(), /sessão/i); assert.throws(() => create({ repository: {} }), /repositório/i);
});

test("token provider uses read scopes and auth failure or ignored cancellation reject promptly", { timeout: 2000 }, async () => {
  await assert.rejects(create({ tokenProvider() { throw new Error("401 session expired"); } }).loadSnapshot(), /401/);
  await assert.rejects(create({ tokenProvider() { return ""; } }).loadSnapshot(), /token/i);
  let started; const ready = new Promise(resolve => { started = resolve; }); const controller = new AbortController();
  const pending = create({ tokenProvider(scopes, { signal }) { assert.deepEqual(scopes, ["Sites.Read.All"]); assert.ok(signal); started(); return new Promise(() => {}); } })
    .loadSnapshot({ signal: controller.signal });
  await ready; controller.abort(); await assert.rejects(pending, /abort|cancel/i);
});

function graphPayload(url) {
  const list = Object.keys(schemas).find(name => url.includes(`/lists/${encodeURIComponent(name)}/`));
  if (url.includes("/columns")) return { value: columns(list) };
  if (url.includes("/items")) return { value: [item(list, url.includes("skiptoken") ? 2 : 1)],
    ...(url.includes("skiptoken") ? {} : { "@odata.nextLink": `https://graph.microsoft.com/v1.0/sites/site/lists/${encodeURIComponent(list)}/items?$skiptoken=next` }) };
  if (url.includes("/lists?")) return { value: Object.keys(schemas).map(id => ({ id, displayName: id, list: { template: "genericList" } })) };
  return { id: "site" };
}

test("real Graph client authenticates every GET and queries only the two permitted lists", async () => {
  const original = globalThis.fetch; const requests = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(options.method, "GET"); assert.equal(options.body, undefined); assert.equal(options.headers.Authorization, "Bearer test-session");
    requests.push(url); return { ok: true, status: 200, json: async () => graphPayload(url) };
  };
  try {
    const result = await create({ tokenProvider(scopes) { assert.deepEqual(scopes, ["Sites.Read.All"]); return "test-session"; } }).loadSnapshot();
    assert.equal(result.complete, true); assert.equal(result.milestones.length, 2); assert.equal(result.properties.length, 2);
    assert.ok(requests.some(url => url.includes("skiptoken")));
    assert.ok(requests.every(url => !/receita|compras|cliente/i.test(url)));
  } finally { globalThis.fetch = original; }
});

test("real repository rejects foreign next links rather than following them", async () => {
  const graph = { async request(path, options = {}) {
    assert.equal(options.method || "GET", "GET");
    if (path.includes("/items")) return { value: [item("APONTAMENTOSCOMERCIAIS")], "@odata.nextLink": "https://evil.example/items" };
    return graphPayload(path);
  } };
  const repository = createSharePointRepository(graph, { personal: { host: "example.sharepoint.com", path: "/sites/test" } });
  await assert.rejects(create({ repository }).loadSnapshot(), /nextLink|pagin|inválid|invalido/i);
});

test("array-shaped records and explicitly incomplete pages cannot become complete snapshots", async () => {
  for (const page of [{ items: [Object.assign([], item("APONTAMENTOSCOMERCIAIS"))], hasMore: false },
    { items: [], hasMore: false, incomplete: true }, { items: [], hasMore: false, complete: false }]) {
    const { repository } = fixture({ async getItemsPage(_site, list) { return list === "APONTAMENTOSCOMERCIAIS" ? page : { items: [], hasMore: false }; } });
    await assert.rejects(create({ repository }).loadSnapshot(), /inválid|incomplet|registro/i);
  }
});

test("loader timestamp ordering reaches model without replacing the source calendar date", async () => {
  const { repository } = fixture({ async getItemsPage(_site, list) {
    return { items: list === "APONTAMENTOSCOMERCIAIS" ? [item(list, 1, { field_6: "2026-10-01T08:00:00-03:00" }),
      item(list, 2, { field_6: "2026-10-01T23:30:00-03:00" })] : [item(list)], hasMore: false };
  } });
  const source = await create({ repository }).loadSnapshot();
  const report = buildCommercialMilestones(source, {}, "2026-10-05");
  assert.equal(report.branches[0].rows[0].id, "2"); assert.equal(report.branches[0].rows[0].startDate, "2026-10-01");
  const detail = buildCommercialMilestones(source, { property: "Casa" }, "2026-10-05");
  assert.deepEqual(detail.branches[0].rows.map(row => [row.id, row.isLatest]), [["2", true], ["1", false]]);
});

test("real repository follows metadata pagination before validating the required consumed columns", async () => {
  const graph = { async request(path, options = {}) {
    assert.equal(options.method || "GET", "GET");
    const list = Object.keys(schemas).find(name => path.includes(`/lists/${encodeURIComponent(name)}/`));
    if (path.includes("/columns")) {
      const second = path.includes("skiptoken");
      return { value: second ? columns(list).slice(2) : columns(list).slice(0, 2), ...(second ? {} : {
        "@odata.nextLink": `https://graph.microsoft.com/v1.0/sites/site/lists/${encodeURIComponent(list)}/columns?$skiptoken=next` }) };
    }
    return graphPayload(path);
  } };
  const repository = createSharePointRepository(graph, { personal: { host: "example.sharepoint.com", path: "/sites/test" } });
  const result = await create({ repository }).loadSnapshot();
  assert.equal(result.milestones[0].dueDate, "2026-10-05"); assert.equal(result.milestones[0].description, "Descrição");
});

test("live internal schema preserves text IDCONTRATO and uses only NOME for buyer", async () => {
  for (const contractId of ["0010", "0", "-1", "ABC-2026/001", "10.5", "9007199254740993"]) {
    const { repository } = fixture({
      async getColumns(_site, list) { return [...schemas[list].map(name => ({ name, displayName: name })), { name: "COMPRADOR", displayName: "COMPRADOR" }]; },
      async getItemsPage(_site, list) {
        const fields = Object.fromEntries(schemas[list].map((name, i) => [name, values[list][i]]));
        const first = { id: "1", fields: { ...fields, IDCONTRATO: contractId, NOME: "Ana", COMPRADOR: "" } };
        return { items: list === "APONTAMENTOSCOMERCIAIS" ? [first,
          { id: "2", fields: { ...fields, IDCONTRATO: contractId, NOME: "", COMPRADOR: "Must not be used" } }] : [first], hasMore: false };
      },
    });
    const source = await create({ repository }).loadSnapshot();
    assert.deepEqual(source.milestones.map(row => [row.contractId, row.buyer]), [[contractId, "Ana"], [contractId, ""]]);
    const report = buildCommercialMilestones(source, { contractId }, "2026-10-05");
    assert.deepEqual(report.branches[0].rows.map(row => row.buyerLabel), ["Ana", "N/A"]);
  }
});

test("COMPRADOR metadata cannot substitute missing required NOME", async () => {
  const { repository } = fixture({ async getColumns(_site, list) {
    return columns(list).filter(column => column.displayName !== "NOME").concat({ name: "COMPRADOR", displayName: "COMPRADOR" });
  } });
  await assert.rejects(create({ repository }).loadSnapshot(), /NOME/);
});
