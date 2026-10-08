import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createContractorControlReportView } from "../src/ui/contractor-control-report-view.js";
import { captureFilteredReport } from "../src/ui/report-print.js";

const module = await import("../src/chat/contractor-report-data.js").catch(() => ({}));

function repository(overrides = {}) {
  const calls = [];
  const repo = {
    async resolveList(site, aliases) {
      assert.equal(site, "personal");
      const name = aliases[0];
      calls.push(["resolve", name]);
      return { status: "resolved", id: name };
    },
    async getColumns(_site, list) {
      if (list === "EMPREITEIRO") return [
        { name: "field_1", displayName: "STATUS" }, { name: "field_2", displayName: "IDCONTRATO" },
        { name: "field_3", displayName: "IDESTIMATIVA" }, { name: "field_4", displayName: "DATA INÍCIO" },
      ];
      if (list === "DOCUMENTOS_1") return [{ name: "field_7", displayName: "STATUS" }];
      if (list === "LANCAMENTOS") return [
        { name: "field_1", displayName: "CONTRATO", text: {} }, { name: "field_2", displayName: "VALOR UNITÁRIO" },
        { name: "field_3", displayName: "QUANTIDADE" }, { name: "field_4", displayName: "FRETE" },
      ];
      if (list === "DESCRICAOMEDICOES") return [
        { name: "field_5", displayName: "NUMEROCONTRATO", number: {} }, { name: "field_6", displayName: "STATUS" },
      ];
      return [];
    },
    async getItemsPage(_site, list, query, options) {
      calls.push(["page", list, query, options.pageNumber]);
      if (list === "EMPREITEIRO") {
        if (options.pageNumber === 1) return { items: [{ id: "237", fields: { field_1: "ATIVO", field_2: "214", field_3: "215", field_4: "2026-08-10" } }], hasMore: true, nextLink: "next" };
        return { items: [{ id: "238", fields: { field_1: "INATIVO", field_2: "214" } }], hasMore: false, nextLink: "" };
      }
      if (list === "LANCAMENTOS") return { items: [{ id: "3486", fields: { field_1: "237", field_2: 5, field_3: 11, field_4: 0 } }], hasMore: false, nextLink: "" };
      if (list === "DESCRICAOMEDICOES") return { items: [{ id: "50", fields: { field_5: 237, field_6: "ATIVO" } }], hasMore: false, nextLink: "" };
      throw new Error(`unexpected list ${list}`);
    },
    async getItem(_site, list, id) {
      assert.equal(list, "DOCUMENTOS_1");
      calls.push(["document", id]);
      return { id, fields: { field_7: id === "214" ? "PENDENTE" : "SUBMETIDO" } };
    },
    ...overrides,
  };
  return { repo, calls };
}

test("percorre todas as páginas da lista EMPREITEIRO e consulta o status de cada documento único", async () => {
  assert.equal(typeof module.createContractorReportData, "function");
  const { repo, calls } = repository();
  const snapshot = await module.createContractorReportData({ repository: repo }).loadOverview();
  assert.deepEqual(snapshot.rows.map(row => row.id), ["237", "238"]);
  assert.equal(snapshot.documentStatuses["214"], "PENDENTE");
  assert.equal(snapshot.documentStatuses["215"], "SUBMETIDO");
  assert.equal(calls.filter(call => call[0] === "document").length, 2);
  assert.ok(calls.some(call => call[0] === "page" && call[1] === "EMPREITEIRO" && call[3] === 2));
});

test("não publica totais de uma consulta truncada", async () => {
  const { repo } = repository({
    async getItemsPage() { return { items: [], hasMore: true, nextLink: "next" }; },
  });
  await assert.rejects(module.createContractorReportData({ repository: repo }).loadOverview(), /limite seguro|paginação/i);
});

test("filtra lançamentos e medições pelo ID da linha, usando nomes internos e tipo da coluna", async () => {
  const { repo, calls } = repository();
  const details = await module.createContractorReportData({ repository: repo }).loadDetails("237");
  assert.equal(details.launches[0].total, 55);
  assert.equal(details.measurements[0].contract, "237");
  const launchQuery = calls.find(call => call[0] === "page" && call[1] === "LANCAMENTOS")[2];
  const measureQuery = calls.find(call => call[0] === "page" && call[1] === "DESCRICAOMEDICOES")[2];
  assert.equal(new URLSearchParams(launchQuery).get("$filter"), "fields/field_1 eq '237'");
  assert.equal(new URLSearchParams(measureQuery).get("$filter"), "fields/field_5 eq 237");
});

