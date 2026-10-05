import test from "node:test";
import assert from "node:assert/strict";
import { createSharePointRepository } from "../../../portal/data/sharepoint-repository.js";

const module = await import("../src/chat/stage-progress-data.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const create = options => {
  assert.equal(typeof module.createStageProgressData, "function", "createStageProgressData must be implemented");
  return module.createStageProgressData(options);
};
const names = {
  DEMONSTRATIVOETAPA: ["FILIAL", "ETAPA", "ATIVIDADEEXECUTADA", "IMOVEL", "FORNECEDOR", "DATAEXECUTADO", "DATAPREVISTO", "STATUS"],
  LANCAMENTOOBRA: ["FILIAL", "ETAPA", "INÍCIO", "FIM", "STATUS", "PERCENTUALEFETUADO"],
};
const columns = list => names[list].map((displayName, i) => ({ name: `field_${i}`, displayName }));
const activity = (id = 1, fields = {}) => ({ id: String(id), fields: { field_0: " A ", field_1: "Fundação",
  field_2: { Value: "Concreto" }, field_3: { LookupValue: "Casa" }, field_4: [{ Title: "João" }],
  field_5: "2026-10-01T23:00:00-03:00", field_6: "03/10/2026", field_7: "ATIVIDADE INICIADA", ...fields } });
const launch = (id = 7, percent = 0.4, fields = {}) => ({ id: String(id), fields: { field_0: "A", field_1: "Fundação",
  field_2: "2026-09-30T00:00:00Z", field_3: "", field_4: { value: "INICIADO" }, field_5: percent, ...fields } });
function fixture(overrides = {}) {
  const calls = [];
  const repository = {
    async resolveList(site, aliases, options) {
      assert.equal(site, "personal"); assert.ok(options.signal);
      calls.push(["resolve", aliases[0]]);
      return { status: "resolved", id: aliases[0] };
    },
    async getColumns(site, list, options) { assert.equal(site, "personal"); assert.ok(options.signal); return columns(list); },
    async getItemsPage(site, list, query, options) {
      assert.equal(site, "personal"); assert.ok(options.signal);
      const params = new URLSearchParams(query);
      assert.equal(params.get("$top"), "100"); assert.equal(params.get("$expand"), "fields");
      assert.equal(params.has("$filter"), false);
      assert.equal(options.headers.Prefer, "HonorNonIndexedQueriesWarningMayFailRandomly");
      calls.push(["page", list]);
      return { items: [list === "DEMONSTRATIVOETAPA" ? activity() : launch()], hasMore: false, nextLink: "", batchCount: 1 };
    }, ...overrides,
  };
  return { repository, calls };
}

test("complete snapshot reads only the two personal lists with exact operations row shapes", async () => {
  const { repository, calls } = fixture();
  const snapshot = await create({ repository }).loadSnapshot();
  assert.deepEqual(snapshot, { complete: true, activities: [{ id: "1", branch: "A", stage: "Fundação", activity: "Concreto",
    property: "Casa", supplier: "João", executionDate: "2026-10-01", plannedDate: "2026-10-03", status: "ATIVIDADE INICIADA" }],
    launches: [{ id: "7", branch: "A", stage: "Fundação", startDate: "2026-09-30", endDate: "", status: "INICIADO", percent: 40 }] });
  assert.deepEqual(calls.filter(call => call[0] === "resolve").map(call => call[1]).sort(), ["DEMONSTRATIVOETAPA", "LANCAMENTOOBRA"]);
  assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot.activities));
  assert.ok(Object.isFrozen(snapshot.launches[0]));
});

