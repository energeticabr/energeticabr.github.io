import test from "node:test";
import assert from "node:assert/strict";
import { createSharePointRepository } from "../../../portal/data/sharepoint-repository.js";

const module = await import("../src/chat/commercial-receipts-data.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const create = options => {
  assert.equal(typeof module.createCommercialReceiptsData, "function", "createCommercialReceiptsData must be implemented");
  return module.createCommercialReceiptsData(options);
};
const schemas = {
  "IMOVEL CADASTRADO": ["FILIAL", "IMOVEL", "STATUSVISUAL", "STATUS", "CORRETAGEM", "NF/RECIBO", "FISCAL"],
  LANCAMENTOCOMPRAS: ["FILIAL", "IMOVEL", "NOME", "STATUS", "TOTAL", "DATA VENDA", "CORRETOR"],
  "CADASTRO CLIENTE_1": ["FILIAL", "IMÓVEL ADQUIRIDO", "NOME", "DEFINITIVO"],
  LANÇAMENTORECEITA: ["FILIAL", "IMOVEL", "IDCONTRATO", "FORNECEDOR", "VALORTOTAL", "DATAPGTOEFETUADO",
    "DATAPGTOPREVISTO", "PGTO DIR. CORRETOR", "DESCRIÇÃO", "PRODUTO", "FORMAPGTO", "CONTA", "STATUS"],
};
const values = {
  "IMOVEL CADASTRADO": [" A ", "Casa", "ATIVO", "VENDIDO", "PENDENTE", "NF 1", "DECLARADO"],
  LANCAMENTOCOMPRAS: ["A", "Casa", { Value: "Ana" }, "ATIVO", "R$ 1.234,56", "01/10/2026", "João"],
  "CADASTRO CLIENTE_1": ["A", { LookupValue: "Casa" }, "Ana", { value: "DEFINITIVO" }],
  LANÇAMENTORECEITA: ["A", "Casa", 10, "Ana", "100,25", "2026-10-01T23:30:00-03:00", "", "SIM", "", "Parcela", "PIX", "Banco", "EFETUADO"],
};
const columns = list => schemas[list].map((displayName, index) => ({ name: `field_${index}`, displayName }));
const item = (list, id = "1", overrides = {}) => ({ id: String(id), fields: { ...Object.fromEntries(values[list].map((value, i) => [`field_${i}`, value])), ...overrides } });
function fixture(overrides = {}) {
  const calls = [];
  const repository = {
    async resolveList(site, aliases, { signal }) { assert.equal(site, "personal"); assert.ok(signal); calls.push(aliases[0]); return { status: "resolved", id: aliases[0] }; },
    async getColumns(_site, list, { signal }) { assert.ok(signal); return columns(list); },
    async getItemsPage(site, list, query, options) {
      assert.equal(site, "personal"); assert.ok(options.signal);
      const params = new URLSearchParams(query); assert.equal(params.get("$expand"), "fields");
      assert.equal(params.get("$top"), "100"); assert.equal(params.has("$filter"), false);
      return { items: [item(list)], hasMore: false, nextLink: "", batchCount: 1 };
    },
    createItem() { assert.fail("writes forbidden"); }, updateItem() { assert.fail("writes forbidden"); }, deleteItem() { assert.fail("writes forbidden"); },
    ...overrides,
  };
  return { repository, calls };
}

test("complete read-only snapshot normalizes dynamic fields, descriptions, dates and currencies for all four lists", async () => {
  const { repository, calls } = fixture(); const result = await create({ repository }).loadSnapshot();
  assert.equal(result.complete, true); assert.deepEqual(calls.sort(), Object.keys(schemas).sort());
  assert.deepEqual(result.properties[0], { id: "1", branch: "A", property: "Casa", visualStatus: "ATIVO", saleStatus: "VENDIDO", brokerage: "PENDENTE", invoice: "NF 1", fiscal: "DECLARADO" });
  assert.equal(result.contracts[0].total, 1234.56); assert.equal(result.contracts[0].saleDate, "2026-10-01");
  assert.equal(result.clients[0].definitive, "DEFINITIVO");
  assert.deepEqual(result.receipts[0], { id: "1", branch: "A", property: "Casa", contractId: "10", buyer: "Ana", amount: 100.25,
    paidDate: "2026-10-01", dueDate: "", directBroker: "SIM", description: "Parcela", paymentMethod: "PIX", account: "Banco", status: "EFETUADO" });
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.receipts)); assert.ok(Object.isFrozen(result.receipts[0]));
});