test("se SharePoint rejeitar filtro remoto, varre a lista inteira e filtra localmente sem trazer outro contrato", async () => {
  const { repo } = repository({
    async getItemsPage(_site, list, query) {
      if (new URLSearchParams(query).has("$filter")) { const error = new Error("Bad Request"); error.status = 400; throw error; }
      if (list === "LANCAMENTOS") return { items: [
        { id: "1", fields: { field_1: "237" } }, { id: "2", fields: { field_1: "238" } },
      ], hasMore: false, nextLink: "" };
      return { items: [{ id: "3", fields: { field_5: 237 } }, { id: "4", fields: { field_5: 238 } }], hasMore: false, nextLink: "" };
    },
  });
  const details = await module.createContractorReportData({ repository: repo }).loadDetails("237");
  assert.deepEqual(details.launches.map(row => row.id), ["1"]);
  assert.deepEqual(details.measurements.map(row => row.id), ["3"]);
});

test("rejeita ID inválido antes de consultar SharePoint", async () => {
  const { repo, calls } = repository();
  await assert.rejects(module.createContractorReportData({ repository: repo }).loadDetails("237' or 1=1"), /ID/i);
  assert.equal(calls.length, 0);
});

test("ignora auxiliares LinkTitle no status e no contrato sem aceitar duplicatas reais de esquema", async () => {
  const { repo } = repository();
  const original = repo.getColumns;
  repo.getColumns = async (site, list) => {
    const columns = await original(site, list);
    const displayName = list === "DOCUMENTOS_1" ? "STATUS" : list === "LANCAMENTOS" ? "CONTRATO" : "ignorado";
    return [{ name: "LinkTitle", displayName }, { name: "LinkTitleNoMenu", displayName }, { name: "LinkTitle2", displayName }, ...columns];
  };
  const data = module.createContractorReportData({ repository: repo });
  assert.equal((await data.loadOverview()).documentStatuses["214"], "PENDENTE");
  assert.deepEqual((await data.loadDetails("237")).launches.map(row => row.id), ["3486"]);
  repo.getColumns = async (site, list) => [...await original(site, list), { name: "duplicate", displayName: list === "LANCAMENTOS" ? "CONTRATO" : "STATUS" }];
  await assert.rejects(data.loadDetails("237"), /coluna|seguran/i);
});

test("não aceita esquema de overview ambíguo ainda que ambas as colunas tenham valores", async () => {
  const { repo } = repository();
  const original = repo.getColumns;
  repo.getColumns = async (site, list) => [...await original(site, list), ...(list === "EMPREITEIRO" ? [{ name: "other", displayName: "STATUS" }] : [])];
  await assert.rejects(module.createContractorReportData({ repository: repo }).loadOverview(), /coluna|amb.gu/i);
});

test("paginação atravessa a janela de 100 páginas sem truncar totais", async () => {
  let pages = 0;
  const { repo } = repository({
    async getItemsPage(_site, _list, _query, options) {
      pages++;
      assert.equal(options.pageNumber, (pages - 1) % 100 + 1);
      assert.equal(options.maxPages, 100);
      assert.equal(options.cursor, pages === 1 ? undefined : `page-${pages}`);
      return { items: [{ id: String(pages), fields: {} }], hasMore: pages < 102, nextLink: pages < 102 ? `page-${pages + 1}` : "" };
    },
  });
  const snapshot = await module.createContractorReportData({ repository: repo }).loadOverview();
  assert.equal(snapshot.rows.length, 102);
  assert.equal(snapshot.rows.at(-1).id, "102");
});

test("deduplica itens repetidos entre páginas e rejeita versões conflitantes do mesmo ID", async () => {
  let conflicting = false;
  const { repo } = repository({
    async getItemsPage(_site, _list, _query, options) {
      return { items: [{ id: "237", fields: { field_1: conflicting && options.pageNumber === 2 ? "INATIVO" : "ATIVO" } }], hasMore: options.pageNumber === 1, nextLink: options.pageNumber === 1 ? "next" : "" };
    },
  });
  const data = module.createContractorReportData({ repository: repo });
  assert.equal((await data.loadOverview()).rows.length, 1);
  conflicting = true;
  await assert.rejects(data.loadOverview(), /conflit|duplic|repet/i);
});