test("renamed Title and encoded aliases resolve while computed and title links are excluded", async () => {
  const { repository } = fixture({
    async getColumns(_site, list) {
      return [{ name: "LinkTitle", displayName: "ETAPA" }, { name: "LinkTitleNoMenu", displayName: "ETAPA" },
        { name: "LinkTitle2", displayName: "ETAPA" }, { name: "Calculated", displayName: "ETAPA", computed: true },
        ...columns(list).map((column, i) => i === 1 ? { name: "Title", displayName: "ETAPA", text: {} }
          : list === "LANCAMENTOOBRA" && i === 2 ? { name: "IN_x00cd_CIO", displayName: "INÍCIO" }
          : list === "LANCAMENTOOBRA" && i === 5 ? { name: column.name, displayName: "PERCENTUAL EFETUADO" }
          : list === "DEMONSTRATIVOETAPA" && i === 2 ? { name: column.name, displayName: "ATIVIDADE EXECUTADA" }
          : list === "DEMONSTRATIVOETAPA" && i === 3 ? { name: column.name, displayName: "IMÓVEL" } : column)];
    },
    async getItemsPage(_site, list) {
      const row = list === "DEMONSTRATIVOETAPA" ? activity() : launch();
      row.fields.Title = row.fields.field_1; delete row.fields.field_1;
      row.fields.LinkTitle = "WRONG";
      if (list === "LANCAMENTOOBRA") { row.fields.IN_x00cd_CIO = row.fields.field_2; delete row.fields.field_2; }
      return { items: [row], hasMore: false };
    },
  });
  const snapshot = await create({ repository }).loadSnapshot();
  assert.equal(snapshot.activities[0].stage, "Fundação");
  assert.equal(snapshot.activities[0].activity, "Concreto");
  assert.equal(snapshot.launches[0].startDate, "2026-09-30");
  assert.equal(snapshot.launches[0].percent, 40);
});

test("missing ambiguous unsafe or computed-only metadata rejects even empty lists", async () => {
  for (const override of [
    { async resolveList() { return { status: "missing" }; } },
    { async getColumns() { return null; } },
    { async getColumns(_site, list) { return columns(list).slice(1); } },
    { async getColumns(_site, list) { return [...columns(list), { name: "other", displayName: "FILIAL" }]; } },
    { async getColumns(_site, list) { return columns(list).map((col, i) => i === 0 ? { ...col, name: "unsafe/name" } : col); } },
    { async getColumns(_site, list) { return columns(list).map((col, i) => i === 0 ? { ...col, computed: true } : col); } },
  ]) {
    const { repository } = fixture({ async getItemsPage() { return { items: [], hasMore: false }; }, ...override });
    await assert.rejects(create({ repository }).loadSnapshot(), /lista|coluna|esquema/i);
  }
});

test("pagination of each list crosses the repository 100-page window without limiting rows", async () => {
  const counts = { DEMONSTRATIVOETAPA: 0, LANCAMENTOOBRA: 0 };
  const { repository } = fixture({ async getItemsPage(_site, list, _query, options) {
    const page = ++counts[list];
    assert.equal(options.maxPages, 100); assert.equal(options.pageNumber, (page - 1) % 100 + 1);
    assert.equal(options.cursor || "", page === 1 ? "" : `${list}-${page}`);
    const row = list === "DEMONSTRATIVOETAPA" ? activity : launch;
    return { items: Array.from({ length: 21 }, (_, i) => row((page - 1) * 21 + i + 1)),
      hasMore: page < 101, nextLink: page < 101 ? `${list}-${page + 1}` : "" };
  } });
  const snapshot = await create({ repository }).loadSnapshot();
  assert.equal(snapshot.activities.length, 2121); assert.equal(snapshot.launches.length, 2121);
  assert.equal(snapshot.activities.at(-1).id, "2121"); assert.equal(snapshot.complete, true);
});

