import test from "node:test";
import assert from "node:assert/strict";

const model = await import("../src/chat/spending-reports-model.js").catch(() => ({}));

const row = (id, changes = {}) => ({ id: String(id), date: "2026-09-12", paymentDate: "2026-09-25",
  supplier: "Alfa", product: "Cimento", branch: "Filial A", disbursement: "SIM", order: "42",
  stage: "Fundação", account: "Obra", description: "Entrega", unit: 20, quantity: 2, freight: 5, total: 45, ...changes });

test("normaliza colunas SharePoint e preserva valor ausente como incompleto", () => {
  assert.equal(typeof model.normalizeSpendingLaunch, "function");
  const columns = [
    { name: "field_2", displayName: "DATA" }, { name: "field_5", displayName: "FORNECEDOR" },
    { name: "field_7", displayName: "PRODUTO" }, { name: "field_8", displayName: "QUANTIDADE" },
    { name: "field_9", displayName: "VALOR UNITÁRIO" }, { name: "field_10", displayName: "FRETE" },
    { name: "field_14", displayName: "CONTA" }, { name: "field_20", displayName: "DATA PGTO EFETUADO" },
  ];
  const result = model.normalizeSpendingLaunch({ id: "11", fields: {
    field_2: "2026-09-12T03:00:00Z", field_5: "Alfa", field_7: "Cimento", field_8: "2",
    field_9: "1.234,50", field_10: "5", field_14: "Obra", field_20: "2026-09-25", Title: "Filial A",
  } }, columns);
  assert.equal(result.total, 2474);
  assert.equal(result.date, "2026-09-12");
  assert.equal(result.paymentDate, "2026-09-25");
  assert.equal(result.branch, "Filial A");
  assert.equal(model.normalizeSpendingLaunch({ id: "12", fields: { field_8: 2 } }, columns).total, null);
});

test("relatório 9 aplica período e filtros, agrega filiais e limita rankings a 15 sem cortar totais", () => {
  assert.equal(typeof model.buildSpendingReport9, "function");
  const launches = [row(1), row(2, { product: "Areia", unit: 10, quantity: 3, freight: 0, total: 30 }),
    row(3, { branch: "Filial B", total: 100 }), row(4, { date: "2026-08-31", total: 200 })];
  const report = model.buildSpendingReport9({ launches, productTypes: [
    { product: "Cimento", expenseType: "Material" }, { product: "Areia", expenseType: "Material" },
  ] }, { year: "2026", month: "9", branch: "Filial A" });
  assert.equal(report.count, 2);
  assert.equal(report.total, 75);
  assert.equal(report.branches[0].total, 75);
  assert.equal(report.branches[0].expenseTypes[0].name, "Material");
  assert.equal(report.branches[0].expenseTypes[0].percentage, 100);
  assert.deepEqual(report.branches[0].products.map(item => item.name), ["Cimento", "Areia"]);
  const many = model.buildSpendingReport9({ launches: Array.from({ length: 17 }, (_, index) =>
    row(index + 1, { product: `Produto ${index}`, total: index + 1 })), productTypes: [] });
  assert.equal(many.branches[0].products.length, 15);
  assert.equal(many.total, 153);
});

test("relatório 10 filtra pela DATA do lançamento e agrupa pela DATA PGTO EFETUADO", () => {
  assert.equal(typeof model.buildSpendingReport10, "function");
  const result = model.buildSpendingReport10({ launches: [row(1), row(2, { paymentDate: "2026-09-26", total: 30 }),
    row(3, { date: "2026-10-01", total: 80 })] }, { startDate: "2026-09-12", endDate: "2026-09-30" });
  assert.equal(result.count, 2);
  assert.equal(result.total, 75);
  assert.equal(result.quantity, 4);
  assert.equal(result.supplierCount, 1);
  assert.deepEqual(result.days.map(day => day.date), ["2026-09-25", "2026-09-26"]);
  assert.equal(result.days[0].suppliers[0].total, 45);
});

test("totais incompletos não são apresentados como definitivos", () => {
  const missing = row(2, { unit: null, total: null });
  const nine = model.buildSpendingReport9({ launches: [row(1), missing], productTypes: [] });
  const ten = model.buildSpendingReport10({ launches: [row(1), missing] });
  assert.equal(nine.total, null);
  assert.equal(nine.branches[0].total, null);
  assert.equal(ten.total, null);
  assert.equal(ten.days[0].suppliers[0].total, null);
  assert.equal(ten.incompleteCount, 1);
});

test("filtros de fornecedor, produto, desembolso e pedido selecionam apenas lançamentos correspondentes", () => {
  const launches = [row(1), row(2, { supplier: "Beta" }), row(3, { product: "Areia" }),
    row(4, { disbursement: "NÃO" }), row(5, { order: "43" })];
  const filters = { supplier: "alfa", product: "CIMENTO", disbursement: "sim", order: "42" };
  assert.equal(model.buildSpendingReport9({ launches, productTypes: [] }, filters).count, 1);
  assert.equal(model.buildSpendingReport10({ launches }, filters).count, 1);
});

test("classificação do produto usa a primeira correspondência do cadastro", () => {
  const report = model.buildSpendingReport9({ launches: [row(1)], productTypes: [
    { product: "Cimento", expenseType: "Material" }, { product: "Cimento", expenseType: "Duplicado" },
  ] });
  assert.equal(report.branches[0].expenseTypes[0].name, "Material");
});

test("relatório 9 ignora mês sem ano e exclui lançamento sem DATA", () => {
  const launches = [row(1), row(2, { date: "2025-08-10" }), row(3, { date: "" })];
  const report = model.buildSpendingReport9({ launches, productTypes: [] }, { month: "9" });
  assert.equal(report.count, 2);
  assert.equal(report.total, 90);
});