test("não publica páginas incompletas, inconsistentes ou registros inválidos", async () => {
  for (const page of [
    { items: [], hasMore: false, truncated: true },
    { items: [], hasMore: false, partial: true },
    { items: [], hasMore: false, aborted: true },
    { items: [], hasMore: false, error: "falha" },
    { items: [], hasMore: "false" },
    { items: [], hasMore: false, nextLink: "next" },
    { items: [], hasMore: true, nextLink: "" },
    { items: [], hasMore: false, batchCount: 1 },
    { items: Array.from({ length: 101 }, (_, i) => ({ id: String(i + 1), fields: {} })), hasMore: false },
    { items: [{ id: "bad", fields: {} }], hasMore: false },
    { items: [{ id: "1" }], hasMore: false },
  ]) {
    const { repo } = repository({ async getItemsPage() { return page; } });
    await assert.rejects(module.createContractorReportData({ repository: repo }).loadOverview(), /p.gina|item|registro|complet/i);
  }
});

test("interrompe ciclo de cursores antes de consultar novamente uma página já percorrida", async () => {
  let pages = 0;
  const { repo } = repository({ async getItemsPage() { pages++; return { items: [], hasMore: true, nextLink: "same" }; } });
  await assert.rejects(module.createContractorReportData({ repository: repo }).loadOverview(), /paginação|cursor/i);
  assert.equal(pages, 2);
});

test("fallback completo usa comparação numérica só para coluna numérica e ID selecionado, nunca ID de documento", async () => {
  const { repo, calls } = repository({
    async getItemsPage(_site, list, query, options) {
      calls.push(["typed-page", list, new URLSearchParams(query).get("$filter"), options.cursor]);
      if (new URLSearchParams(query).has("$filter")) throw Object.assign(new Error("Bad Request"), { statusCode: 400 });
      const name = list === "LANCAMENTOS" ? "field_1" : "field_5";
      const values = options.pageNumber === 1 ? ["237", "0237", "237.0", "214"] : [237, "237.5", "bad", "238"];
      return { items: values.map((value, i) => ({ id: String(options.pageNumber * 10 + i), fields: { [name]: value } })), hasMore: options.pageNumber === 1, nextLink: options.pageNumber === 1 ? "next" : "" };
    },
  });
  const details = await module.createContractorReportData({ repository: repo }).loadDetails("237");
  assert.deepEqual(details.launches.map(row => row.id), ["20", "10"]);
  assert.deepEqual(details.measurements.map(row => row.id), ["20", "12", "11", "10"]);
  assert.equal(calls.find(call => call[0] === "typed-page" && call[1] === "LANCAMENTOS")[2], "fields/field_1 eq '237'");
  assert.equal(calls.find(call => call[0] === "typed-page" && call[1] === "DESCRICAOMEDICOES")[2], "fields/field_5 eq 237");
});

test("erro remoto diferente de 400 não aciona fallback irrestrito", async () => {
  const failure = Object.assign(new Error("Forbidden"), { status: 403 });
  const { repo } = repository({ async getItemsPage(_site, _list, query) { assert.ok(new URLSearchParams(query).has("$filter")); throw failure; } });
  await assert.rejects(module.createContractorReportData({ repository: repo }).loadDetails("237"), error => error === failure);
});

test("cancelamento rejeita prontamente mesmo se o repositório ignora signal e não responde", async () => {
  for (const stage of ["resolveList", "getColumns", "getItemsPage", "getItem"]) {
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    const { repo } = repository({ async [stage]() { entered(); return blocked; } });
    const controller = new AbortController();
    const pending = module.createContractorReportData({ repository: repo }).loadOverview({ signal: controller.signal });
    await started;
    controller.abort();
    const result = await Promise.race([
      pending.then(() => "resolved", error => error.name),
      new Promise(resolve => { const timer = setTimeout(() => resolve("still pending"), 50); timer.unref(); }),
    ]);
    // Settle the repository double even on RED, keeping no pending test operations.
    release({ status: "resolved", id: "EMPREITEIRO", items: [], hasMore: false });
    await pending.catch(() => {});
    assert.equal(result, "AbortError", stage);
  }
});

test("AbortError não vira warning de documentos nem dispara fallback", async () => {
  const aborted = new DOMException("cancelado", "AbortError");
  const { repo } = repository({ async getItem() { throw aborted; } });
  await assert.rejects(module.createContractorReportData({ repository: repo }).loadOverview(), error => error === aborted);
});

test("cancelamento entre colunas e itens impede nova consulta", async () => {
  const controller = new AbortController();
  let pages = 0;
  const { repo } = repository({
    async getColumns() { controller.abort(); return []; },
    async getItemsPage() { pages++; return { items: [], hasMore: false }; },
  });
  await assert.rejects(module.createContractorReportData({ repository: repo }).loadDetails("237", { signal: controller.signal }), { name: "AbortError" });
  assert.equal(pages, 0);
});

