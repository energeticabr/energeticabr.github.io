import test from "node:test";
import assert from "node:assert/strict";

const { createCommercialProgressReportsData } = await import("../src/chat/commercial-progress-reports-data.js").catch(() => ({}));

const columns = {
  "IMOVEL CADASTRADO": ["FILIAL", "IMOVEL", "STATUSVISUAL", "STATUS", "CORRETAGEM", "NF/RECIBO", "FISCAL"],
  "LANCAMENTOCOMPRAS": ["FILIAL", "IMOVEL", "NOME", "STATUS", "TOTAL"],
  "CADASTRO CLIENTE_1": ["FILIAL", "IMÓVEL ADQUIRIDO", "NOME", "DEFINITIVO"],
  "LANÇAMENTORECEITA": ["FILIAL", "IMOVEL", "IDCONTRATO", "FORNECEDOR", "VALORTOTAL", "DATAPGTOEFETUADO", "DATAPGTOPREVISTO", "PGTO DIR. CORRETOR", "DESCRIÇÃO"],
  "APONTAMENTOSCOMERCIAIS": ["FILIAL", "IMOVEL", "IDCONTRATO", "NOME", "TIPOMARCO", "DESCRICAO", "DATAINICIO", "DATAFIM", "DATAFATAL", "STATUS"],
};
const item = (id, names, values) => ({ id, fields: Object.fromEntries(names.map((name, index) => [`field_${index}`, values[index]])) });

function fixture(changes = {}) {
  const calls = [];
  const repository = {
    async resolveList(site, aliases) { assert.equal(site, "personal"); calls.push(["resolve", aliases[0]]); return { id: aliases[0], status: "resolved" }; },
    async getColumns(_site, list) { return columns[list].map((displayName, index) => ({ name: `field_${index}`, displayName })); },
    async getItemsPage(_site, list, _query, options) {
      calls.push(["page", list, options.pageNumber, options.cursor]);
      if (list === "LANÇAMENTORECEITA") {
        if (options.pageNumber === 1) return { items: [item("1", columns[list], ["Centro", "Casa 1", "10", "Ana", "R$ 1.234,56", "2026-09-20T12:00:00Z", "", "", "Entrada"])], hasMore: true, nextLink: "next" };
        return { items: [item("2", columns[list], ["Centro", "Casa 1", "10", "Ana", "R$ 30,00", "", "2026-10-10", "", "Saldo"])], hasMore: false, nextLink: "" };
      }
      if (list === "IMOVEL CADASTRADO") return { items: [item("1", columns[list], ["Centro", "Casa 1", "ATIVO", "VENDIDO", "PAGO EMPRESA", "PENDENTE", "DECLARADO"])], hasMore: false, nextLink: "" };
      if (list === "APONTAMENTOSCOMERCIAIS") return { items: [item("3", columns[list], ["Centro", "Casa 1", "10", "Ana", "Assinatura", "Concluída", "2026-09-30", "2026-10-04", "2026-10-03", "ATIVIDADE INICIADA"])], hasMore: false, nextLink: "" };
      return { items: [], hasMore: false, nextLink: "" };
    }, ...changes,
  };
  return { repository, calls };
}

test("relatório 14 consulta quatro listas reais, percorre todas as páginas e normaliza valor brasileiro", async () => {
  assert.equal(typeof createCommercialProgressReportsData, "function");
  const { repository, calls } = fixture();
  const result = await createCommercialProgressReportsData({ repository }).loadSnapshot({ reportNumber: 14 });
  assert.equal(result.receipts.length, 2);
  assert.deepEqual(result.receipts.map(row => row.amount), [1234.56, 30]);
  assert.equal(result.receipts[0].paidDate, "2026-09-20");
  assert.equal(result.properties[0].visualStatus, "ATIVO");
  assert.ok(calls.some(call => call[0] === "page" && call[1] === "LANÇAMENTORECEITA" && call[2] === 2 && call[3] === "next"));
  assert.deepEqual(calls.filter(call => call[0] === "resolve").map(call => call[1]).sort(),
    ["IMOVEL CADASTRADO", "LANCAMENTOCOMPRAS", "CADASTRO CLIENTE_1", "LANÇAMENTORECEITA"].sort());
});

