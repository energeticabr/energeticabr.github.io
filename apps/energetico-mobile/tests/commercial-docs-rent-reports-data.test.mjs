import test from "node:test";
import assert from "node:assert/strict";
import { createCommercialDocsRentReportsData, selectRentDashboard } from "../src/chat/commercial-docs-rent-reports-data.js";

const columns = {
  "IMOVEL CADASTRADO": ["FILIAL", "IMOVEL", "STATUS", "STATUSVISUAL", "FISCAL", "SEGURO", "IDPROPOSTA", "IDCONTRATOCAIXA", "IDESCRITURA", "IDDOCUMENTOCORRETAGEM", "IDDOCFISCAL", "IDPGTOFISCAL", "IDPGTOCORRETAGEM", "OBS FISCAL", "CORRETAGEM", "CORRETOR", "DESCRITIVO CORRETAGEM", "VLORFISCAL", "VLORCORRETAGEM"],
  LANCAMENTOALUGUEL: ["DESCRICAO", "INQUILINO", "DATA VENCIMENTO", "DATAPGTOEFETUADO", "FORMA PGTO", "NUM. CONTRATO ALUGUEL", "VALOR BRUTO"],
  "CADASTRO ALUGUEL": ["VALOR", "DESCRICAOIMOVEL", "INQUILINO", "FORMA DE PGTO", "STATUS", "DATA REAJUSTE", "INDEX", "DATA VENCIMENTO"],
  LANCAMENTOCOMPRAS: ["FILIAL", "IMOVEL", "NOME"],
};
const item = (id, fields) => ({ id: String(id), fields });
function record(list, id, values) {
  return item(id, Object.fromEntries(columns[list].map((name, index) => [`field_${index + 1}`, values[name] ?? ""])));
}
function repositoryWith(records, overrides = {}) {
  return {
    async resolveList(site, aliases) {
      assert.equal(site, "personal");
      return { status: "resolved", id: aliases[0] };
    },
    async getColumns(_site, list) { return columns[list].map((displayName, index) => ({ name: `field_${index + 1}`, displayName })); },
    async getItemsPage(_site, list, _query, options) {
      const rows = records[list] || [];
      const start = (options.pageNumber - 1) * 100;
      return { items: rows.slice(start, start + 100), hasMore: start + 100 < rows.length, nextLink: start + 100 < rows.length ? `next-${options.pageNumber}` : "" };
    },
    ...overrides,
  };
}

test("status do contrato selecionado limita aluguéis abertos e totais anuais", () => {
  const contracts = [
    { id: "1", property: "Loja A", tenant: "Ana", paymentMethod: "PIX", status: "ATIVO", amountCents: 10000 },
    { id: "2", property: "Loja B", tenant: "Bia", paymentMethod: "PIX", status: "ENCERRADO", amountCents: 20000 },
  ];
  const sourceRows = contracts.map((contract, index) => ({ id: String(index + 1), contractId: contract.id,
    property: contract.property, tenant: contract.tenant, paymentMethod: "PIX", dueDate: "2026-10-02",
    paidDate: "", grossCents: contract.amountCents }));
  const result = selectRentDashboard({ contracts, sourceRows, todayKey: "2026-10-02" }, { status: "ATIVO", year: "2026" });
  assert.deepEqual(result.rows.map(row => row.contractId), ["1"]);
  assert.equal(result.summary.totalCents, 10000);
  assert.deepEqual(result.annualRows.map(row => row.property), ["Loja A"]);
  assert.equal(result.annualTotalCents, 10000);
});

test("ano e mês anuais vêm do mesmo período efetivo inclusive na virada do ano", () => {
  const contracts = [{ id: "1", property: "Loja A", tenant: "Ana", paymentMethod: "PIX", status: "ATIVO", amountCents: 10000 }];
  const sourceRows = [{ id: "1", contractId: "1", property: "Loja A", tenant: "Ana", paymentMethod: "PIX",
    dueDate: "2026-12-20", paidDate: "2027-01-03", grossCents: 10000 }];
  const snapshot = { contracts, sourceRows, todayKey: "2026-12-20" };
  const previous = selectRentDashboard(snapshot, { year: "2026" });
  const next = selectRentDashboard(snapshot, { year: "2027" });
  assert.equal(previous.annualTotalCents, 0);
  assert.equal(previous.monthlyTotals[0], 0);
  assert.equal(next.monthlyTotals[0], 10000);
  assert.equal(next.annualTotalCents, 10000);
});