test("tipo do vínculo desconhecido ou contraditório não gera filtro textual por suposição", async () => {
  for (const facets of [{}, { lookup: { columnName: "Title" } }, { text: {}, number: {} }]) {
    const { repo } = repository();
    const original = repo.getColumns;
    repo.getColumns = async (site, list) => list === "LANCAMENTOS"
      ? [{ name: "CONTRATO", displayName: "CONTRATO", ...facets }]
      : original(site, list);
    await assert.rejects(module.createContractorReportData({ repository: repo }).loadDetails("237"), /tipo|coluna|seguran/i);
  }
});

test("aborta detalhes pendentes e consome rejeições tardias sem fallback", async () => {
  const controller = new AbortController();
  let entered, rejectRequest;
  const started = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise((_resolve, reject) => { rejectRequest = reject; });
  const { repo } = repository({ async getItemsPage(_site, _list, _query, options) { assert.equal(options.signal, controller.signal); entered(); return blocked; } });
  const pending = module.createContractorReportData({ repository: repo }).loadDetails("237", { signal: controller.signal });
  await started;
  controller.abort();
  const result = await Promise.race([pending.then(() => "resolved", error => error.name), new Promise(resolve => setTimeout(() => resolve("still pending"), 50))]);
  rejectRequest(Object.assign(new Error("late bad request"), { status: 400 }));
  await pending.catch(() => {});
  assert.equal(result, "AbortError");
});

test("dados reais do adaptador preservam todos os vínculos numéricos equivalentes na tela e captura PDF, com texto estrito", async t => {
  for (const numericKind of ["measurements", "launches"]) {
    const { repo } = repository();
    const originalColumns = repo.getColumns;
    repo.getColumns = async (site, list) => {
      const columns = await originalColumns(site, list);
      if (list !== "LANCAMENTOS" && list !== "DESCRICAOMEDICOES") return columns;
      const numeric = numericKind === (list === "LANCAMENTOS" ? "launches" : "measurements");
      return columns.map((column, i) => i === 0 ? { name: column.name, displayName: column.displayName, ...(numeric ? { number: {} } : { text: {} }) } : column);
    };
    const originalPage = repo.getItemsPage;
    repo.getItemsPage = async (site, list, query, options) => {
      if (list !== "LANCAMENTOS" && list !== "DESCRICAOMEDICOES") return originalPage(site, list, query, options);
      const launch = list === "LANCAMENTOS";
      return { items: [237, "0237", "237.0", 214].map((contract, i) => ({
        id: String((launch ? 201 : 101) + i), fields: launch
          ? { field_1: contract, field_2: 10, field_3: 2, field_4: 3 }
          : { field_5: contract, field_6: "ATIVO" },
      })), hasMore: false, nextLink: "" };
    };
    const data = module.createContractorReportData({ repository: repo });
    const dom = new JSDOM('<main id="app"></main>');
    dom.window.matchMedia = () => ({ matches: false });
    const view = createContractorControlReportView({ document: dom.window.document, data });
    t.after(() => { view.destroy(); dom.window.close(); });
    await view.open();
    const root = view.element;
    const select = root.querySelector('[name="id"]');
    select.value = "237";
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await new Promise(resolve => setImmediate(resolve));
    const expectedLaunches = numericKind === "launches" ? ["203", "202", "201"] : ["201"];
    const expectedMeasurements = numericKind === "measurements" ? ["103", "102", "101"] : ["101"];
    const tableIds = name => [...root.querySelectorAll(`.ccr-${name} tbody tr`)].map(row => row.cells[0].textContent.trim());
    assert.deepEqual(tableIds("launches"), expectedLaunches);
    assert.deepEqual(tableIds("measurements"), expectedMeasurements);
    const details = await data.loadDetails("237");
    assert.ok(details[numericKind].every(row => row.contract === "237"));
    assert.equal(root.querySelector('[data-row-id="237"] [data-column="contractDocumentId"]').textContent, "214 (PENDENTE)");
    const restore = await view.preparePrint();
    try {
      const tables = captureFilteredReport(root).pages[0].blocks.filter(block => block.type === "table");
      assert.equal(tables.length, 3);
      const capturedIds = table => table.rows.filter(row => !row.header).map(row => row.cells[0].runs.map(run => run.text).join("").trim());
      assert.deepEqual(capturedIds(tables[1]), expectedLaunches);
      assert.deepEqual(capturedIds(tables[2]), expectedMeasurements);
    } finally { restore(); }
  }
});
