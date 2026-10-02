import test from "node:test";
import assert from "node:assert/strict";

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
