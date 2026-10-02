import test from "node:test";
import assert from "node:assert/strict";

const module = await import("../src/chat/presence-payment-report-data.js").catch(() => ({}));

function fixture(overrides = {}) {
  const calls = [];
  const repository = {
    async resolveList(site, aliases) {
      assert.equal(site, "personal");
      calls.push(["resolve", aliases[0]]);
      return { status: "resolved", id: aliases[0] };
    },
    async getColumns(_site, list) {
      if (list === "DESCRITIVOPRESENCA") return [
        { name: "field_1", displayName: "IDPGTO" }, { name: "field_2", displayName: "DATA" },
        { name: "field_3", displayName: "VLORDIARIO" }, { name: "field_4", displayName: "FORNECEDOR" },
      ];
      if (list === "FORNECEDORES") return [{ name: "field_1", displayName: "CADASTRO" }, { name: "field_2", displayName: "STATUS" }];
      if (list === "LANCAMENTOS") return [
        { name: "field_1", displayName: "AGRUPAR" }, { name: "field_2", displayName: "VALOR UNITÁRIO" },
        { name: "field_3", displayName: "QUANTIDADE" }, { name: "field_4", displayName: "FRETE" },
      ];
      throw new Error(`unexpected list ${list}`);
    },
    async getItemsPage(_site, list, query, options) {
      calls.push(["page", list, query, options.pageNumber]);
      if (list === "DESCRITIVOPRESENCA") {
        if (options.pageNumber === 1) return { items: [
          { id: "2080", fields: { field_1: 3470, field_2: "2026-09-21", field_3: 150, field_4: "RAFAEL" } },
          { id: "2090", fields: { field_1: 3470, field_2: "2026-09-22", field_3: 150, field_4: "RAFAEL" } },
        ], hasMore: true, nextLink: "next" };
        return { items: [
          { id: "2100", fields: { field_1: 3471, field_2: "2026-09-23", field_3: 200, field_4: "OUTRO" } },
          { id: "2101", fields: { field_1: "", field_2: "2026-09-24", field_3: 200, field_4: "OUTRO" } },
        ], hasMore: false, nextLink: "" };
      }
      if (list === "FORNECEDORES") return { items: [
        { id: "1", fields: { field_1: "RAFAEL", field_2: "ATIVO" } },
        { id: "2", fields: { field_1: "OUTRO", field_2: "INATIVO" } },
      ], hasMore: false, nextLink: "" };
      throw new Error(`unexpected page ${list}`);
    },
    async getItem(_site, list, id, query) {
      assert.equal(list, "LANCAMENTOS");
      assert.equal(query, "$expand=fields");
      calls.push(["launch", id]);
      return { id, fields: { field_1: "346", field_2: 150, field_3: 5, field_4: 0 } };
    },
    ...overrides,
  };
  return { repository, calls };
}

test("lê todas as páginas e consulta cada lançamento único uma vez", async () => {
  assert.equal(typeof module.createPresencePaymentReportData, "function");
  const { repository, calls } = fixture();
  const snapshot = await module.createPresencePaymentReportData({ repository }).loadSnapshot();
  assert.deepEqual(snapshot.presences.map(row => row.id), ["2080", "2090", "2100"]);
  assert.equal(snapshot.launchesById["3470"].total, 750);
  assert.equal(snapshot.supplierStatusByName.RAFAEL, "ATIVO");
  assert.equal(calls.filter(call => call[0] === "launch").length, 2);
  assert.ok(calls.some(call => call[0] === "page" && call[1] === "DESCRITIVOPRESENCA" && call[3] === 2));
  assert.ok(calls.some(call => call[0] === "page" && new URLSearchParams(call[2]).get("$expand") === "fields"));
});

test("lançamento 404 permanece ausente sem inventar valor, mas erro temporário interrompe a consulta", async () => {
  const missing = fixture({ async getItem() { const error = new Error("Not Found"); error.status = 404; throw error; } });
  const snapshot = await module.createPresencePaymentReportData({ repository: missing.repository }).loadSnapshot();
  assert.equal(snapshot.launchesById["3470"], undefined);
  assert.equal(snapshot.presences.length, 3);

  const failing = fixture({ async getItem() { const error = new Error("Throttle"); error.status = 429; throw error; } });
  await assert.rejects(module.createPresencePaymentReportData({ repository: failing.repository }).loadSnapshot(), /Throttle/);
});

test("página incompleta não retorna totais parciais", async () => {
  const { repository } = fixture({ async getItemsPage() { return { items: [], hasMore: true, nextLink: "" }; } });
  await assert.rejects(module.createPresencePaymentReportData({ repository }).loadSnapshot(), /paginação|próxima página/i);
});

test("cancelamento interrompe a consulta antes de acessar o SharePoint", async () => {
  const { repository, calls } = fixture();
  const abort = new AbortController(); abort.abort();
  await assert.rejects(module.createPresencePaymentReportData({ repository }).loadSnapshot({ signal: abort.signal }), /abort|cancelad/i);
  assert.equal(calls.length, 0);
});