test("relatório 15 consulta apontamentos e imóveis sem exigir listas financeiras", async () => {
  const { repository, calls } = fixture();
  const result = await createCommercialProgressReportsData({ repository }).loadSnapshot({ reportNumber: 15 });
  assert.deepEqual(result.milestones.map(row => [row.id, row.type, row.startDate]), [["3", "Assinatura", "2026-09-30"]]);
  assert.equal(result.milestones[0].endDate, "2026-10-04");
  assert.equal(result.milestones[0].status, "ATIVIDADE INICIADA");
  assert.deepEqual(calls.filter(call => call[0] === "resolve").map(call => call[1]).sort(), ["IMOVEL CADASTRADO", "APONTAMENTOSCOMERCIAIS"].sort());
});

test("relatório 14 rejeita lista de contratos sem coluna TOTAL", async () => {
  const { repository } = fixture({ async getColumns(_site, list) {
    const names = list === "LANCAMENTOCOMPRAS" ? columns[list].filter(name => name !== "TOTAL") : columns[list];
    return names.map((displayName, index) => ({ name: `field_${index}`, displayName }));
  } });
  await assert.rejects(createCommercialProgressReportsData({ repository }).loadSnapshot({ reportNumber: 14 }), /TOTAL|coluna/i);
});

test("relatório 15 atravessa mais de 100 páginas por cursor sem descartar registros", async () => {
  let milestonePages = 0; const seen = [];
  const { repository } = fixture({ async getItemsPage(_site, list, _query, options) {
    if (list !== "APONTAMENTOSCOMERCIAIS") return { items: [], hasMore: false, nextLink: "" };
    milestonePages++; seen.push([options.pageNumber, options.cursor, options.maxPages]);
    return { items: [item(String(milestonePages), columns[list], ["Centro", "Casa 1", "10", "Ana", "Marco", "Etapa", "2026-09-30", "", "", "ATIVIDADE INICIADA"])],
      hasMore: milestonePages < 101, nextLink: milestonePages < 101 ? `cursor-${milestonePages}` : "" };
  } });
  const result = await createCommercialProgressReportsData({ repository }).loadSnapshot({ reportNumber: 15 });
  assert.equal(result.milestones.length, 101);
  assert.deepEqual(seen[100], [1, "cursor-100", 100]);
});

test("cursor repetido interrompe a consulta sem expor uma lista parcial", async () => {
  let pages = 0;
  const { repository } = fixture({ async getItemsPage(_site, list) {
    if (list === "APONTAMENTOSCOMERCIAIS") pages++;
    return { items: list === "APONTAMENTOSCOMERCIAIS" ? [item(String(pages), columns[list], ["Centro", "Casa 1", "10", "Ana", "Marco", "Etapa", "2026-09-30", "", "", "ATIVIDADE INICIADA"])] : [],
      hasMore: list === "APONTAMENTOSCOMERCIAIS", nextLink: list === "APONTAMENTOSCOMERCIAIS" ? "cursor-repetido" : "" };
  } });
  await assert.rejects(createCommercialProgressReportsData({ repository }).loadSnapshot({ reportNumber: 15 }), /cursor repetido/i);
});

test("valor em pt-BR com separador de milhar sem centavos preserva a quantia", async () => {
  const { repository } = fixture({ async getItemsPage(_site, list) {
    return { items: list === "LANÇAMENTORECEITA" ? [item("1", columns[list], ["Centro", "Casa 1", "10", "Ana", "R$ 1.234", "2026-09-20", "", "", "Entrada"])] : [], hasMore: false, nextLink: "" };
  } });
  const result = await createCommercialProgressReportsData({ repository }).loadSnapshot({ reportNumber: 14 });
  assert.equal(result.receipts[0].amount, 1234);
});

test("página sem sinalização de conclusão e coluna essencial ausente não produzem snapshot parcial", async () => {
  const brokenPage = fixture({ async getItemsPage() { return { items: [], nextLink: "" }; } });
  await assert.rejects(createCommercialProgressReportsData({ repository: brokenPage.repository }).loadSnapshot({ reportNumber: 15 }), /página|paginação/i);
  const brokenColumns = fixture({ async getColumns(_site, list) { return (list === "IMOVEL CADASTRADO" ? ["FILIAL"] : columns[list]).map((displayName, index) => ({ name: `field_${index}`, displayName })); } });
  await assert.rejects(createCommercialProgressReportsData({ repository: brokenColumns.repository }).loadSnapshot({ reportNumber: 15 }), /IMOVEL|coluna/i);
});

test("consulta cancelada antes do início não acessa o SharePoint", async () => {
  const { repository, calls } = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(createCommercialProgressReportsData({ repository }).loadSnapshot({ reportNumber: 14, signal: controller.signal }), /abort|cancelad/i);
  assert.equal(calls.length, 0);
});
