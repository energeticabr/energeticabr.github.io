import test from "node:test";
import assert from "node:assert/strict";
import { createAuditReportsData } from "../src/chat/audit-reports-live-data.js";

function repository() {
  const names = [];
  const repo = {
    async resolveList(site, aliases) { names.push(aliases[0]); return { status: "resolved", id: aliases[0] }; },
    async getColumns() { return []; },
    async getItemsPage(site, list) { return { items: [{ id: "1", fields: { STATUS: "ATIVO" } }], hasMore: false }; },
  };
  return { repo, names };
}

test("consulta as listas originais de cotações, imobilizados e documentos", async () => {
  const { repo, names } = repository();
  const data = createAuditReportsData({ repository: repo });
  const quotation = await data.loadReport(11);
  const depreciation = await data.loadReport(12);
  const documents = await data.loadReport(13);
  assert.deepEqual(names, ["NOVACOTACAO", "ORCAMENTOS", "IMOBILIZADOS", "DOCUMENTOS_1"]);
  assert.equal(quotation.quotes.length, 1);
  assert.equal(quotation.budgets.length, 1);
  assert.equal(depreciation.rows.length, 1);
  assert.equal(documents.rows.length, 1);
});

test("não apresenta totais parciais quando a paginação falha", async () => {
  const { repo } = repository();
  repo.getItemsPage = async () => ({ items: [{ id: "1", fields: {} }], hasMore: true });
  await assert.rejects(createAuditReportsData({ repository: repo }).loadReport(13), /próxima página/i);
});

test("normaliza as colunas internas, percorre todas as páginas e preserva valores ausentes", async () => {
  const seen = [];
  const columns = {
    NOVACOTACAO: ["FILIAL", "STATUS"], ORCAMENTOS: ["IDCOTACAO", "VALORTOTAL", "STATUS"],
    IMOBILIZADOS: ["NÚMEROIMOBILIZADO", "DATA DEPRECIAÇÃO", "VALOR ESTIMADO", "QTD", "VALOR RESIDUAL"],
    DOCUMENTOS_1: ["DATAVALIDADE", "STATUS", "DATA"],
  };
  const repo = {
    async resolveList(_site, aliases) { return { status: "resolved", id: aliases[0] }; },
    async getColumns(_site, list) { return columns[list].map((displayName, index) => ({ displayName, name: `field_${index}` })); },
    async getItemsPage(_site, list, _query, options) {
      seen.push([list, options.pageNumber, options.cursor]);
      if (list === "NOVACOTACAO" && options.pageNumber === 1) return { items: [{ id: "10", fields: { field_0: "Filial A", field_1: "ATIVA" } }], hasMore: true, nextLink: "second" };
      if (list === "NOVACOTACAO") return { items: [{ id: "9", fields: { field_1: "INATIVA" } }], hasMore: false };
      if (list === "ORCAMENTOS") return { items: [{ id: "20", fields: { field_0: 10, field_1: "1.234,50", field_2: "PENDENTE SOLICITAÇÃO" } }], hasMore: false };
      if (list === "IMOBILIZADOS") return { items: [{ id: "1", fields: { field_0: "P1", field_1: "2026-10-02", field_2: "2.000,00", field_3: 2 } }], hasMore: false };
      return { items: [{ id: "7", fields: { field_0: "2026-10-05", field_1: "PENDENTE", field_2: "2026-09-20" } }], hasMore: false };
    },
  };
  const data = createAuditReportsData({ repository: repo });
  const quotes = await data.loadReport(11);
  assert.deepEqual(quotes.quotes.map(row => row.id), ["10", "9"]);
  assert.deepEqual([quotes.budgets[0].quotationId, quotes.budgets[0].total], ["10", 1234.5]);
  assert.ok(seen.some(([list, page, cursor]) => list === "NOVACOTACAO" && page === 2 && cursor === "second"));
  const assets = await data.loadReport(12);
  assert.deepEqual([assets.rows[0].estimated, assets.rows[0].quantity, assets.rows[0].residual], [2000, 2, null]);
  const documents = await data.loadReport(13);
  assert.deepEqual([documents.rows[0].validityDate, documents.rows[0].issuedDate], ["2026-10-05", "2026-09-20"]);
});

test("aborta a consulta antes de produzir um relatório incompleto", async () => {
  const controller = new AbortController();
  const { repo } = repository();
  repo.getItemsPage = async () => { controller.abort(); return { items: [], hasMore: false }; };
  await assert.rejects(createAuditReportsData({ repository: repo }).loadReport(13, { signal: controller.signal }), /abort|cancel/i);
});
