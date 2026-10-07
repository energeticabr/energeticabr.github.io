import test from "node:test";
import assert from "node:assert/strict";
import { createSharePointRepository } from "../../../portal/data/sharepoint-repository.js";

const api = await import("../src/chat/supplier-workforce-report-data.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const create = options => {
  assert.equal(typeof api.createSupplierWorkforceReportData, "function", "workforce data source must be implemented");
  return api.createSupplierWorkforceReportData(options);
};
const values = {
  FORNECEDORES: { CADASTRO: "Ana", FILIAL: "A", IMOVEL: "Casa", PROFISSAO: "PEDREIRO", STATUS: "ATIVO",
    EMPREITEIRO: "SIM", "FORMA PGTO": "DIÁRIA", "VLR DIARIO": "100,00", "DESCRITIVOETAPA ATUAL": { Value: "122" },
    "ATIVIDADE EXERCIDA": "Alvenaria", MEDIÇÃOATUAL: { Value: "0,5 m²" } },
  DESCRITIVOPRESENCA: { DATA: "2026-10-07T23:59:59-03:00", FILIAL: "A", IMOVEL: "Obra",
    FORNECEDOR: { LookupValue: "Ana" }, ETAPA: { Value: "122" }, PRESENCA: { Value: "PRESENTE" } },
};
const columns = list => Object.keys(values[list]).map((displayName, i) => ({ name: `f_${i}`, displayName }));
const item = (list, id = 1, changes = {}) => ({ id: String(id), fields: Object.fromEntries(columns(list).map(column =>
  [column.name, Object.hasOwn(changes, column.displayName) ? changes[column.displayName] : values[list][column.displayName]])) });
function fixture(overrides = {}) {
  return { async resolveList(site, aliases, { signal }) {
    assert.equal(site, "personal"); assert.ok(signal); assert.ok(Object.hasOwn(values, aliases[0]));
    return { status: "resolved", id: aliases[0] };
  }, async getColumns(_site, list) { return columns(list); },
  async getItemsPage(_site, list, query, options) {
    assert.equal(new URLSearchParams(query).get("$expand"), "fields");
    assert.equal(new URLSearchParams(query).get("$top"), "100");
    assert.ok(options.pageNumber <= options.maxPages && options.maxPages <= 100);
    return { items: [item(list)], hasMore: false, nextLink: "", batchCount: 1 };
  }, ...overrides };
}

// Break: requiring payment lists/fields prevents opening this two-list readonly workforce report.
test("complete immutable source requires only supplier registry and presence workforce fields", async () => {
  const data = await create({ repository: fixture() }).loadSnapshot();
  assert.equal(data.complete, true);
  assert.ok(Object.isFrozen(data)); assert.ok(Object.isFrozen(data.suppliers)); assert.ok(Object.isFrozen(data.presences));
  assert.ok(Object.isFrozen(data.suppliers[0])); assert.ok(Object.isFrozen(data.warnings));
  assert.equal(data.suppliers[0].contractor, true);
  assert.equal(data.suppliers[0].dailyValue, 100);
  assert.equal(data.suppliers[0].dailyValueBlank, false);
  assert.equal(data.suppliers[0].stage, "122");
  assert.equal(data.suppliers[0].measurement, "0,5 m²");
  assert.equal(data.presences[0].date, "2026-10-07");
  assert.equal(data.presences[0].supplier, "Ana");
  assert.equal(data.presences[0].stage, "122");
  assert.equal(Object.hasOwn(data, "launches"), false);
  assert.deepEqual(data.warnings, []);
});

test("strict metadata resolves renamed Title and encoded aliases while ignoring computed LinkTitle fields", async () => {
  const repository = fixture({ async getColumns(_site, list) {
    return columns(list).map(column => column.displayName === "CADASTRO" ? { ...column, name: "Title" }
      : column.displayName === "VLR DIARIO" ? { ...column, name: "VLR_x0020_DI_x00c1_RIO" } : column)
      .concat(list === "FORNECEDORES" ? [{ name: "LinkTitle", displayName: "CADASTRO" },
        { name: "LinkTitleNoMenu", displayName: "CADASTRO" }, { name: "LinkTitle2", displayName: "CADASTRO" },
        { name: "computed", displayName: "VLR DIARIO", computed: {} }] : []);
  }, async getItemsPage(_site, list) {
    const row = item(list);
    if (list === "FORNECEDORES") { row.fields.Title = "Ana"; delete row.fields.f_0;
      row.fields.VLR_x0020_DI_x00c1_RIO = "0,3"; delete row.fields.f_7; }
    return { items: [row], hasMore: false };
  } });
  const data = await create({ repository }).loadSnapshot();
  assert.equal(data.suppliers[0].name, "Ana"); assert.equal(data.suppliers[0].dailyValue, 0.3);
});