test("blank dates and invalid or absent percent are unknown, SharePoint fractions multiply by 100", async () => {
  const values = [undefined, null, "", "abc", Infinity, "1,2,3", -0.1, 1.1, 0, "0,25", 1];
  const { repository } = fixture({ async getItemsPage(_site, list) {
    return { items: list === "DEMONSTRATIVOETAPA" ? [activity(1, { field_5: null, field_6: "" })]
      : values.map((value, i) => launch(i + 1, value === undefined ? "" : value)), hasMore: false };
  } });
  const snapshot = await create({ repository }).loadSnapshot();
  assert.deepEqual(snapshot.launches.map(row => row.percent), [null, null, null, null, null, null, null, null, 0, 25, 100]);
  assert.equal(snapshot.activities[0].executionDate, ""); assert.equal(snapshot.activities[0].plannedDate, "");
});

test("impossible dates reject a snapshot rather than returning invented durations", async () => {
  for (const [list, field, value] of [["DEMONSTRATIVOETAPA", "field_5", "2026-02-30"],
    ["LANCAMENTOOBRA", "field_3", "31/04/2026"], ["LANCAMENTOOBRA", "field_2", "junk"]]) {
    const { repository } = fixture({ async getItemsPage(_site, name) {
      const row = name === "DEMONSTRATIVOETAPA" ? activity() : launch();
      if (name === list) row.fields[field] = value;
      return { items: [row], hasMore: false };
    } });
    await assert.rejects(create({ repository }).loadSnapshot(), /data/i);
  }
});

test("valid small numeric SharePoint fractions remain known rather than disappearing as scientific notation", async () => {
  const { repository } = fixture({ async getItemsPage(_site, list) {
    return { items: list === "DEMONSTRATIVOETAPA" ? [] : [launch(1, 1e-7), launch(2, ".25"), launch(3, "0.5")], hasMore: false };
  } });
  const snapshot = await create({ repository }).loadSnapshot();
  assert.deepEqual(snapshot.launches.map(row => row.percent), [0.000009999999999999999, 25, 50]);
});

test("malformed pages and IDs, duplicate IDs and incomplete flags never produce partial totals", async () => {
  const pages = [null, { items: {}, hasMore: false }, { items: [], nextLink: "" },
    { items: [], hasMore: true, nextLink: "" }, { items: [activity()], hasMore: false, nextLink: "unexpected" },
    { items: [], hasMore: true, nextLink: "next" }, { items: [], hasMore: false, nextLink: 123 },
    { items: [activity()], hasMore: false, batchCount: 2 },
    { items: Array.from({ length: 101 }, (_, i) => activity(i + 1)), hasMore: false },
    { items: [activity(), activity()], hasMore: false },
    ...["", "0", "-1", "1.5", "01", "bad"].map(id => ({ items: [activity(id)], hasMore: false })),
    { items: [{ id: "1", fields: null }], hasMore: false }, { items: [{ id: "1", fields: [] }], hasMore: false },
    ...["partial", "error", "aborted", "truncated"].map(marker => ({ items: [activity()], hasMore: false, [marker]: true }))];
  for (const page of pages) {
    const { repository } = fixture({ async getItemsPage() { return page; } });
    await assert.rejects(create({ repository }).loadSnapshot(), /página|pagin|ID|registro/i);
  }
});

test("cycles with distinct IDs and duplicates across different pages reject the entire load", async () => {
  for (const mode of ["cycle", "duplicate"]) {
    let count = 0;
    const { repository } = fixture({ async getItemsPage(_site, list) {
      if (list !== "DEMONSTRATIVOETAPA") return { items: [], hasMore: false };
      count++;
      return { items: [activity(mode === "duplicate" ? 1 : count)], hasMore: true,
        nextLink: mode === "cycle" ? ["a", "b", "a"][count - 1] : `next-${count}` };
    } });
    await assert.rejects(create({ repository }).loadSnapshot(), /ciclo|duplicad/i);
  }
});

