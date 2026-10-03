import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCommercialDocsRentReportsView } from "../src/ui/commercial-docs-rent-reports-view.js";
import { createCommercialDocsRentReportsData } from "../src/chat/commercial-docs-rent-reports-data.js";

function openView(t, number, snapshot) {
  const dom = new JSDOM("<main></main>", { url: "https://example.test" });
  const view = createCommercialDocsRentReportsView({ document: dom.window.document,
    data: { async loadReport() { return snapshot; } } });
  dom.window.document.querySelector("main").append(view.element);
  t.after(() => { view.destroy(); dom.window.close(); });
  return { view, root: view.element, dom };
}

test("16 mostra oito medidas e imóveis por filial sem exigir filtro", async t => {
  const row = { id: "1", branch: "001 - OURO PRETO", property: "730", status: "VENDIDO", fiscal: "DECLARADO",
    documents: [
      { key: "SEGURO", label: "Seguro", value: "", pending: true },
      { key: "IDPROPOSTA", label: "ID proposta", value: "31", pending: false },
      { key: "IDCONTRATOCAIXA", label: "ID contrato caixa", value: "", pending: true },
      { key: "IDESCRITURA", label: "ID escritura", value: "", pending: true },
      { key: "IDDOCUMENTOCORRETAGEM", label: "ID doc. corretagem", value: "", pending: true },
      { key: "IDPGTOCORRETAGEM", label: "ID pgto. corretagem", value: "", pending: true },
      { key: "IDDOCFISCAL", label: "ID doc. fiscal", value: "", pending: true },
    ], stateChecks: [], otherFields: [], contracts: [], idPending: 6, fieldsPending: 0, totalPending: 6 };
  const { view, root } = openView(t, 16, { rows: [row] });
  await view.open(16);
  assert.equal(root.firstElementChild.className, "cdr-filters", "filtros aparecem acima da faixa da marca");
  assert.match(root.querySelector(".cdr-heading img")?.getAttribute("src") || "", /logo-energetica-oficial\.png/);
  assert.equal(root.querySelectorAll(".cdr-metric").length, 8);
  assert.equal(root.querySelector('[data-metric="SEGURO"]').textContent, "1");
  assert.equal(root.querySelector('[data-metric="IDPROPOSTA"]').textContent, "0");
  assert.equal(root.querySelector('[data-metric="totalMeasures"]').textContent, "6");
  assert.equal(root.querySelectorAll(".cdr-branch-table tbody tr").length, 1);
  assert.match(root.querySelector(".cdr-branch-table thead").textContent, /PENDÊNCIAS.*SITUAÇÃO FISCAL/is);
  assert.match(root.querySelector(".cdr-branch-table tbody").textContent, /730/);
  const cells = [...root.querySelectorAll(".cdr-branch-table tbody td")];
  assert.equal(cells[8].dataset.state, "pending", "ID do seguro pendente precisa de tratamento vermelho");
  assert.equal(cells[9].dataset.state, "clear", "ID da proposta preenchido precisa de tratamento verde");
});

test("17 apresenta ano e status, matriz mensal, reajustes e vencimentos", async t => {
  const open = { id: "2", property: "Galpão", tenant: "Ana", dueDate: "2026-10-02", paymentMethod: "PIX", contractId: "3", amountCents: 12000, dueState: "today", days: 0, status: "ATIVO", year: "2026" };
  const snapshot = { rows: [open], todayKey: "2026-10-02", year: "2026",
    sourceRows: [{ id: "2", property: "Galpão", tenant: "Ana", dueDate: "2026-10-02", paidDate: "", paymentMethod: "PIX", contractId: "3", grossCents: 12000 }],
    contracts: [{ id: "3", property: "Galpão", tenant: "Ana", paymentMethod: "PIX", status: "ATIVO", amountCents: 12000,
      adjustmentDate: "2026-11-01", index: "IPCA", expiryDate: "2026-12-01" }] };
  const { view, root } = openView(t, 17, snapshot);
  await view.open(17);
  assert.ok(root.querySelector('[name="year"]'));
  assert.ok(root.querySelector('[name="status"]'));
  assert.equal(root.querySelector('[name="year"]').value, "2026");
  assert.equal(root.querySelector('[name="status"]').value, "ATIVO");
  assert.match(root.textContent, /RELATÓRIO ANUAL DE ALUGUÉIS/);
  assert.match(root.textContent, /TABELA DE REAJUSTE/);
  assert.match(root.textContent, /TABELA DE VENCIMENTO/);
  assert.equal(root.querySelectorAll(".cdr-annual-table tbody tr").length, 2);
  assert.match(root.querySelector(".cdr-annual-table").textContent, /R\$\s*120,00/);
});