test("relatório 16 conta IDs, estados e campos pendentes por imóvel válido", async () => {
  const full = { FILIAL: "Centro", IMOVEL: "Loja A", STATUS: "VENDIDO", STATUSVISUAL: "ATIVO", FISCAL: "DECLARADO", SEGURO: "S1", IDPROPOSTA: "P1", IDCONTRATOCAIXA: "C1", IDESCRITURA: "E1", IDDOCUMENTOCORRETAGEM: "D1", IDDOCFISCAL: "F1", IDPGTOFISCAL: "PG1", IDPGTOCORRETAGEM: "PG2", "OBS FISCAL": "ok", CORRETAGEM: "ok", CORRETOR: "Ana", "DESCRITIVO CORRETAGEM": "ok", VLORFISCAL: "1", VLORCORRETAGEM: "1" };
  const rows = [record("IMOVEL CADASTRADO", 1, full), record("IMOVEL CADASTRADO", 2, { ...full, IMOVEL: "Loja B", STATUS: "À VENDA", FISCAL: "", SEGURO: " ", IDPROPOSTA: "", "OBS FISCAL": "" }), record("IMOVEL CADASTRADO", 3, { ...full, IMOVEL: "ESCRITÓRIO MATRIZ" }), record("IMOVEL CADASTRADO", 4, { ...full, IMOVEL: "TODOS" })];
  const data = createCommercialDocsRentReportsData({ repository: repositoryWith({ "IMOVEL CADASTRADO": rows }) });
  const result = await data.loadReport(16);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows.map(row => [row.property, row.idPending, row.fieldsPending, row.totalPending]), [["Loja A", 0, 0, 0], ["Loja B", 4, 2, 6]]);
  assert.equal(result.summary.properties, 2);
  assert.equal(result.summary.totalPending, 6);
  assert.equal(result.rows[1].documents.find(field => field.key === "SEGURO").pending, true);
});

test("relatório 17 mostra só lançamentos sem pagamento, ordena vencimentos e soma valor do contrato", async () => {
  const repository = repositoryWith({
    "CADASTRO ALUGUEL": [record("CADASTRO ALUGUEL", 10, { VALOR: "1.234,50", DESCRICAOIMOVEL: "Loja A", INQUILINO: "Ana" }), record("CADASTRO ALUGUEL", 11, { VALOR: "200", DESCRICAOIMOVEL: "Loja B", INQUILINO: "Bia" })],
    LANCAMENTOALUGUEL: [
      record("LANCAMENTOALUGUEL", 1, { DESCRICAO: "Loja B", INQUILINO: "Bia", "DATA VENCIMENTO": "2026-10-05", "FORMA PGTO": "PIX", "NUM. CONTRATO ALUGUEL": "11", "VALOR BRUTO": "200" }),
      record("LANCAMENTOALUGUEL", 2, { DESCRICAO: "Loja A", INQUILINO: "Ana", "DATA VENCIMENTO": "2026-09-28", "FORMA PGTO": "Boleto", "NUM. CONTRATO ALUGUEL": "10", "VALOR BRUTO": "1.234,50" }),
      record("LANCAMENTOALUGUEL", 3, { DESCRICAO: "Loja A", INQUILINO: "Ana", "DATA VENCIMENTO": "2026-09-01", DATAPGTOEFETUADO: "2026-09-02", "NUM. CONTRATO ALUGUEL": "10", "VALOR BRUTO": "1.234,50" }),
    ],
  });
  const result = await createCommercialDocsRentReportsData({ repository, today: () => "2026-10-02" }).loadReport(17);
  assert.deepEqual(result.rows.map(row => [row.property, row.amountCents, row.dueState, row.days]), [["Loja A", 123450, "overdue", 4], ["Loja B", 20000, "upcoming", 3]]);
  assert.deepEqual(result.summary, { open: 2, overdue: 1, today: 0, upcoming: 1, totalCents: 143450 });
});

