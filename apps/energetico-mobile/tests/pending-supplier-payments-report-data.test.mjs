import test from "node:test";
import assert from "node:assert/strict";
import { createSharePointRepository } from "../../../portal/data/sharepoint-repository.js";

const module = await import("../src/chat/pending-supplier-payments-report-data.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const create = options => {
  assert.equal(typeof module.createPendingSupplierPaymentsReportData, "function", "report source must be implemented");
  return module.createPendingSupplierPaymentsReportData(options);
};
const values = {
  FORNECEDORES: { CADASTRO: "Ana", FILIAL: "A", STATUS: "ATIVO", EMPREITEIRO: "SIM", "VLR DIARIO": "100,00",
    "FORMA PGTO": "DIÁRIA", HORASTRABALHO: 8, IMOVEL: "Casa", PROFISSAO: "PEDREIRO", "ETAPA ATUAL": "Etapa",
    "ATIVIDADE EXERCIDA": "Obra", MEDICAOATUAL: "M1" },
  DESCRITIVOPRESENCA: { DATA: "2026-10-03T00:00:00-03:00", FILIAL: "A", FORNECEDOR: { LookupValue: "Ana" },
    PROFISSAO: "PEDREIRO", PRESENCA: "PRESENTE", STATUS: "PENDENTE PGTO", VLORDIARIO: "100,00", IDPGTO: "9",
    IMOVEL: "Casa", ETAPA: "Etapa", ATIVIDADEEXECUTADA: "Obra", MOTIVACAO: "Motivo", OBS: "Nota",
    HORÁRIO: "08:00", HORARIOSAIDA1: "12:00", HORARIOENTRADA2: "13:00", HORARIOSAIDA2: "17:00" },
  LANCAMENTOS: { DATA: "2026-10-03", FORNECEDOR: "Ana", FILIAL: "A", "VALOR UNITÁRIO": "0,1", QUANTIDADE: "0,2", ADIANTAMENTO: "SIM" },
};
const columns = list => Object.keys(values[list]).map((displayName, i) => ({ name: `f_${i}`, displayName }));
const item = (list, id = 1, changes = {}) => ({ id: String(id), fields: Object.fromEntries(columns(list).map(column => [column.name,
  Object.hasOwn(changes, column.displayName) ? changes[column.displayName] : values[list][column.displayName]])) });
function fixture(overrides = {}) {
  return { async resolveList(site, aliases, { signal }) {
    assert.equal(site, "personal"); assert.ok(signal); return { status: "resolved", id: aliases[0] };
  }, async getColumns(_site, list) { return columns(list); },
  async getItemsPage(_site, list, query, options) {
    assert.equal(new URLSearchParams(query).get("$expand"), "fields");
    assert.equal(new URLSearchParams(query).get("$top"), "100");
    assert.ok(options.pageNumber <= options.maxPages && options.maxPages <= 100);
    return { items: [item(list)], hasMore: false, nextLink: "", batchCount: 1 };
  }, ...overrides };
}

// Break: dropping one financial list/field creates a seemingly complete but incorrect report.
test("complete immutable three-list source preserves normalized financial and descriptive fields", async () => {
  const data = await create({ repository: fixture() }).loadSnapshot();
  assert.equal(data.complete, true);
  assert.ok(Object.isFrozen(data));
  assert.ok(Object.isFrozen(data.launches));
  assert.equal(data.suppliers[0].contractor, true);
  assert.equal(data.suppliers[0].dailyValue, 100);
  assert.equal(data.suppliers[0].measurement, "M1");
  assert.equal(data.presences[0].supplier, "Ana");
  assert.equal(data.presences[0].entry1, "08:00");
  assert.equal(data.presences[0].observation, "Nota");
  assert.equal(data.launches[0].unitValue, 0.1);
  assert.equal(data.launches[0].quantity, 0.2);
  assert.equal(data.launches[0].total, 0.02);
  assert.deepEqual(data.warnings, []);
});