test("optional registry descriptions require metadata or explicit missing-column warnings", async () => {
  const repository = fixture({ async getColumns(_site, list) {
    return columns(list).filter(column => !["DESCRITIVOETAPA ATUAL", "ATIVIDADE EXERCIDA", "MEDIÇÃOATUAL"].includes(column.displayName));
  }, async getItemsPage(_site, list) {
    const row = item(list); row.fields["DESCRITIVOETAPA ATUAL"] = "must not leak";
    row.fields.MEDIÇÃOATUAL = "must not leak"; return { items: [row], hasMore: false };
  } });
  const data = await create({ repository }).loadSnapshot();
  assert.equal(data.suppliers[0].stage, ""); assert.equal(data.suppliers[0].activity, ""); assert.equal(data.suppliers[0].measurement, "");
  assert.equal(data.warnings.length, 3);
  assert.ok(data.warnings.every(message => /coluna opcional.*ausente/i.test(message)));
});

test("missing filter/grouping metadata and ambiguous aliases fail closed even for empty lists", async () => {
  for (const [list, field] of [["FORNECEDORES", "CADASTRO"], ["FORNECEDORES", "PROFISSAO"],
    ["FORNECEDORES", "IMOVEL"], ["DESCRITIVOPRESENCA", "ETAPA"], ["DESCRITIVOPRESENCA", "IMOVEL"]]) {
    const repository = fixture({ async getColumns(_site, name) {
      return columns(name).filter(column => name !== list || column.displayName !== field);
    }, async getItemsPage() { return { items: [], hasMore: false }; } });
    await assert.rejects(create({ repository }).loadSnapshot(), /coluna.*ausente/i);
  }
  await assert.rejects(create({ repository: fixture({ async getColumns(_site, list) {
    return columns(list).concat([{ name: "other", displayName: list === "FORNECEDORES" ? "MEDIÇÃOATUAL" : "ETAPA" }]);
  } }) }).loadSnapshot(), /ambígu/i);
  await assert.rejects(create({ repository: fixture({ async resolveList() { return { status: "missing" }; } }) }).loadSnapshot(), /lista/i);
});

test("money parsing distinguishes explicit blanks, malformed values, zero and localized exact decimals", async () => {
  const inputs = ["", null, { Value: "" }, "junk 20", "1,2,3", Infinity, "1.234", "R$ 0,00", "1.234,56", "1234.56", { Value: "0,3" }];
  const repository = fixture({ async getItemsPage(_site, list) {
    return { items: list === "FORNECEDORES" ? inputs.map((value, i) => item(list, i + 1,
      { CADASTRO: `Supplier ${i}`, "VLR DIARIO": value })) : [], hasMore: false };
  } });
  const data = await create({ repository }).loadSnapshot();
  assert.deepEqual(data.suppliers.map(row => row.dailyValue), [null, null, null, null, null, null, null, 0, 1234.56, 1234.56, 0.3]);
  assert.deepEqual(data.suppliers.map(row => row.dailyValueBlank), [true, true, true, false, false, false, false, false, false, false, false]);
  assert.ok(data.warnings.some(message => /valor|diári/i.test(message)));
});

test("typed numeric money retains small fractions and numeric choice values without text ambiguity", async () => {
  const repository = fixture({ async getItemsPage(_site, list) {
    return { items: list === "FORNECEDORES" ? [0.0000001, { Value: 123.456 }].map((value, i) =>
      item(list, i + 1, { CADASTRO: `Supplier ${i}`, "VLR DIARIO": value })) : [], hasMore: false };
  } });
  const data = await create({ repository }).loadSnapshot();
  assert.deepEqual(data.suppliers.map(row => row.dailyValue), [0.0000001, 123.456]);
  assert.ok(data.suppliers.every(row => row.dailyValueBlank === false));
});