test("relatório 17 mantém aluguéis abertos com valor bruto vazio ou inválido usando o contrato", async () => {
  const repository = repositoryWith({
    "CADASTRO ALUGUEL": [record("CADASTRO ALUGUEL", 10, { VALOR: "125,50", DESCRICAOIMOVEL: "Loja", INQUILINO: "Ana" })],
    LANCAMENTOALUGUEL: [
      record("LANCAMENTOALUGUEL", 1, { DESCRICAO: "Loja", INQUILINO: "Ana", "DATA VENCIMENTO": "2026-10-02", "NUM. CONTRATO ALUGUEL": "10", "VALOR BRUTO": "" }),
      record("LANCAMENTOALUGUEL", 2, { DESCRICAO: "Loja", INQUILINO: "Ana", "DATA VENCIMENTO": "2026-10-03", "NUM. CONTRATO ALUGUEL": "10", "VALOR BRUTO": "a conferir" }),
    ],
  });
  const result = await createCommercialDocsRentReportsData({ repository, today: () => "2026-10-02" }).loadReport(17, { filters: { year: "2026" } });
  assert.deepEqual(result.rows.map(row => [row.id, row.amountCents]), [["1", 12550], ["2", 12550]]);
  assert.equal(result.summary.totalCents, 25100);
  assert.equal(result.monthlyTotals[9], 25100);
  assert.equal(result.annualTotalCents, 25100);
});

test("relatório 17 ignora valor bruto inválido de pagamento fora do ano selecionado", async () => {
  const repository = repositoryWith({
    "CADASTRO ALUGUEL": [record("CADASTRO ALUGUEL", 10, { VALOR: "125,50", DESCRICAOIMOVEL: "Loja", INQUILINO: "Ana" })],
    LANCAMENTOALUGUEL: [
      record("LANCAMENTOALUGUEL", 1, { DESCRICAO: "Loja", INQUILINO: "Ana", "DATA VENCIMENTO": "2025-12-15", DATAPGTOEFETUADO: "2025-12-20", "NUM. CONTRATO ALUGUEL": "10", "VALOR BRUTO": "inválido" }),
      record("LANCAMENTOALUGUEL", 2, { DESCRICAO: "Loja", INQUILINO: "Ana", "DATA VENCIMENTO": "2026-10-01", DATAPGTOEFETUADO: "2026-10-02", "NUM. CONTRATO ALUGUEL": "10", "VALOR BRUTO": "150" }),
    ],
  });
  const result = await createCommercialDocsRentReportsData({ repository, today: () => "2026-10-02" }).loadReport(17, { filters: { year: "2026" } });
  assert.equal(result.summary.open, 0);
  assert.equal(result.monthlyTotals[9], 15000);
  assert.equal(result.annualTotalCents, 15000);
});

test("relatório 17 recusa valor bruto inválido de pagamento no ano selecionado", async () => {
  const repository = repositoryWith({
    "CADASTRO ALUGUEL": [record("CADASTRO ALUGUEL", 10, { VALOR: "125,50", DESCRICAOIMOVEL: "Loja", INQUILINO: "Ana" })],
    LANCAMENTOALUGUEL: [record("LANCAMENTOALUGUEL", 1, { DESCRICAO: "Loja", INQUILINO: "Ana", "DATA VENCIMENTO": "2026-10-01", DATAPGTOEFETUADO: "2026-10-02", "NUM. CONTRATO ALUGUEL": "10", "VALOR BRUTO": "inválido" })],
  });
  await assert.rejects(createCommercialDocsRentReportsData({ repository, today: () => "2026-10-02" }).loadReport(17, { filters: { year: "2026" } }), /valor.*contrato 1/i);
});

test("relatório 17 recusa contrato inexistente e valor não numérico, sem total parcial", async () => {
  const launch = record("LANCAMENTOALUGUEL", 1, { DESCRICAO: "Loja", INQUILINO: "Ana", "DATA VENCIMENTO": "2026-10-02", "NUM. CONTRATO ALUGUEL": "99", "VALOR BRUTO": "100" });
  const missing = repositoryWith({ LANCAMENTOALUGUEL: [launch] });
  await assert.rejects(createCommercialDocsRentReportsData({ repository: missing }).loadReport(17), /contrato/i);
  const invalid = repositoryWith({ LANCAMENTOALUGUEL: [launch], "CADASTRO ALUGUEL": [record("CADASTRO ALUGUEL", 99, { VALOR: "sem valor" })] });
  await assert.rejects(createCommercialDocsRentReportsData({ repository: invalid }).loadReport(17), /valor/i);
});