test("renamed Title and encoded aliases resolve without computed LinkTitle collisions", async () => {
  const repository = fixture({ async getColumns(_site, list) {
    return columns(list).map(column => column.displayName === "CADASTRO" ? { ...column, name: "Title" }
      : column.displayName === "VALOR UNITÁRIO" ? { ...column, name: "VALOR_x0020_UNIT_x00c1_RIO" } : column)
      .concat(list === "FORNECEDORES" ? [{ name: "LinkTitle", displayName: "CADASTRO" },
        { name: "LinkTitleNoMenu", displayName: "CADASTRO" }, { name: "calculated", displayName: "VLR DIARIO", computed: {} }] : []);
  }, async getItemsPage(_site, list) {
    const row = item(list);
    if (list === "FORNECEDORES") { row.fields.Title = "Ana"; delete row.fields.f_0; }
    if (list === "LANCAMENTOS") { row.fields.VALOR_x0020_UNIT_x00c1_RIO = "0,1"; delete row.fields.f_3; }
    return { items: [row], hasMore: false };
  } });
  const data = await create({ repository }).loadSnapshot();
  assert.equal(data.suppliers[0].name, "Ana");
  assert.equal(data.launches[0].total, 0.02);
});

test("optional notes and time columns can be missing with explicit warnings", async () => {
  const repository = fixture({ async getColumns(_site, list) {
    return columns(list).filter(column => !["MOTIVACAO", "OBS", "HORÁRIO", "HORARIOSAIDA1", "HORARIOENTRADA2", "HORARIOSAIDA2"].includes(column.displayName));
  } });
  const data = await create({ repository }).loadSnapshot();
  assert.equal(data.complete, true);
  assert.equal(data.presences[0].entry1, "");
  assert.equal(data.presences[0].observation, "");
  assert.ok(data.warnings.some(message => /hor/i.test(message)));
  assert.ok(data.warnings.some(message => /OBS/.test(message)));
});

test("missing mandatory columns, ambiguous optional columns and unavailable lists reject even when empty", async () => {
  for (const overrides of [
    { async resolveList() { return { status: "missing" }; } },
    { async getColumns(_site, list) { return columns(list).slice(1); } },
    { async getColumns(_site, list) { return [...columns(list), { name: "other", displayName: list === "DESCRITIVOPRESENCA" ? "OBS" : Object.keys(values[list])[0] }]; } },
  ]) await assert.rejects(create({ repository: fixture(overrides) }).loadSnapshot(), /lista|coluna|esquema|amb/i);
});

test("invalid and blank money stay unknown while zero and locale amounts remain exact", async () => {
  const amounts = ["junk 20", "1,2,3", "", null, Infinity, "R$ 0,00", "1.234,56", "1234.56", { Value: "0,3" }];
  const repository = fixture({ async getItemsPage(_site, list) {
    return { items: list === "DESCRITIVOPRESENCA" ? amounts.map((VLORDIARIO, i) => item(list, i + 1, { VLORDIARIO }))
      : [item(list, 1, list === "LANCAMENTOS" ? { QUANTIDADE: null } : {})], hasMore: false };
  } });
  const data = await create({ repository }).loadSnapshot();
  assert.deepEqual(data.presences.map(row => row.dailyValue), [null, null, null, null, null, 0, 1234.56, 1234.56, 0.3]);
  assert.equal(data.launches[0].total, null);
});

// Break: capping at FirstN 2000 or maxPages 100 silently drops financial history.
test("all three lists traverse more than 2000 items across repository pagination windows", async () => {
  const counts = new Map();
  const repository = fixture({ async getItemsPage(_site, list, _query, options) {
    const page = (counts.get(list) || 0) + 1; counts.set(list, page);
    assert.equal(options.pageNumber, (page - 1) % 100 + 1);
    assert.equal(options.cursor || "", page === 1 ? "" : `${list}-${page}`);
    return { items: Array.from({ length: 21 }, (_, i) => item(list, (page - 1) * 21 + i + 1)),
      hasMore: page < 101, nextLink: page < 101 ? `${list}-${page + 1}` : "" };
  } });
  const data = await create({ repository }).loadSnapshot();
  assert.equal(data.suppliers.length, 2121);
  assert.equal(data.presences.length, 2121);
  assert.equal(data.launches.length, 2121);
});

