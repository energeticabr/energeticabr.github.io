import test from "node:test";
import assert from "node:assert/strict";
import { createSharePointRepository } from "../../../portal/data/sharepoint-repository.js";

const module = await import("../src/chat/commercial-documents-data.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const create = options => {
  assert.equal(typeof module.createCommercialDocumentsData, "function", "createCommercialDocumentsData must be implemented");
  return module.createCommercialDocumentsData(options);
};
const schemas = {
  "IMOVEL CADASTRADO": ["FILIAL", "IMOVEL", "STATUS", "STATUSVISUAL", "FISCAL", "SEGURO", "IDPROPOSTA", "IDCONTRATOCAIXA",
    "IDESCRITURA", "IDDOCUMENTOCORRETAGEM", "IDDOCFISCAL", "IDPGTOFISCAL", "IDPGTOCORRETAGEM", "OBS FISCAL", "CORRETAGEM",
    "CORRETOR", "DESCRITIVO CORRETAGEM", "VLORFISCAL", "VLORCORRETAGEM"],
  LANCAMENTOCOMPRAS: ["FILIAL", "IMOVEL", "NOME", "STATUS", "TOTAL", "DATA VENDA", "CORRETOR"],
  DOCUMENTOS_1: ["Created"], LANCAMENTOS: ["DATA PGTO EFETUADO"],
  "LANÇAMENTORECEITA": ["IDCONTRATO", "Created", "DATAPGTOPREVISTO", "DATAPGTOEFETUADO", "DESCRIÇÃO", "PRODUTO", "VALORTOTAL", "STATUS"],
};
const values = {
  "IMOVEL CADASTRADO": [" A ", { LookupValue: "Casa" }, "VENDIDO", "ATIVO", "DECLARADO", "0010", "10; 11", "DISPENSADO",
    "ABC/10", "10", "10", "20", "20", "Obs", "SIM", "João", "Comissão", " ", "0,00"],
  LANCAMENTOCOMPRAS: ["A", "Casa", { Value: "Ana" }, "ATIVO", "1.234,50", "2026-10-01T23:30:00-03:00", "João"],
  DOCUMENTOS_1: ["2026-09-01T23:30:00-03:00"], LANCAMENTOS: ["02/10/2026"],
  "LANÇAMENTORECEITA": ["100", "2026-09-01", "05/10/2026", "", "", "Parcela", "0", "PREVISTO"],
};
const columns = list => schemas[list].map((displayName, i) => ({ name: `field_${i}`, displayName,
  ...(displayName === "Created" ? { hidden: true, readOnly: true } : {}) }));
const item = (list, id = 1, extra = {}) => ({ id: String(id), fields: { ...Object.fromEntries(values[list].map((v, i) => [`field_${i}`, v])), ...extra } });
function fixture(overrides = {}) {
  const repository = {
    async resolveList(site, aliases, { signal }) { assert.equal(site, "personal"); assert.ok(signal); return { status: "resolved", id: aliases[0] }; },
    async getColumns(_site, list, { signal }) { assert.ok(signal); return columns(list); },
    async getItemsPage(site, list, query, options) {
      assert.equal(site, "personal"); assert.ok(options.signal); const params = new URLSearchParams(query);
      assert.equal(params.get("$expand"), "fields"); assert.equal(params.get("$top"), "100"); assert.equal(params.has("$filter"), false);
      return { items: [item(list)], hasMore: false, batchCount: 1 };
    },
    createItem() { assert.fail("writes forbidden"); }, updateItem() { assert.fail("writes forbidden"); }, deleteItem() { assert.fail("writes forbidden"); },
    ...overrides,
  };
  return { repository };
}