test("paginação e esquema incompletos recusam totais dos dois relatórios", async () => {
  const noCursor = repositoryWith({}, { async getItemsPage() { return { items: [], hasMore: true, nextLink: "" }; } });
  await assert.rejects(createCommercialDocsRentReportsData({ repository: noCursor }).loadReport(16), /pagina|próxima/i);
  const noColumn = repositoryWith({}, { async getColumns() { return [{ name: "field_1", displayName: "FILIAL" }]; } });
  await assert.rejects(createCommercialDocsRentReportsData({ repository: noColumn }).loadReport(16), /coluna|IMOVEL/i);
});

test("relatório 16 inclui itens da segunda página antes de fechar o total", async () => {
  const records = Array.from({ length: 101 }, (_, index) => record("IMOVEL CADASTRADO", index + 1, { FILIAL: "Centro", IMOVEL: `Loja ${index + 1}` }));
  const result = await createCommercialDocsRentReportsData({ repository: repositoryWith({ "IMOVEL CADASTRADO": records }) }).loadReport(16);
  assert.equal(result.summary.properties, 101);
  assert.equal(result.summary.totalPending, 101 * 19);
});

test("relatório 17 recusa data atual inválida antes de classificar vencimentos", async () => {
  const repository = repositoryWith({
    LANCAMENTOALUGUEL: [record("LANCAMENTOALUGUEL", 1, { DESCRICAO: "Loja", INQUILINO: "Ana", "DATA VENCIMENTO": "2026-10-02", "NUM. CONTRATO ALUGUEL": "10", "VALOR BRUTO": "200" })],
    "CADASTRO ALUGUEL": [record("CADASTRO ALUGUEL", 10, { VALOR: "200" })],
  });
  await assert.rejects(createCommercialDocsRentReportsData({ repository, today: () => new Date("invalid") }).loadReport(17), /data atual/i);
});

test("relatório 16 cruza comprador e contrato exatos com filial e imóvel do mesmo lançamento", async () => {
  const properties = [
    record("IMOVEL CADASTRADO", 1, { FILIAL: "Centro", IMOVEL: "Loja A" }),
    record("IMOVEL CADASTRADO", 2, { FILIAL: "Norte", IMOVEL: "Loja A" }),
    record("IMOVEL CADASTRADO", 3, { FILIAL: "Centro", IMOVEL: "Loja AB" }),
  ];
  const purchases = [
    record("LANCAMENTOCOMPRAS", 10, { FILIAL: "Centro", IMOVEL: "Loja A", NOME: "Ana" }),
    record("LANCAMENTOCOMPRAS", 11, { FILIAL: "Centro", IMOVEL: "Loja A", NOME: "Bia" }),
    record("LANCAMENTOCOMPRAS", 12, { FILIAL: "Norte", IMOVEL: "Loja A", NOME: "Ana" }),
    record("LANCAMENTOCOMPRAS", 13, { FILIAL: "Centro", IMOVEL: "Loja AB", NOME: "Anabela" }),
  ];
  const data = createCommercialDocsRentReportsData({ repository: repositoryWith({ "IMOVEL CADASTRADO": properties, LANCAMENTOCOMPRAS: purchases }) });
  const byBuyer = await data.loadReport(16, { filters: { branch: "Centro", buyer: "Ana" } });
  assert.deepEqual(byBuyer.rows.map(row => row.property), ["Loja A"]);
  assert.deepEqual(byBuyer.rows[0].contracts.map(contract => contract.id), ["10"]);
  const byContract = await data.loadReport(16, { filters: { contract: "12" } });
  assert.deepEqual(byContract.rows.map(row => [row.branch, row.property]), [["Norte", "Loja A"]]);
  const noMixedMatch = await data.loadReport(16, { filters: { buyer: "Ana", contract: "11" } });
  assert.equal(noMixedMatch.summary.properties, 0, "comprador e contrato precisam pertencer ao mesmo lançamento");
  const exactProperty = await data.loadReport(16, { filters: { property: "Loja A", branch: "Centro" } });
  assert.deepEqual(exactProperty.rows.map(row => row.property), ["Loja A"]);
});