test("page shape errors, partial markers, duplicate ids and cursor cycles reject the entire source", async () => {
  for (const changes of [{ items: null }, { hasMore: undefined }, { hasMore: true, nextLink: "" },
    { hasMore: false, nextLink: "next" }, { batchCount: 2 }, { partial: true }, { error: "failure" },
    { aborted: true }, { truncated: true }, { nextLink: 10 }, { items: [{ id: "0", fields: {} }] }]) {
    const repository = fixture({ async getItemsPage(_site, list) { return { items: [item(list)], hasMore: false, ...changes }; } });
    await assert.rejects(create({ repository }).loadSnapshot(), /página|inválid|incomplet|pagin/i);
  }
  for (const duplicate of [true, false]) {
    let page = 0;
    const repository = fixture({ async getItemsPage(_site, list) {
      if (list !== "LANCAMENTOS") return { items: [item(list)], hasMore: false };
      return { items: [item(list, duplicate ? 1 : ++page)], hasMore: true, nextLink: "repeat" };
    } });
    await assert.rejects(create({ repository }).loadSnapshot(), /duplicad|cursor/i);
  }
});

test("malformed dates, core choices, lookup arrays and ambiguous payment references reject rows", async () => {
  for (const changes of [{ DATA: "2026-02-30" }, { PRESENCA: "??" }, { FORNECEDOR: ["Ana", "Bia"] },
    { IDPGTO: "1,2" }, { STATUS: "" }]) {
    const repository = fixture({ async getItemsPage(_site, list) {
      return { items: [item(list, 1, list === "DESCRITIVOPRESENCA" ? changes : {})], hasMore: false };
    } });
    await assert.rejects(create({ repository }).loadSnapshot(), /registro|inválid|amb/i);
  }
});

test("abort stops waiting on ignored transport and failed sibling list cancels outstanding loads", async () => {
  const controller = new AbortController(); let reached;
  const ready = new Promise(resolve => { reached = resolve; });
  const repository = fixture({ async getItemsPage() { reached(); return new Promise(() => {}); } });
  const promise = create({ repository }).loadSnapshot({ signal: controller.signal });
  await ready; controller.abort();
  await assert.rejects(promise, error => error.name === "AbortError");
  let siblingSignal;
  const failed = fixture({ async getItemsPage(_site, list, _query, { signal }) {
    siblingSignal = signal;
    if (list === "LANCAMENTOS") throw new Error("forbidden");
    return new Promise(() => {});
  } });
  await assert.rejects(create({ repository: failed }).loadSnapshot(), /forbidden/);
  assert.equal(siblingSignal.aborted, true);
});

test("read-only Graph integration requests Sites.Read.All and propagates auth failure", async () => {
  const scopes = [];
  await assert.rejects(create({ tokenProvider: async requested => { scopes.push(...requested); throw new Error("auth denied"); } }).loadSnapshot(), /auth denied/);
  assert.ok(scopes.length > 0);
  assert.ok(scopes.every(scope => scope === "Sites.Read.All"));
  const repository = createSharePointRepository({ async request() { throw new Error("403 read denied"); } },
    { personal: { host: "example.sharepoint.com", path: "/sites/readonly" } });
  await assert.rejects(create({ repository }).loadSnapshot(), /403 read denied/);
});

test("real Graph repository traverses all three lists with read-only requests", async () => {
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
  assert.equal(data.complete, true);
  assert.equal(data.launches[0].total, 0.02);
});

test("runaway cursor traversal fails at the finite safety cap without publishing partial rows", async () => {
  let pages = 0;
  const repository = fixture({ async getItemsPage(_site, list) {
    if (list !== "LANCAMENTOS") return { items: [item(list)], hasMore: false };
    return { items: [item(list, ++pages)], hasMore: true, nextLink: `next-${pages}` };
  } });
  await assert.rejects(create({ repository }).loadSnapshot(), /limite seguro/i);
  assert.ok(pages > 100 && pages <= 10_000);
});

test("cancelled sessions start no calls and ignored token retrieval can be cancelled", async () => {
  const before = new AbortController(); before.abort(); let called = false;
  await assert.rejects(create({ repository: fixture({ async resolveList() { called = true; } }) }).loadSnapshot({ signal: before.signal }), /abort|cancel/i);
  assert.equal(called, false);
  let reached; const ready = new Promise(resolve => { reached = resolve; });
  const ongoing = new AbortController(); let tokenSignal;
  const promise = create({ tokenProvider(_scopes, { signal }) { tokenSignal = signal; reached(); return new Promise(() => {}); } }).loadSnapshot({ signal: ongoing.signal });
  await ready; ongoing.abort();
  await assert.rejects(promise, error => error.name === "AbortError");
  assert.equal(tokenSignal.aborted, true);
});