test("atomic five-list snapshot normalizes consumed fields and preserves text IDs blank money and chronology", async () => {
  const result = await create(fixture()).loadSnapshot();
  assert.equal(result.complete, true); assert.deepEqual(Object.keys(result), ["complete", "properties", "contracts", "documents", "expenses", "receipts"]);
  assert.deepEqual(result.properties[0], { id: "1", branch: "A", property: "Casa", saleStatus: "VENDIDO", visualStatus: "ATIVO", fiscal: "DECLARADO",
    insurance: "0010", proposal: "10; 11", bankContract: "DISPENSADO", deed: "ABC/10", brokerDocument: "10", fiscalDocument: "10", fiscalPayment: "20",
    brokerPayment: "20", fiscalObservation: "Obs", brokerage: "SIM", broker: "João", brokerDescription: "Comissão", fiscalValue: null, brokerValue: 0 });
  assert.equal(result.contracts[0].total, 1234.5); assert.equal(result.contracts[0].saleDate, "2026-10-01");
  assert.equal(result.contracts[0].saleOrder, Date.parse("2026-10-02T02:30:00Z"));
  assert.deepEqual(result.documents[0], { id: "1", createdDate: "2026-09-01" });
  assert.deepEqual(result.expenses[0], { id: "1", paidDate: "2026-10-02" });
  assert.deepEqual(result.receipts[0], { id: "1", contractId: "100", createdDate: "2026-09-01", dueDate: "2026-10-05", paidDate: "", description: "Parcela", amount: 0, status: "PREVISTO" });
  assert.ok(Object.isFrozen(result)); for (const name of ["properties", "contracts", "documents", "expenses", "receipts"]) {
    assert.ok(Object.isFrozen(result[name])); assert.ok(Object.isFrozen(result[name][0]));
  }
});

test("all consumed columns are required even on empty lists except description OR product", async () => {
  for (const list of Object.keys(schemas)) for (const field of schemas[list].filter(name => !["DESCRIÇÃO", "PRODUTO"].includes(name))) {
    const { repository } = fixture({ async getColumns(_site, name) { return columns(name).filter(c => name !== list || c.displayName !== field); },
      async getItemsPage() { return { items: [], hasMore: false }; } });
    await assert.rejects(create({ repository }).loadSnapshot(), /coluna|esquema/i);
  }
  const { repository } = fixture({ async getColumns(_site, name) { return columns(name).filter(c => !["DESCRIÇÃO", "PRODUTO"].includes(c.displayName)); } });
  await assert.rejects(create({ repository }).loadSnapshot(), /DESCRIÇÃO|PRODUTO/i);
});

test("description wins when populated and product works alone as a schema and row fallback", async () => {
  for (const mode of ["description", "product"]) {
    const { repository } = fixture({ async getColumns(_site, list) { return columns(list).filter(c => c.displayName !== (mode === "product" ? "DESCRIÇÃO" : "PRODUTO")); },
      async getItemsPage(_site, list) { return { items: [item(list, 1, list === "LANÇAMENTORECEITA" ? { field_4: "Descrição", field_5: "Produto" } : {})], hasMore: false }; } });
    assert.equal((await create({ repository }).loadSnapshot()).receipts[0].description, mode === "product" ? "Produto" : "Descrição");
  }
});

test("metadata permits hidden Created builtin renamed Title and encoded column names", async () => {
  const { repository } = fixture({ async getColumns(_site, list) { return [{ name: "LinkTitle", displayName: "FILIAL" },
    { name: "LinkTitleNoMenu", displayName: "FILIAL" }, { name: "Computed", displayName: "FILIAL", computed: {} },
    ...columns(list).map(c => c.displayName === "FILIAL" ? { ...c, name: "Title" } : c.displayName === "Created"
      ? { name: "Created", displayName: "Criado", hidden: true, readOnly: true } : c.displayName === "OBS FISCAL"
        ? { name: "OBS_x0020_FISCAL", displayName: "OBS FISCAL" } : c)]; },
    async getItemsPage(_site, list) { const row = item(list); row.fields.Title = row.fields.field_0;
      row.fields.OBS_x0020_FISCAL = row.fields.field_13;
      row.fields.Created = list === "DOCUMENTOS_1" ? row.fields.field_0 : row.fields.field_1;
      return { items: [row], hasMore: false }; } });
  const result = await create({ repository }).loadSnapshot(); assert.equal(result.properties[0].branch, "A");
  assert.equal(result.documents[0].createdDate, "2026-09-01"); assert.equal(result.properties[0].fiscalObservation, "Obs");
});