test("choices and numeric description values remain scalar text including blank measurement", async () => {
  const repository = fixture({ async getItemsPage(_site, list) {
    return { items: [item(list, 1, list === "FORNECEDORES" ? { EMPREITEIRO: { Value: "SIM" },
      "FORMA PGTO": { Value: "MEDIÇÃO" }, "VLR DIARIO": { Value: "" }, MEDIÇÃOATUAL: "",
      "DESCRITIVOETAPA ATUAL": 122, "ATIVIDADE EXERCIDA": { Value: "Pintura" } } : {})], hasMore: false };
  } });
  const data = await create({ repository }).loadSnapshot();
  assert.equal(data.suppliers[0].stage, "122"); assert.equal(data.suppliers[0].paymentMethod, "MEDIÇÃO");
  assert.equal(data.suppliers[0].measurement, ""); assert.equal(data.suppliers[0].dailyValueBlank, true);
});

// Break: stopping at 2000 rows or at the repository's 100-page window loses complete history.
test("all pages exceed 2000 records and cross repository pagination windows without capping", async () => {
  const counts = new Map();
  const repository = fixture({ async getItemsPage(_site, list, _query, options) {
    const page = (counts.get(list) || 0) + 1; counts.set(list, page);
    assert.equal(options.pageNumber, (page - 1) % 100 + 1);
    assert.equal(options.cursor || "", page === 1 ? "" : `${list}-${page}`);
    return { items: Array.from({ length: 21 }, (_, i) => item(list, (page - 1) * 21 + i + 1,
      list === "FORNECEDORES" ? { CADASTRO: `Supplier ${(page - 1) * 21 + i + 1}` } : {})),
      hasMore: page < 101, nextLink: page < 101 ? `${list}-${page + 1}` : "" };
  } });
  const data = await create({ repository }).loadSnapshot();
  assert.equal(data.suppliers.length, 2121); assert.equal(data.presences.length, 2121);
});

test("partial pages, malformed shapes, duplicate IDs and repeated cursors reject the entire source", async () => {
  for (const changes of [{ items: null }, { hasMore: undefined }, { hasMore: true, nextLink: "" },
    { hasMore: false, nextLink: "next" }, { batchCount: 2 }, { error: "failure" }, { partial: true },
    { aborted: true }, { truncated: true }, { complete: false }, { nextLink: 10 }, { items: [{ id: "0", fields: {} }] }]) {
    await assert.rejects(create({ repository: fixture({ async getItemsPage(_site, list) {
      return { items: [item(list)], hasMore: false, ...changes };
    } }) }).loadSnapshot(), /página|inválid|incomplet|pagin/i);
  }
  for (const duplicate of [true, false]) {
    let page = 0;
    await assert.rejects(create({ repository: fixture({ async getItemsPage(_site, list) {
      if (list !== "DESCRITIVOPRESENCA") return { items: [item(list)], hasMore: false };
      return { items: [item(list, duplicate ? 1 : ++page)], hasMore: true, nextLink: "repeat" };
    } }) }).loadSnapshot(), /duplicad|cursor/i);
  }
});

test("invalid dates and ambiguous scalar identities reject rather than guessing", async () => {
  for (const changes of [{ DATA: "2026-02-30" }, { DATA: "2026-10-07T25:00:00Z" },
    { DATA: "2026-10-07junk" }, { FORNECEDOR: ["Ana", "Bia"] }, { PRESENCA: ["PRESENTE", "AUSENTE"] }, { FORNECEDOR: "" }]) {
    await assert.rejects(create({ repository: fixture({ async getItemsPage(_site, list) {
      return { items: [item(list, 1, list === "DESCRITIVOPRESENCA" ? changes : {})], hasMore: false };
    } }) }).loadSnapshot(), /data|registro|inválid|amb/i);
  }
  await assert.rejects(create({ repository: fixture({ async getItemsPage(_site, list) {
    return { items: list === "FORNECEDORES" ? [item(list), item(list, 2, { CADASTRO: "ana", FILIAL: "B" })]
      : [item(list)], hasMore: false };
  } }) }).loadSnapshot(), /ambígu|identidade/i);
});

test("all scalar presence statuses including blank remain in the complete frequency base", async () => {
  const repository = fixture({ async getItemsPage(_site, list) {
    return { items: list === "DESCRITIVOPRESENCA" ? ["PRESENTE", "JUSTIFICADO", ""].map((PRESENCA, i) =>
      item(list, i + 1, { PRESENCA })) : [item(list)], hasMore: false };
  } });
  const data = await create({ repository }).loadSnapshot();
  assert.deepEqual(data.presences.map(row => row.presence), ["PRESENTE", "JUSTIFICADO", ""]);
});