test("noncontractor blank branch status and contractor flag normalize without blocking the source", async () => {
  for (const EMPREITEIRO of ["NÃO", "", null]) {
    const repository = fixture({ async getItemsPage(_site, list) {
      return { items: list === "FORNECEDORES" ? [item(list), item(list, 2, { CADASTRO: "Loja", FILIAL: "", STATUS: "", EMPREITEIRO })]
        : [item(list)], hasMore: false };
    } });
    const data = await create({ repository }).loadSnapshot();
    assert.equal(data.complete, true);
    assert.equal(data.suppliers.length, 2);
    assert.equal(data.suppliers[1].contractor, false);
  }
  const invalid = fixture({ async getItemsPage(_site, list) {
    return { items: [item(list, 1, list === "FORNECEDORES" ? { FILIAL: "" } : {})], hasMore: false };
  } });
  await assert.rejects(create({ repository: invalid }).loadSnapshot(), /registro|inválid/i);
});

test("unnamed launches preserve ids and exact amounts instead of dropping financial evidence", async () => {
  const repository = fixture({ async getItemsPage(_site, list) {
    return { items: [item(list, 9, list === "LANCAMENTOS" ? { FORNECEDOR: "", FILIAL: "" } : {})], hasMore: false };
  } });
  const data = await create({ repository }).loadSnapshot();
  assert.equal(data.complete, true);
  assert.equal(data.launches[0].id, "9");
  assert.equal(data.launches[0].supplier, "");
  assert.equal(data.launches[0].total, 0.02);
  assert.ok(data.warnings.some(message => /9/.test(message) && /fornecedor/i.test(message)));
});

// Review regression: exactly three decimal digits must not become 1000x larger.
test("fractional dot decimals stay exact and ambiguous grouping stays unknown", async () => {
  const amounts = ["0.125", "-0.125", "1.234", "R$ 1.234", "1.234,56", "1,234.56", "8.125"];
  const repository = fixture({ async getItemsPage(_site, list) {
    return {items:list === "DESCRITIVOPRESENCA" ? amounts.map((VLORDIARIO,index)=>item(list,index+1,{VLORDIARIO}))
      : [item(list,1,list === "FORNECEDORES" ? {HORASTRABALHO:"8.125"} : {"VALOR UNITÁRIO":100,QUANTIDADE:"0.125"})],hasMore:false};
  }});
  const data=await create({repository}).loadSnapshot();
  assert.deepEqual(data.presences.map(row=>row.dailyValue),[0.125,-0.125,null,1234,1234.56,1234.56,null]);
  assert.equal(data.launches[0].quantity,0.125);
  assert.equal(data.launches[0].total,12.5);
  assert.equal(data.suppliers[0].hours,null);
  assert.equal(data.suppliers[0].hoursInvalid,true);
});

// Review regression: source timestamp must be valid before shared date normalization.
test("financial dates reject malformed suffixes and invalid timestamp components", async () => {
  for(const list of ["DESCRITIVOPRESENCA","LANCAMENTOS"]) for(const DATA of [
    "2026-10-03garbage","2026-10-03T99:99:99Z","2026-02-30T00:00:00Z","2026-10-03T24:00:00Z","2026-10-03T12:00:00+99:00",
  ]) {
    const repository=fixture({async getItemsPage(_site,current){return {items:[item(current,1,current===list?{DATA}:{})],hasMore:false};}});
    await assert.rejects(create({repository}).loadSnapshot(),/data|registro|inválid/i,`${list}: ${DATA}`);
  }
  for(const DATA of ["2026-10-03","2026-10-03T00:00:00-03:00","2026-10-03T23:59:59.123Z"]) {
    const repository=fixture({async getItemsPage(_site,list){return {items:[item(list,1,list!=="FORNECEDORES"?{DATA}:{})],hasMore:false};}});
    assert.equal((await create({repository}).loadSnapshot()).presences[0].date,"2026-10-03");
  }
});