test("ambiguous unsafe computed and reused column names reject before trusting data", async () => {
  for (const mutate of [() => null, cols => [...cols, { name: "duplicate", displayName: cols[0].displayName }],
    cols => cols.map((c, i) => i === 0 ? { ...c, name: "bad/name" } : c),
    cols => cols.map((c, i) => i === 0 ? { ...c, computed: true } : c),
    cols => cols.map((c, i) => i === 1 ? { ...c, name: "field_0" } : c)]) {
    const { repository } = fixture({ async getColumns(_site, list) { return mutate(columns(list)); } });
    await assert.rejects(create({ repository }).loadSnapshot(), /coluna|esquema/i);
  }
});

test("complete pagination exceeds 2000 rows and crosses repository windows on every list", async () => {
  const counts = {};
  const { repository } = fixture({ async getItemsPage(_site, list, _query, options) {
    const page = counts[list] = (counts[list] || 0) + 1;
    assert.equal(options.pageNumber, (page - 1) % 100 + 1); assert.equal(options.maxPages, 100);
    assert.equal(options.cursor || "", page === 1 ? "" : `${list}-${page}`);
    return { items: Array.from({ length: 21 }, (_, i) => item(list, (page - 1) * 21 + i + 1)), hasMore: page < 102,
      nextLink: page < 102 ? `${list}-${page + 1}` : "" };
  } });
  const result = await create({ repository }).loadSnapshot();
  for (const kind of ["properties", "contracts", "documents", "expenses", "receipts"]) assert.equal(result[kind].length, 2142);
});

test("malformed partial and inconsistent pages fail the entire snapshot", async () => {
  for (const page of [{ items: null, hasMore: false }, { items: [], hasMore: "false" }, { items: [], hasMore: true, nextLink: "next" },
    { items: [item("DOCUMENTOS_1")], hasMore: true }, { items: [], hasMore: false, nextLink: "next" },
    ...["partial", "incomplete", "aborted", "truncated", "error"].map(flag => ({ items: [], hasMore: false, [flag]: true })),
    { items: [], hasMore: false, complete: false }, { items: [], hasMore: false, batchCount: 1 },
    { items: [], hasMore: false, nextLink: {} }, { items: Array.from({ length: 101 }, (_, i) => item("DOCUMENTOS_1", i + 1)), hasMore: false }]) {
    const { repository } = fixture({ async getItemsPage(_site, list) { return list === "DOCUMENTOS_1" ? page : { items: [], hasMore: false }; } });
    await assert.rejects(create({ repository }).loadSnapshot(), /página|pagina|incomplet|inválid/i);
  }
});

test("duplicate IDs and cursor cycles reject for all five sources", async () => {
  for (const target of Object.keys(schemas)) for (const mode of ["same-page", "duplicate", "cycle"]) {
    let count = 0;
    const { repository } = fixture({ async getItemsPage(_site, list) {
      if (list !== target) return { items: [], hasMore: false };
      if (mode === "same-page") return { items: [item(list), item(list)], hasMore: false };
      return { items: [item(list, mode === "duplicate" ? 1 : ++count)], hasMore: true, nextLink: "next" };
    } });
    await assert.rejects(create({ repository }).loadSnapshot(), /duplic|cursor|ciclo/i);
  }
});

test("invalid source record IDs and non-scalar values cannot become blanks", async () => {
  for (const id of [" 1 ", "01", "0", -1, 1.5, Number.MAX_SAFE_INTEGER + 1, { Value: 1 }]) {
    const { repository } = fixture({ async getItemsPage(_site, list) { const row = item(list); row.id = id; return { items: [row], hasMore: false }; } });
    await assert.rejects(create({ repository }).loadSnapshot(), /ID|inválid/i);
  }
  for (const fields of [null, [], "bad"]) {
    const { repository } = fixture({ async getItemsPage(_site, list) { return { items: [{ id: "1", fields }], hasMore: false }; } });
    await assert.rejects(create({ repository }).loadSnapshot(), /registro|campo|inválid/i);
  }
  for (const raw of [{}, ["10", "11"], true, Infinity]) {
    const { repository } = fixture({ async getItemsPage(_site, list) { return { items: [item(list, 1, list === "IMOVEL CADASTRADO" ? { field_6: raw } : {})], hasMore: false }; } });
    await assert.rejects(create({ repository }).loadSnapshot(), /campo|inválid/i);
  }
});

