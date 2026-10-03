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

test("relatório 10 usa só provisões vinculadas a recorrências, com vencimento e agendamento", () => {
  assert.equal(typeof model.normalizeSpendingProvision, "function");
  const provision = model.normalizeSpendingProvision({ id: "41", fields: {
    IDRECORRENCIA: "7", FILIAL: "004 - EDIFÍCIO XAVANTE", FORNECEDOR: "VIVO", PRODUTO: "TARIFA DE INTERNET",
    DATAPGTOPREVISTO: "2026-10-04", PGTOAGENDADO: "PENDENTE", VALORTOTAL: "89,99", STATUS: "PAGAMENTO PREVISTO",
  } });
  assert.equal(provision.dueDate, "2026-10-04");
  assert.equal(provision.total, 89.99);
  const result = model.buildSpendingReport10({
    launches: [row(99)],
    recurrences: [{ id: "7", status: "ATIVO" }],
    provisions: [provision, { ...provision, id: "42", recurrenceId: "", total: 1000 }],
  }, { status: "ATIVO", paymentStatus: "PAGAMENTO PREVISTO" });
  assert.equal(result.count, 1);
  assert.equal(result.total, 89.99);
  assert.equal(result.rows[0].schedule, "PENDENTE");
  assert.equal(result.rows[0].supplier, "VIVO");
});

test("relatório 10 reconhece IDs de recorrência separados e conta cada provisão uma vez", () => {
  const provision = { id: "41", recurrenceId: "7; 8\n9, 8", status: "PAGAMENTO PREVISTO", total: 89.99 };
  const snapshot = { recurrences: [{ id: "7", status: "INATIVO" }, { id: "8", status: "ATIVO" }, { id: "9", status: "ATIVO" }],
    provisions: [provision, { ...provision, id: "42", recurrenceId: "404", total: 100 }] };
  const result = model.buildSpendingReport10(snapshot, { status: "ATIVO" });
  assert.equal(result.count, 1);
  assert.equal(result.total, 89.99);
  assert.equal(result.rows[0].id, "41");
});

test("relatório 10 usa VALOR TOTAL já calculado, sem multiplicar pela quantidade", () => {
  const provision = model.normalizeSpendingProvision({ id: "42", fields: {
    IDRECORRENCIA: "7", VALORTOTAL: "100,00", QTD: "2", FRETE: "10,00",
    STATUS: "PAGAMENTO PREVISTO",
  } });
  assert.equal(provision.total, 100);
  assert.equal(model.buildSpendingReport10({
    recurrences: [{ id: "7", status: "ATIVO" }], provisions: [provision],
  }).total, 100);
});

test("relatório 10 permite consultar provisões pagas pelo filtro de status", () => {
  const snapshot = { recurrences: [{ id: "7", status: "ATIVO" }], provisions: [
    { id: "42", recurrenceId: "7", status: "PAGAMENTO EFETUADO", paidDate: "2026-10-05", total: 100 },
    { id: "43", recurrenceId: "7", status: "PAGAMENTO PREVISTO", paidDate: "", total: 50 },
  ] };
  const paid = model.buildSpendingReport10(snapshot, { paymentStatus: "PAGAMENTO EFETUADO" });
  assert.equal(paid.count, 1);
  assert.equal(paid.total, 100);
  assert.equal(paid.rows[0].id, "42");
});

test("agendamento booleano usa nome exibido da coluna SharePoint", () => {
  const columns = [{ name: "field_14", displayName: "PGTO AGENDADO" }];
  const scheduled = model.normalizeSpendingProvision({ id: "1", fields: { field_14: true } }, columns);
  const pending = model.normalizeSpendingProvision({ id: "2", fields: { field_14: false } }, columns);
  assert.equal(scheduled.schedule, "AGENDADO");
  assert.equal(pending.schedule, "PENDENTE");
});

test("totais incompletos não são apresentados como definitivos", () => {
  const missing = row(2, { unit: null, total: null });
  const nine = model.buildSpendingReport9({ launches: [row(1), missing], productTypes: [] });
  assert.equal(nine.total, null);
  assert.equal(nine.branches[0].total, null);
  const ten = model.buildSpendingReport10({ recurrences: [{ id: "7", status: "ATIVO" }],
    provisions: [{ id: "1", recurrenceId: "7", total: null, status: "PAGAMENTO PREVISTO" }] });
  assert.equal(ten.total, null);
  assert.equal(ten.incompleteCount, 1);
});

test("filtros de fornecedor, produto, desembolso e pedido selecionam apenas lançamentos correspondentes", () => {
  const launches = [row(1), row(2, { supplier: "Beta" }), row(3, { product: "Areia" }),
    row(4, { disbursement: "NÃO" }), row(5, { order: "43" })];
  const filters = { supplier: "alfa", product: "CIMENTO", disbursement: "sim", order: "42" };
  assert.equal(model.buildSpendingReport9({ launches, productTypes: [] }, filters).count, 1);
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