test("17 recusa fonte sem colunas de valor bruto e reajuste em vez de montar resumo parcial", async () => {
  const lists = { LANCAMENTOALUGUEL: ["DESCRICAO", "INQUILINO", "DATA VENCIMENTO", "DATAPGTOEFETUADO", "FORMA PGTO", "NUM. CONTRATO ALUGUEL"],
    "CADASTRO ALUGUEL": ["VALOR"] };
  const repository = {
    async resolveList(_site, aliases) { return { status: "resolved", id: aliases[0] }; },
    async getColumns(_site, list) { return lists[list].map((displayName, index) => ({ name: `field_${index + 1}`, displayName })); },
    async getItemsPage() { return { items: [], hasMore: false }; },
  };
  await assert.rejects(createCommercialDocsRentReportsData({ repository }).loadReport(17), /VALOR BRUTO|DATA REAJUSTE/i);
});

test("17 usa pagamento efetivo no mês anual e filtra ano e status sem perder reajustes", async () => {
  const schema = {
    LANCAMENTOALUGUEL: ["DESCRICAO", "INQUILINO", "DATA VENCIMENTO", "DATAPGTOEFETUADO", "FORMA PGTO", "NUM. CONTRATO ALUGUEL", "VALOR BRUTO"],
    "CADASTRO ALUGUEL": ["VALOR", "DESCRICAOIMOVEL", "INQUILINO", "FORMA DE PGTO", "STATUS", "DATA REAJUSTE", "INDEX", "DATA VENCIMENTO"],
  };
  const item = (list, id, values) => ({ id: String(id), fields: Object.fromEntries(schema[list].map((name, index) => [`field_${index + 1}`, values[name] ?? ""])) });
  const records = {
    "CADASTRO ALUGUEL": [item("CADASTRO ALUGUEL", 10, { VALOR: "120", DESCRICAOIMOVEL: "Galpão", INQUILINO: "Ana", "FORMA DE PGTO": "PIX", STATUS: "ATIVO", "DATA REAJUSTE": "2026-11-01", INDEX: "IPCA", "DATA VENCIMENTO": "2026-12-01" })],
    LANCAMENTOALUGUEL: [
      item("LANCAMENTOALUGUEL", 1, { DESCRICAO: "Galpão", INQUILINO: "Ana", "DATA VENCIMENTO": "2026-10-02", "FORMA PGTO": "PIX", "NUM. CONTRATO ALUGUEL": "10", "VALOR BRUTO": "120" }),
      item("LANCAMENTOALUGUEL", 2, { DESCRICAO: "Galpão", INQUILINO: "Ana", "DATA VENCIMENTO": "2026-09-02", DATAPGTOEFETUADO: "2026-10-01", "FORMA PGTO": "PIX", "NUM. CONTRATO ALUGUEL": "10", "VALOR BRUTO": "150" }),
      item("LANCAMENTOALUGUEL", 3, { DESCRICAO: "Galpão", INQUILINO: "Ana", "DATA VENCIMENTO": "2025-10-02", "FORMA PGTO": "PIX", "NUM. CONTRATO ALUGUEL": "10", "VALOR BRUTO": "100" }),
    ],
  };
  const repository = {
    async resolveList(_site, aliases) { return { status: "resolved", id: aliases[0] }; },
    async getColumns(_site, list) { return schema[list].map((displayName, index) => ({ name: `field_${index + 1}`, displayName })); },
    async getItemsPage(_site, list) { return { items: records[list], hasMore: false }; },
  };
  const result = await createCommercialDocsRentReportsData({ repository, today: () => "2026-10-02" }).loadReport(17, { filters: { year: "2026", status: "ATIVO" } });
  assert.deepEqual(result.rows.map(row => row.id), ["3", "1"], "a lista em aberto não usa o filtro anual, conforme BaseLancamentoSemData");
  assert.deepEqual(result.annualRows.map(row => [row.property, row.months[9], row.totalCents]), [["Galpão", 27000, 27000]]);
  assert.equal(result.monthlyTotals[9], 27000);
  assert.equal(result.annualTotalCents, 27000);
  assert.deepEqual(result.adjustments.map(row => [row.property, row.date, row.index]), [["Galpão", "2026-11-01", "IPCA"]]);
  assert.deepEqual(result.expirations.map(row => [row.property, row.date]), [["Galpão", "2026-12-01"]]);
});