test("invalid calendar dates and monetary strings reject atomically", async () => {
  for (const [target, extra] of [["DOCUMENTOS_1", { field_0: "2026-02-30" }], ["LANCAMENTOS", { field_0: "31/04/2026" }],
    ["LANCAMENTOCOMPRAS", { field_5: "2026-10-01T24:00:00Z" }], ["LANCAMENTOCOMPRAS", { field_4: "bad" }],
    ["LANÇAMENTORECEITA", { field_3: "bad" }], ["IMOVEL CADASTRADO", { field_18: true }]]) {
    const { repository } = fixture({ async getItemsPage(_site, list) { return { items: [item(list, 1, list === target ? extra : {})], hasMore: false }; } });
    await assert.rejects(create({ repository }).loadSnapshot(), /data|valor|campo|inválid/i);
  }
});
test("property text monetary fallback reaches the model without coercion to zero or rejecting the report", async () => {
 const {repository}=fixture({async getItemsPage(_site,list){return {items:[item(list,1,list==="IMOVEL CADASTRADO"?{field_17:" ISENTO ",field_18:"DISPENSADO"}:{})],hasMore:false};}});
 const source=await create({repository}).loadSnapshot();
 assert.equal(source.properties[0].fiscalValue,"ISENTO");assert.equal(source.properties[0].brokerValue,"DISPENSADO");
});

test("failure after a page aborts siblings without exposing a partial snapshot", { timeout: 2000 }, async () => {
  let siblingSignal;
  const { repository } = fixture({ async getItemsPage(_site, list, _query, { signal, cursor }) {
    if (list !== "DOCUMENTOS_1") { siblingSignal = signal; return new Promise(() => {}); }
    if (cursor) throw new Error("503 after first page"); return { items: [item(list)], hasMore: true, nextLink: "next" };
  } });
  await assert.rejects(create({ repository }).loadSnapshot(), /503 after first page/); assert.equal(siblingSignal.aborted, true);
});

test("pre-abort and ignored cancellation settle promptly at each repository stage", { timeout: 2000 }, async () => {
  const pre = new AbortController(); pre.abort(); await assert.rejects(create(fixture()).loadSnapshot({ signal: pre.signal }), /abort|cancel/i);
  for (const method of ["resolveList", "getColumns", "getItemsPage"]) {
    let started; const ready = new Promise(resolve => { started = resolve; }); const controller = new AbortController();
    const { repository } = fixture({ [method]() { started(); return new Promise(() => {}); } });
    const pending = create({ repository }).loadSnapshot({ signal: controller.signal }); await ready; controller.abort();
    await assert.rejects(pending, /abort|cancel/i);
  }
});

test("custom late abort missing lists invalid repository and missing session fail closed", async () => {
  const controller = new AbortController(); const reason = new Error("custom cancelled");
  const { repository } = fixture({ async getItemsPage() { controller.abort(reason); return { items: [], hasMore: false }; } });
  await assert.rejects(create({ repository }).loadSnapshot({ signal: controller.signal }), error => error === reason);
  await assert.rejects(create(fixture({ async resolveList() { return { status: "missing" }; } })).loadSnapshot(), /lista/i);
  assert.throws(() => create(), /sessão/i); assert.throws(() => create({ repository: {} }), /repositório/i);
});