test("renamed Title and encoded labels resolve independently of LinkTitle metadata order", async () => {
  const { repository } = fixture({
    async getColumns(_site, list) { return [{ name: "LinkTitle", displayName: "FILIAL" }, { name: "LinkTitleNoMenu", displayName: "FILIAL" },
      { name: "LinkTitle2", displayName: "FILIAL" }, { name: "Computed", displayName: "FILIAL", computed: {} },
      ...columns(list).map((column, i) => i === 0 ? { name: "Title", displayName: "FILIAL" }
        : list === "LANÇAMENTORECEITA" && i === 7 ? { name: "PGTO_x0020_DIR_x002e__x0020_CORRETOR", displayName: "PGTO DIR. CORRETOR" } : column)]; },
    async getItemsPage(_site, list) { const row = item(list); row.fields.Title = row.fields.field_0; delete row.fields.field_0;
      row.fields.LinkTitle = "WRONG"; if (list === "LANÇAMENTORECEITA") { row.fields.PGTO_x0020_DIR_x002e__x0020_CORRETOR = "SIM"; delete row.fields.field_7; }
      return { items: [row], hasMore: false }; },
  });
  const result = await create({ repository }).loadSnapshot(); assert.equal(result.receipts[0].branch, "A"); assert.equal(result.receipts[0].directBroker, "SIM");
});

test("live SharePoint internal names and actual CADASTRO CLIENTE title produce compatible rows", async () => {
  const liveNames = { "NF/RECIBO": "NF_x002f_RECIBO", "IMÓVEL ADQUIRIDO": "IM_x00d3_VELADQUIRIDO",
    "PGTO DIR. CORRETOR": "PGTODIR_x002e_CORRETOR", "DESCRIÇÃO": "DESCRI_x00c7__x00c3_O", "DATA VENDA": "DATAVENDA" };
  let foundAlias = false;
  const listName = list => list === "CADASTRO CLIENTE" ? "CADASTRO CLIENTE_1" : list;
  const { repository } = fixture({
    async resolveList(_site, aliases) {
      if (aliases[0] === "CADASTRO CLIENTE_1") { foundAlias = aliases.includes("CADASTRO CLIENTE"); return { status: "resolved", id: "CADASTRO CLIENTE" }; }
      return { status: "resolved", id: aliases[0] };
    },
    async getColumns(_site, list) { return columns(listName(list)).map(col => ({ ...col, name: liveNames[col.displayName] || col.name })); },
    async getItemsPage(_site, list) {
      const name = listName(list); const row = item(name);
      columns(name).forEach(col => { if (liveNames[col.displayName]) { row.fields[liveNames[col.displayName]] = row.fields[col.name]; delete row.fields[col.name]; } });
      return { items: [row], hasMore: false };
    },
  });
  const result = await create({ repository }).loadSnapshot();
  assert.equal(foundAlias, true); assert.equal(result.properties[0].invoice, "NF 1");
  assert.equal(result.clients[0].property, "Casa"); assert.equal(result.contracts[0].saleDate, "2026-10-01");
  assert.equal(result.receipts[0].directBroker, "SIM"); assert.equal(result.receipts[0].contractId, "10");
});