test("optional legacy IDPGTO is preserved as scalar and unrelated malformed payment fields are ignored", async () => {
  const repository = fixture({ async getColumns(_site, list) {
    return columns(list).concat(list === "DESCRITIVOPRESENCA" ? [{ name: "legacy", displayName: "IDPGTO" }] : []);
  }, async getItemsPage(_site, list) {
    const row = item(list); row.fields.legacy = "3362, 3361";
    row.fields.STATUS = ["garbage"]; row.fields.VLORDIARIO = { invalid: "value" }; row.fields.HORÁRIO = "bad";
    return { items: [row], hasMore: false };
  } });
  const data = await create({ repository }).loadSnapshot();
  assert.equal(data.presences[0].paymentId, "3362, 3361"); assert.equal(data.complete, true);
});

test("abort interrupts ignored transport and prevents requesting another page", async () => {
  const controller = new AbortController(); let reached;
  const ready = new Promise(resolve => { reached = resolve; });
  const promise = create({ repository: fixture({ async getItemsPage() { reached(); return new Promise(() => {}); } }) })
    .loadSnapshot({ signal: controller.signal });
  await ready; controller.abort(); await assert.rejects(promise, error => error.name === "AbortError");
  let calls = 0;
  const next = new AbortController();
  await assert.rejects(create({ repository: fixture({ async getItemsPage(_site, list) {
    calls++; next.abort(); return { items: [item(list)], hasMore: true, nextLink: "next" };
  } }) }).loadSnapshot({ signal: next.signal }), error => error.name === "AbortError");
  assert.ok(calls <= 2);
});

test("source failures abort outstanding sibling loads and a pre-aborted request never accesses storage", async () => {
  let siblingSignal;
  await assert.rejects(create({ repository: fixture({ async getItemsPage(_site, list, _query, { signal }) {
    siblingSignal = signal;
    if (list === "FORNECEDORES") throw new Error("denied");
    return new Promise(() => {});
  } }) }).loadSnapshot(), /denied/);
  assert.equal(siblingSignal.aborted, true);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(create({ repository: fixture({ async resolveList() { assert.fail("must not access storage"); } }) })
    .loadSnapshot({ signal: controller.signal }), error => error.name === "AbortError");
});

test("read-only Graph authentication requests only Sites.Read.All and propagates errors", async () => {
  const scopes = [];
  await assert.rejects(create({ tokenProvider: async requested => { scopes.push(...requested); throw new Error("auth denied"); } })
    .loadSnapshot(), /auth denied/);
  assert.ok(scopes.length > 0); assert.ok(scopes.every(scope => scope === "Sites.Read.All"));
  const repository = createSharePointRepository({ async request() { throw new Error("403 read denied"); } },
    { personal: { host: "example.sharepoint.com", path: "/sites/readonly" } });
  await assert.rejects(create({ repository }).loadSnapshot(), /403 read denied/);
  assert.throws(() => create({}), /sessão|Microsoft/i);
});

test("actual Graph repository reads both lists using GET and feeds complete workforce grouping", async () => {
  const graph = { async request(path, options) {
    assert.equal(options.method || "GET", "GET");
    const list = Object.keys(values).find(name => path.includes(`/${name}/`));
    if (path.includes("/columns")) return { value: columns(list) };
    if (path.includes("/items")) return { value: [item(list)] };
    if (path.includes("/lists?")) return { value: Object.keys(values).map(id => ({ id, displayName: id, list: { template: "genericList" } })) };
    return { id: "site" };
  } };
  const repository = createSharePointRepository(graph, { personal: { host: "example.sharepoint.com", path: "/sites/readonly" } });
  const data = await create({ repository }).loadSnapshot();
  const { buildSupplierWorkforceReport } = await import("../src/chat/supplier-workforce-report-model.js");
  const report = buildSupplierWorkforceReport(data, { property: "Obra", stage: "122" }, "2026-10-07");
  assert.equal(report.branches[0].properties[0].property, "Casa");
  assert.deepEqual(report.branches[0].properties[0].professions[0].suppliers[0].frequencyHistory,
    { present: 1, total: 1, percent: 100 });
});