test("token failures and token transport ignoring cancellation reject under read scopes", { timeout: 2000 }, async () => {
  await assert.rejects(create({ tokenProvider() { throw new Error("401 expired"); } }).loadSnapshot(), /401/);
  await assert.rejects(create({ tokenProvider() { return ""; } }).loadSnapshot(), /token/i);
  let started; const ready = new Promise(resolve => { started = resolve; }); const controller = new AbortController();
  const pending = create({ tokenProvider(scopes, { signal }) { assert.deepEqual(scopes, ["Sites.Read.All"]); assert.ok(signal); started(); return new Promise(() => {}); } })
    .loadSnapshot({ signal: controller.signal });
  await ready; controller.abort(); await assert.rejects(pending, /abort|cancel/i);
});

function graphPayload(path) {
  const list = Object.keys(schemas).find(name => path.includes(`/lists/${encodeURIComponent(name)}/`));
  if (path.includes("/columns")) return { value: columns(list) };
  if (path.includes("/items")) return { value: [item(list, path.includes("skiptoken") ? 2 : 1)], ...(path.includes("skiptoken") ? {} : {
    "@odata.nextLink": `https://graph.microsoft.com/v1.0/sites/site/lists/${encodeURIComponent(list)}/items?$skiptoken=next` }) };
  if (path.includes("/lists?")) return { value: Object.keys(schemas).map(id => ({ id, displayName: id, list: { template: "genericList" } })) };
  return { id: "site" };
}

test("real Graph client authenticates every GET and fully paginates the five permitted lists", async () => {
  const original = globalThis.fetch; const requests = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(options.method, "GET"); assert.equal(options.body, undefined); assert.equal(options.headers.Authorization, "Bearer test-session");
    requests.push(url); return { ok: true, status: 200, json: async () => graphPayload(url) };
  };
  try {
    const result = await create({ tokenProvider(scopes) { assert.deepEqual(scopes, ["Sites.Read.All"]); return "test-session"; } }).loadSnapshot();
    for (const kind of ["properties", "contracts", "documents", "expenses", "receipts"]) assert.equal(result[kind].length, 2);
    assert.ok(requests.some(url => url.includes("skiptoken"))); assert.equal(result.complete, true);
  } finally { globalThis.fetch = original; }
});

test("real repository validates paginated column metadata and rejects foreign next links", async () => {
  for (const foreign of [false, true]) {
    const graph = { async request(path, options = {}) {
      assert.equal(options.method || "GET", "GET");
      const list = Object.keys(schemas).find(name => path.includes(`/lists/${encodeURIComponent(name)}/`));
      if (path.includes("/columns")) return { value: path.includes("skiptoken") ? columns(list).slice(1) : columns(list).slice(0, 1),
        ...(path.includes("skiptoken") ? {} : { "@odata.nextLink": `https://graph.microsoft.com/v1.0/sites/site/lists/${encodeURIComponent(list)}/columns?$skiptoken=next` }) };
      if (foreign && path.includes("/items")) return { value: [item(list)], "@odata.nextLink": "https://evil.example/items" };
      return graphPayload(path);
    } };
    const repository = createSharePointRepository(graph, { personal: { host: "example.sharepoint.com", path: "/sites/test" } });
    if (foreign) await assert.rejects(create({ repository }).loadSnapshot(), /nextLink|pagin|inválid|invalido/i);
    else assert.equal((await create({ repository }).loadSnapshot()).properties[0].brokerValue, 0);
  }
});

test("real repository picks DOCUMENTOS_1 when both exist and falls back to actual DOCUMENTOS Created", async () => {
  for (const includeAlias of [true, false]) {
    const requests = [];
    const graph = { async request(path, options = {}) {
      assert.equal(options.method || "GET", "GET"); requests.push(path);
      if (path.includes("/lists?")) return { value: [{ id: "physical-docs", displayName: "DOCUMENTOS", list: { template: "genericList" } },
        ...Object.keys(schemas).filter(name => includeAlias || name !== "DOCUMENTOS_1")
          .map(id => ({ id, displayName: id, list: { template: "genericList" } }))] };
      if (path.includes("/lists/physical-docs/columns")) return { value: [{ name: "Created", displayName: "Criado", hidden: true, readOnly: true, dateTime: {} }] };
      if (path.includes("/lists/physical-docs/items")) return { value: [{ id: "10", fields: { Created: "2026-09-02" } }] };
      return graphPayload(path);
    } };
    const repository = createSharePointRepository(graph, { personal: { host: "example.sharepoint.com", path: "/sites/test" } });
    const result = await create({ repository }).loadSnapshot();
    assert.equal(result.documents[0].createdDate, includeAlias ? "2026-09-01" : "2026-09-02");
    assert.equal(requests.some(path => path.includes("/lists/physical-docs/items")), !includeAlias);
  }
});