test("remote failure after a successful page rejects rather than exposing the other complete list", async () => {
  const { repository } = fixture({ async getItemsPage(_site, list, _query, options) {
    if (list === "LANCAMENTOOBRA") return { items: [launch()], hasMore: false };
    if (options.cursor) throw new Error("429 SharePoint");
    return { items: [activity()], hasMore: true, nextLink: "next" };
  } });
  await assert.rejects(create({ repository }).loadSnapshot(), /429/);
});

test("abort before work, during ignored transport and after the final page rejects promptly", { timeout: 2000 }, async () => {
  const before = fixture(); const aborted = new AbortController(); aborted.abort();
  await assert.rejects(create({ repository: before.repository }).loadSnapshot({ signal: aborted.signal }), /abort|cancel/i);
  assert.equal(before.calls.length, 0);
  for (const method of ["resolveList", "getColumns", "getItemsPage"]) {
    let started; const start = new Promise(resolve => { started = resolve; });
    const during = fixture({ [method]() { started(); return new Promise(() => {}); } });
    const controller = new AbortController();
    const pending = create({ repository: during.repository }).loadSnapshot({ signal: controller.signal });
    await start; controller.abort(); await assert.rejects(pending, /abort|cancel/i);
  }
  const controller = new AbortController();
  const late = fixture({ async getItemsPage() { controller.abort(); return { items: [], hasMore: false }; } });
  await assert.rejects(create({ repository: late.repository }).loadSnapshot({ signal: controller.signal }), /abort|cancel/i);
});

test("runaway guard rejects more than 100 pages without providing partial totals", async () => {
  let count = 0;
  const { repository } = fixture({ async getItemsPage(_site, list) {
    if (list === "LANCAMENTOOBRA") return { items: [], hasMore: false };
    return { items: [activity(++count)], hasMore: true, nextLink: `next-${count}` };
  } });
  await assert.rejects(create({ repository }).loadSnapshot(), /limite seguro/i);
  assert.ok(count > 100 && count <= 10_000);
});

test("real Graph repository traverses validated next links using only GET", async () => {
  const graph = { async request(path, options = {}) {
    assert.equal(options.method || "GET", "GET");
    if (path.includes("/columns")) return { value: columns(path.includes("/DEMONSTRATIVOETAPA/") ? "DEMONSTRATIVOETAPA" : "LANCAMENTOOBRA") };
    if (path.includes("/DEMONSTRATIVOETAPA/items")) return { value: [activity(path.includes("skiptoken") ? 2 : 1)],
      ...(path.includes("skiptoken") ? {} : { "@odata.nextLink": "https://graph.microsoft.com/v1.0/sites/site/lists/DEMONSTRATIVOETAPA/items?$skiptoken=next" }) };
    if (path.includes("/LANCAMENTOOBRA/items")) return { value: [launch()] };
    if (path.includes("/lists?")) return { value: Object.keys(names).map(id => ({ id, displayName: id, list: { template: "genericList" } })) };
    return { id: "site" };
  } };
  const repository = createSharePointRepository(graph, { personal: { host: "example.sharepoint.com", path: "/sites/test" } });
  const snapshot = await create({ repository }).loadSnapshot();
  assert.equal(snapshot.complete, true); assert.deepEqual(snapshot.activities.map(row => row.id), ["1", "2"]);
});

test("token retrieval is abortable and requests only read scopes", { timeout: 2000 }, async () => {
  let started; const start = new Promise(resolve => { started = resolve; });
  let tokenSignal;
  const controller = new AbortController();
  const pending = create({ tokenProvider(scopes, options) {
    assert.deepEqual(scopes, ["Sites.Read.All"]); tokenSignal = options.signal; started();
    return new Promise(() => {});
  } }).loadSnapshot({ signal: controller.signal });
  await start; controller.abort();
  await assert.rejects(pending, /abort|cancel/i); assert.equal(tokenSignal.aborted, true);
});

test("invalid repository and absent Microsoft session reject at construction", () => {
  assert.throws(() => create(), /sessão|session/i);
  assert.throws(() => create({ repository: {} }), /repositório/i);
});