test("relatório 16 fornece pendências por campo e totais por filial sem misturar linhas", async () => {
  const records = [
    record("IMOVEL CADASTRADO", 1, { FILIAL: "Centro", IMOVEL: "A", FISCAL: "NÃO DECLARADO", STATUS: "EM VENDA", STATUSVISUAL: "INATIVO", SEGURO: "S1" }),
    record("IMOVEL CADASTRADO", 2, { FILIAL: "Centro", IMOVEL: "B", FISCAL: "DECLARADO", STATUS: "VENDIDO", STATUSVISUAL: "ATIVO" }),
    record("IMOVEL CADASTRADO", 3, { FILIAL: "Norte", IMOVEL: "C" }),
  ];
  const result = await createCommercialDocsRentReportsData({ repository: repositoryWith({ "IMOVEL CADASTRADO": records }) }).loadReport(16);
  assert.equal(result.summary.fieldTotals.documents.find(field => field.key === "SEGURO").count, 2);
  assert.equal(result.summary.fieldTotals.states.find(field => field.key === "FISCAL").count, 2);
  assert.equal(result.summary.fieldTotals.fields.find(field => field.key === "FISCAL").count, 1);
  assert.deepEqual(result.summary.branches.map(branch => [branch.branch, branch.properties, branch.totalPending]), [["Centro", 2, 30], ["Norte", 1, 19]]);
  assert.equal(result.summary.branches[0].fieldTotals.documents.find(field => field.key === "SEGURO").count, 1);
});

test("relatório 17 aplica imóvel e inquilino exatos independentemente antes de totalizar", async () => {
  const repository = repositoryWith({
    "CADASTRO ALUGUEL": [record("CADASTRO ALUGUEL", 10, { VALOR: "100", DESCRICAOIMOVEL: "Loja A", INQUILINO: "Ana" })],
    LANCAMENTOALUGUEL: [
      record("LANCAMENTOALUGUEL", 1, { DESCRICAO: "Loja A", INQUILINO: "Ana", "DATA VENCIMENTO": "2026-10-02", "NUM. CONTRATO ALUGUEL": "10", "VALOR BRUTO": "100" }),
      record("LANCAMENTOALUGUEL", 2, { DESCRICAO: "Loja A", INQUILINO: "Bia", "DATA VENCIMENTO": "2026-10-02", "NUM. CONTRATO ALUGUEL": "10", "VALOR BRUTO": "100" }),
      record("LANCAMENTOALUGUEL", 3, { DESCRICAO: "Loja AB", INQUILINO: "Ana", "DATA VENCIMENTO": "2026-10-02", "NUM. CONTRATO ALUGUEL": "10", "VALOR BRUTO": "100" }),
    ],
  });
  const data = createCommercialDocsRentReportsData({ repository, today: () => "2026-10-02" });
  assert.deepEqual((await data.loadReport(17, { filters: { property: "Loja A" } })).rows.map(row => row.id), ["1", "2"]);
  assert.deepEqual((await data.loadReport(17, { filters: { tenant: "Ana" } })).rows.map(row => row.id), ["1", "3"]);
  const both = await data.loadReport(17, { filters: { property: "Loja A", tenant: "Ana" } });
  assert.deepEqual(both.rows.map(row => row.id), ["1"]);
  assert.equal(both.summary.totalCents, 10000);
});

test("relatório 16 não aceita lista de compras truncada ao oferecer filtros por comprador", async () => {
  const base = repositoryWith({ "IMOVEL CADASTRADO": [record("IMOVEL CADASTRADO", 1, { FILIAL: "Centro", IMOVEL: "Loja" })] });
  const repository = { ...base, async getItemsPage(site, list, query, options) {
    if (list === "LANCAMENTOCOMPRAS") return { items: [record(list, 10, { FILIAL: "Centro", IMOVEL: "Loja", NOME: "Ana" })], hasMore: true, nextLink: "" };
    return base.getItemsPage(site, list, query, options);
  } };
  await assert.rejects(createCommercialDocsRentReportsData({ repository }).loadReport(16), /paginação|próxima/i);
});