test("confirmed internal text and multiline property schema plus expense paid date reach the model", async () => {
  const { repository } = fixture({ async getColumns(_site, list) {
    return schemas[list].map(displayName => ({ name: displayName.replaceAll(" ", "").replace("Ç", "C").replace("Ã", "A"),
      displayName, ...(displayName === "Created" ? { hidden: true, readOnly: true } : { text: {} }) }));
  }, async getItemsPage(_site, list) {
    const fields = Object.fromEntries(schemas[list].map((name, i) => [name.replaceAll(" ", "").replace("Ç", "C").replace("Ã", "A"), values[list][i]]));
    return { items: [{ id: list === "LANCAMENTOCOMPRAS" ? "100" : list === "LANCAMENTOS" ? "20" : list === "DOCUMENTOS_1" ? "10" : "1", fields }], hasMore: false };
  } });
  const source = await create({ repository }).loadSnapshot();
  const { buildCommercialDocuments } = await import("../src/chat/commercial-documents-model.js");
  const result = buildCommercialDocuments(source, { property: "Casa" }, "2026-10-05");
  assert.equal(result.rows[0].fiscalObservation, "Obs"); assert.equal(result.rows[0].brokerDescription, "Comissão");
  assert.equal(result.rows[0].ids.insurance.date, "2026-09-01"); assert.equal(result.rows[0].ids.fiscalPayment.date, "2026-10-02");
  assert.equal(result.rows[0].ids.proposal.date, ""); assert.equal(result.rows[0].contracts[0].payments[0].description, "Parcela");
  assert.equal(result.rows[0].pendingMeasures, 0); assert.equal(result.rows[0].pendingFields, 1);
});

test("blank Created stays blank and submission/date columns cannot substitute missing builtin metadata", async () => {
  const { repository } = fixture({ async getColumns(_site, list) {
    if (list === "DOCUMENTOS_1") return [{ name: "DATASUBMETIDO", displayName: "DATA SUBMETIDO" }, { name: "DATA", displayName: "DATA" }];
    return columns(list);
  } });
  await assert.rejects(create({ repository }).loadSnapshot(), /Created/i);
  const blank = fixture({ async getItemsPage(_site, list) {
    return { items: [item(list, 1, list === "DOCUMENTOS_1" ? { field_0: "", DATASUBMETIDO: "2026-10-01", DATA: "2026-10-02" } : {})], hasMore: false };
  } });
  assert.equal((await create(blank).loadSnapshot()).documents[0].createdDate, "");
});

test("runaway pages fail closed after the safety bound instead of truncating the data", async () => {
  let count = 0;
  const { repository } = fixture({ async getItemsPage(_site, list) {
    if (list !== "DOCUMENTOS_1") return { items: [], hasMore: false };
    return { items: [item(list, ++count)], hasMore: true, nextLink: `next-${count}` };
  } });
  await assert.rejects(create({ repository }).loadSnapshot(), /limite|parcial/i); assert.equal(count, 10000);
});

test("array-shaped records reject and textual receipt contract references remain unaltered", async () => {
  const malformed = fixture({ async getItemsPage(_site, list) { return { items: [Object.assign([], item(list))], hasMore: false }; } });
  await assert.rejects(create(malformed).loadSnapshot(), /registro|inválid/i);
  for (const value of ["00100", "ABC/100", "0", "-1", "9007199254740993"]) {
    const source = fixture({ async getItemsPage(_site, list) { return { items: [item(list, 1, list === "LANÇAMENTORECEITA" ? { field_0: value } : {})], hasMore: false }; } });
    assert.equal((await create(source).loadSnapshot()).receipts[0].contractId, value);
  }
});