test("malformed source IDs cannot become valid through trimming or scalar wrappers", async () => {
  for (const id of [" 1 ", { Value: "1" }, "01", -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const { repository } = fixture({ async getItemsPage(_site, list) { const row = item(list); row.id = id; return { items: [row], hasMore: false }; } });
    await assert.rejects(create({ repository }).loadSnapshot(), /inválid|registro/i);
  }
});

test("every consumed required column resolves uniquely even on empty lists", async () => {
  for (const list of Object.keys(schemas)) for (const displayName of schemas[list].filter(name => !["DESCRIÇÃO", "PRODUTO"].includes(name))) {
    const { repository } = fixture({ async getColumns(_site, name) { return columns(name).filter(col => name !== list || col.displayName !== displayName); },
      async getItemsPage() { return { items: [], hasMore: false }; } });
    await assert.rejects(create({ repository }).loadSnapshot(), /coluna|esquema/i);
  }
  for (const mutate of [cols => null, cols => [...cols, { name: "other", displayName: "FILIAL" }],
    cols => cols.map((col, i) => i === 0 ? { ...col, name: "bad/name" } : col),
    cols => cols.map((col, i) => i === 0 ? { ...col, computed: true } : col)]) {
    const { repository } = fixture({ async getColumns(_site, list) { return mutate(columns(list)); } });
    await assert.rejects(create({ repository }).loadSnapshot(), /coluna|esquema/i);
  }
});

test("description coalesces PRODUTO and rejects schema missing both sources", async () => {
  const { repository } = fixture({ async getColumns(_site, list) { return columns(list).filter(col => col.displayName !== "DESCRIÇÃO"); } });
  assert.equal((await create({ repository }).loadSnapshot()).receipts[0].description, "Parcela");
  const missing = fixture({ async getColumns(_site, list) { return columns(list).filter(col => !["DESCRIÇÃO", "PRODUTO"].includes(col.displayName)); } });
  await assert.rejects(create({ repository: missing.repository }).loadSnapshot(), /coluna|descri/i);
});

test("pagination crosses 100 pages for each list without returning a partial snapshot", async () => {
  const counts = {}; const { repository } = fixture({ async getItemsPage(_site, list, _query, options) {
    const page = counts[list] = (counts[list] || 0) + 1;
    assert.equal(options.pageNumber, (page - 1) % 100 + 1); assert.equal(options.maxPages, 100);
    assert.equal(options.cursor || "", page === 1 ? "" : `${list}-${page}`);
    return { items: [item(list, page)], hasMore: page < 102, nextLink: page < 102 ? `${list}-${page + 1}` : "" };
  } });
  const result = await create({ repository }).loadSnapshot();
  for (const name of ["properties", "contracts", "clients", "receipts"]) assert.equal(result[name].length, 102);
});

test("malformed pages, rows, duplicates and repeated cursors reject the whole snapshot", async () => {
  const pages = [{ items: null, hasMore: false }, { items: [], hasMore: "false" }, { items: [], hasMore: true, nextLink: "next" },
    { items: [], hasMore: false, nextLink: "next" }, { items: [], hasMore: false, partial: true },
    { items: [], hasMore: false, batchCount: 1 }, { items: [], hasMore: false, nextLink: {} },
    { items: [{ id: "0", fields: {} }], hasMore: false }, { items: [{ id: "1", fields: [] }], hasMore: false },
    { items: [item("LANÇAMENTORECEITA"), item("LANÇAMENTORECEITA")], hasMore: false },
    { items: Array.from({ length: 101 }, (_, i) => item("LANÇAMENTORECEITA", i + 1)), hasMore: false }];
  for (const page of pages) { const { repository } = fixture({ async getItemsPage(_site, list) { return list === "LANÇAMENTORECEITA" ? page : { items: [], hasMore: false }; } });
    await assert.rejects(create({ repository }).loadSnapshot(), /inválid|incomplet|duplic|pagina/i); }
  for (const mode of ["duplicate", "cycle"]) {
    let count = 0; const { repository } = fixture({ async getItemsPage(_site, list) {
      if (list !== "LANÇAMENTORECEITA") return { items: [], hasMore: false };
      return { items: [item(list, mode === "duplicate" ? 1 : ++count)], hasMore: true, nextLink: "next" };
    } }); await assert.rejects(create({ repository }).loadSnapshot(), /duplic|cursor|ciclo/i);
  }
});

test("blank money and dates stay unknown; nonblank invalid values reject instead of becoming zero or pending", async () => {
  for (const value of [undefined, null, "", "   "]) {
    const { repository } = fixture({ async getItemsPage(_site, list) { return { items: [list === "LANÇAMENTORECEITA"
      ? item(list, 1, { field_4: value, field_5: value, field_6: value }) : item(list)], hasMore: false }; } });
    const row = (await create({ repository }).loadSnapshot()).receipts[0]; assert.equal(row.amount, null); assert.equal(row.paidDate, ""); assert.equal(row.dueDate, "");
  }
  for (const fields of [{ field_4: "R$ junk 100" }, { field_4: "1,2,3" }, { field_4: Infinity }, { field_4: true },
    { field_5: "2026-02-30" }, { field_6: "01/13/2026" }, { field_5: {} }, { field_3: {} }, { field_2: "abc" }]) {
    const { repository } = fixture({ async getItemsPage(_site, list) { return { items: [item(list, 1, list === "LANÇAMENTORECEITA" ? fields : {})], hasMore: false }; } });
    await assert.rejects(create({ repository }).loadSnapshot(), /inválid|valor|data|campo|contrato/i);
  }
});

test("remote failure cancels sibling operations and never exposes completed lists", { timeout: 2000 }, async () => {
  let siblingSignal;
  const { repository } = fixture({ async getItemsPage(_site, list, _query, { signal }) {
    if (list === "LANÇAMENTORECEITA") throw new Error("429 SharePoint");
    siblingSignal = signal; return new Promise(() => {});
  } });
  await assert.rejects(create({ repository }).loadSnapshot(), /429/); assert.equal(siblingSignal.aborted, true);
});

test("failure after a successful page never returns accumulated rows", async () => {
  const { repository } = fixture({ async getItemsPage(_site, list, _query, options) {
    if (list !== "LANÇAMENTORECEITA") return { items: [item(list)], hasMore: false };
    if (options.cursor) throw new Error("503 after page one");
    return { items: [item(list)], hasMore: true, nextLink: "next" };
  } });
  await assert.rejects(create({ repository }).loadSnapshot(), /503 after page one/);
});

test("runaway cursor traversal rejects rather than silently marking capped rows complete", async () => {
  let pages = 0;
  const { repository } = fixture({ async getItemsPage(_site, list) {
    if (list !== "LANÇAMENTORECEITA") return { items: [], hasMore: false };
    return { items: [item(list, ++pages)], hasMore: true, nextLink: `next-${pages}` };
  } });
  await assert.rejects(create({ repository }).loadSnapshot(), /limite seguro|total parcial/i);
  assert.ok(pages > 100 && pages <= 10000);
});

test("abort rejects promptly even when repository or token promises ignore the signal", { timeout: 2000 }, async () => {
  const before = fixture(); const aborted = new AbortController(); aborted.abort();
  await assert.rejects(create({ repository: before.repository }).loadSnapshot({ signal: aborted.signal }), /abort|cancel/i); assert.equal(before.calls.length, 0);
  for (const method of ["resolveList", "getColumns", "getItemsPage"]) {
    let started; const start = new Promise(resolve => { started = resolve; }); const controller = new AbortController();
    const { repository } = fixture({ [method]() { started(); return new Promise(() => {}); } });
    const promise = create({ repository }).loadSnapshot({ signal: controller.signal }); await start; controller.abort(); await assert.rejects(promise, /abort|cancel/i);
  }
  let started; const start = new Promise(resolve => { started = resolve; }); const controller = new AbortController();
  const promise = create({ tokenProvider(scopes, { signal }) { assert.deepEqual(scopes, ["Sites.Read.All"]); assert.ok(signal); started(); return new Promise(() => {}); } }).loadSnapshot({ signal: controller.signal });
  await start; controller.abort(); await assert.rejects(promise, /abort|cancel/i);
});

test("late abort, missing lists and invalid construction reject", async () => {
  const controller = new AbortController(); const late = fixture({ async getItemsPage() { controller.abort(); return { items: [], hasMore: false }; } });
  await assert.rejects(create({ repository: late.repository }).loadSnapshot({ signal: controller.signal }), /abort|cancel/i);
  const missing = fixture({ async resolveList() { return { status: "missing" }; } });
  await assert.rejects(create({ repository: missing.repository }).loadSnapshot(), /lista/i);
  assert.throws(() => create(), /sessão/i); assert.throws(() => create({ repository: {} }), /repositório/i);
});

test("real SharePoint repository follows Graph next links using GET only", async () => {
  const graph = { async request(path, options = {}) {
    assert.equal(options.method || "GET", "GET");
    const list = Object.keys(schemas).find(name => path.includes(`/lists/${encodeURIComponent(name)}/`));
    if (path.includes("/columns")) return { value: columns(list) };
    if (path.includes("/items")) return { value: [item(list, path.includes("skiptoken") ? 2 : 1)],
      ...(path.includes("skiptoken") ? {} : { "@odata.nextLink": `https://graph.microsoft.com/v1.0/sites/site/lists/${encodeURIComponent(list)}/items?$skiptoken=next` }) };
    if (path.includes("/lists?")) return { value: Object.keys(schemas).map(id => ({ id, displayName: id, list: { template: "genericList" } })) };
    return { id: "site" };
  } };
  const repository = createSharePointRepository(graph, { personal: { host: "example.sharepoint.com", path: "/sites/test" } });
  const result = await create({ repository }).loadSnapshot(); assert.equal(result.complete, true); assert.equal(result.receipts.length, 2);
});
