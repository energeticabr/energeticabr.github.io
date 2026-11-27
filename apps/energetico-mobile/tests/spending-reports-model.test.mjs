import test from "node:test";
import assert from "node:assert/strict";

const model = await import("../src/chat/spending-reports-model.js").catch(() => ({}));

const row = (id, changes = {}) => ({ id: String(id), date: "2026-09-12", paymentDate: "2026-09-25",
  supplier: "Alfa", product: "Cimento", branch: "Filial A", disbursement: "SIM", order: "42",
  stage: "Fundação", account: "Obra", description: "Entrega", unit: 20, quantity: 2, freight: 5, total: 45, ...changes });

test('management totals use exact decimal sums without truncating over 2000 rows',()=>{
  const exact=model.buildSpendingReport9({launches:[row(1,{total:.1}),row(2,{total:.2})],productTypes:[]});
  assert.equal(exact.total,.3);assert.equal(exact.branches[0].total,.3);
  const many=model.buildSpendingReport9({launches:Array.from({length:2001},(_,i)=>row(i,{total:1})),productTypes:[]});
  assert.equal(many.count,2001);assert.equal(many.total,2001);
});

test('dashboard de tipo agrega o ano selecionado e oferece apenas anos com valores da filial e do tipo',()=>{
  const snapshot={
    launches:[
      row('1',{date:'2026-10-02',paymentDate:'2026-10-03',product:'Cimento',supplier:'Alfa',stage:'Fundação',total:60}),
      row('2',{date:'2026-09-02',paymentDate:'2026-09-03',product:'Brita',supplier:'Beta',stage:'Estrutura',total:40}),
      row('3',{branch:'Filial B',paymentDate:'2022-10-03',total:900}),
      row('4',{product:'Locação',paymentDate:'2023-10-03',total:800}),
      row('5',{date:'2023-12-30',paymentDate:'2024-01-02',total:25}),
      row('6',{paymentDate:'2025-10-03',total:0}),
      row('7',{paymentDate:'2021-10-03',total:null}),
    ],
    provisions:[
      {id:'p1',branch:'Filial A',product:'Cimento',supplier:'Beta',stage:'Estrutura',dueDate:'2026-12-20',total:30},
      {id:'p2',branch:'Filial A',product:'Brita',supplier:'Beta',stage:'Estrutura',dueDate:'2024-12-20',total:5},
      {id:'p3',branch:'Filial A',product:'Brita',dueDate:'2020-01-02',paidDate:'2020-01-03',total:200},
      {id:'p4',branch:'Filial A',product:'Brita',dueDate:'2019-01-02',total:15},
    ],
    productTypes:[{product:'Cimento',expenseType:'Material'},{product:'Brita',expenseType:'Material'},{product:'Locação',expenseType:'Serviços'}],
  };
  const filters={year:'2026',month:'10',supplier:'Alfa'};
  const scope={branch:'Filial A',expenseType:'MATERIAL',now:new Date('2026-10-05T12:00:00Z')};
  const result=model.buildManagementExpenseTypeDashboard(snapshot,filters,scope);

  assert.equal(result.year,2026);
  assert.deepEqual(result.years,[2026,2024,2019]);
  assert.equal(result.total,130);
  assert.equal(result.months.length,12);
  assert.equal(result.months[0].period,'2026-01');
  assert.deepEqual(result.months.slice(-4).map(month=>month.total),[40,60,0,30]);
  assert.deepEqual(result.products.map(item=>[item.name,item.total,item.percentage]),[
    ['Cimento',90,69.23076923076923],['Brita',40,30.76923076923077],
  ]);
  assert.deepEqual(result.suppliers.map(item=>item.name),['Beta','Alfa']);
  assert.deepEqual(result.stages.map(item=>item.name),['Estrutura','Fundação']);

  const previous=model.buildManagementExpenseTypeDashboard(snapshot,filters,{...scope,year:2024});
  assert.equal(previous.year,2024);
  assert.equal(previous.total,30);
  assert.deepEqual(previous.months[0],{period:'2024-01',paid:25,forecast:0,total:25});
  assert.deepEqual(previous.months[11],{period:'2024-12',paid:0,forecast:5,total:5});
  assert.deepEqual(previous.products.map(item=>[item.name,item.total]),[['Cimento',25],['Brita',5]]);
  const empty=model.buildManagementExpenseTypeDashboard(snapshot,filters,{...scope,now:new Date('2027-01-04T12:00:00Z')});
  assert.equal(empty.year,2027);
  assert.deepEqual(empty.years,[2026,2024,2019]);
  assert.deepEqual(empty.products,[]);
  assert.equal(empty.total,0);
});

test('management line multiplication preserves half-cent amounts before Brazilian money rounding',async()=>{
  const normalized=model.normalizeSpendingLaunch({id:'1',fields:{DATA:'2026-10-02',FILIAL:'Xavante',FORNECEDOR:'Alfa',PRODUTO:'Cimento',VALORUNITARIO:'2,30',QUANTIDADE:'0,05',FRETE:'0'}});
  assert.equal(normalized.total,.115);
  const {formatReportMoney}=await import('../src/chat/contractor-report-model.js');
  assert.match(formatReportMoney(model.buildSpendingReport9({launches:[normalized],productTypes:[]}).total),/0,12/);
});

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
  assert.equal(report.expenseBranches[0].expenseTypes[0].name, "Material");
  assert.equal(report.expenseBranches[0].expenseTypes[0].percentage, 100);
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

test("filtro de etapa do relatório 9 reproduz o seletor do Power Apps", () => {
  const launches = [row(1, { stage: "Fundação" }), row(2, { stage: "Alvenaria" })];
  assert.equal(model.buildSpendingReport9({ launches, productTypes: [] }, { stage: "Alvenaria" }).count, 1);
});

test("classificação do produto usa a primeira correspondência do cadastro", () => {
  const report = model.buildSpendingReport9({ launches: [row(1)], productTypes: [
    { product: "Cimento", expenseType: "Material" }, { product: "Cimento", expenseType: "Duplicado" },
  ] });
  assert.equal(report.expenseBranches[0].expenseTypes[0].name, "Material");
});

test("relatório 9 ignora mês sem ano e exclui lançamento sem DATA", () => {
  const launches = [row(1), row(2, { date: "2025-08-10" }), row(3, { date: "" })];
  const report = model.buildSpendingReport9({ launches, productTypes: [] }, { month: "9" });
  assert.equal(report.count, 2);
  assert.equal(report.total, 90);
});

test("despesas por filial somam baixas de lançamentos e provisões abertas pelo vencimento", () => {
  const paid = model.normalizeSpendingLaunch({ id: "1", fields: {
    field_2: "2026-08-01", field_3: "2026-09-02", field_4: "2026-09-03",
    FILIAL: "Filial A", ETAPA: "Fundação", PRODUTO: "Cimento", QUANTIDADE: 1, VALORUNITARIO: ".1",
  } });
  const launches = [
    paid,
    row(2, { date: "2026-08-01", paymentDate: "", expectedPaymentDate: "2026-09-01", total: 999 }),
    row(4, { paymentDate: "2026-10-01", expectedPaymentDate: "2026-09-01", total: 300 }),
    row(5, { paymentDate: "", expectedPaymentDate: "2026-10-01", total: 400 }),
    row(6, { paymentDate: "", expectedPaymentDate: "", total: 500 }),
    row(7, { stage: "Obra", total: 1000 }),
  ];
  const provision = { branch: "Filial A", product: "Cimento", stage: "Fundação", dueDate: "2026-09-01", total: .2 };
  const provisions = [
    { ...provision, schedule: "AGENDADO" },
    { ...provision, branch: "Filial B", dueDate: "2026-09-30", total: 150 },
    { ...provision, dueDate: "2026-10-01", total: 555 },
    { ...provision, stage: "Obra", total: 555 },
    { ...provision, paidDate: "2026-10-01", total: 555 },
    { ...provision, schedule: "PAGO", total: 555 },
    { ...provision, status: "PAGAMENTO EFETUADO", total: 555 },
  ];
  assert.equal(paid.paymentDate, "2026-09-03");
  assert.equal(paid.expectedPaymentDate, "2026-09-02");
  const report = model.buildSpendingReport9({
    launches, provisions, productTypes: [{ product: "Cimento", expenseType: "Material" }],
  }, { year: "2026", month: "9", stage: "Fundação" });
  assert.deepEqual(report.expenseBranches.map(({ name, paid, forecast, total }) => [name, paid, forecast, total]), [
    ["Filial B", 0, 150, 150], ["Filial A", .1, .2, .3],
  ]);
  assert.deepEqual(report.expenseBranches[1].expenseTypes, [
    { name: "Material", paid: .1, forecast: .2, total: .3, percentage: 100, previousTotal:0, change:Infinity,
      products: [{ name: "Cimento", paid: .1, forecast: .2, total: .3, percentage: 100, previousTotal:0, change:Infinity }] },
  ]);
});

test("valor ausente em um previsto deixa apenas a previsão e a soma incompletas", () => {
  const launches = [row(1)];
  const provisions = [{ branch: "Filial A", dueDate: "2026-09-01", total: null }];
  const report = model.buildSpendingReport9({ launches, provisions }, { year: "2026", month: "9" });
  const [{ paid, forecast, total }] = report.expenseBranches;
  assert.deepEqual({ paid, forecast, total }, { paid: 45, forecast: null, total: null });
  assert.equal(report.incompleteCount, 1);
});

test("total geral soma os centavos apresentados em Pago e Previsto", () => {
  const launches = [row(1, { total: .115 })];
  const provisions = [{ branch: "Filial A", dueDate: "2026-09-01", total: .115 }];
  const report = model.buildSpendingReport9({ launches, provisions }, { year: "2026", month: "9" });
  const [{ paid, forecast, total }] = report.expenseBranches;
  assert.deepEqual({ paid, forecast, total }, { paid: .12, forecast: .12, total: .24 });
});

test("análise da filial usa os centavos de Pago e Previsto do resumo, inclusive ao filtrar", () => {
  const launch = row(1, { total: -.005 });
  const provision = { ...launch, id: 'p1', paymentDate: '', dueDate: '2026-09-01', total: .01 };
  const snapshot = { launches: [launch], provisions: [provision] };
  const scope = { branch: 'Filial A', year: 2026 };
  for (const chartFilter of [undefined, { field: 'month', value: '2026-09' }, { field: 'product', value: 'Cimento' }]) {
    const analysis = model.buildManagementBranchDashboard(snapshot, {}, { ...scope, chartFilter });
    assert.deepEqual([analysis.paid, analysis.forecast, analysis.total], [-.01, .01, 0]);
    assert.deepEqual(analysis.months[8], { period: '2026-09', paid: -.01, forecast: .01, total: 0 });
    assert.deepEqual(analysis.products.map(({ total, percentage }) => [total, percentage]), [[0, 0]]);
  }
});

test("centavos exibidos por produto reconciliam com Pago e Previsto do tipo sem mudar o subtotal", () => {
  const sample = (product, total, id) => row(id, { product, total });
  const launches = [sample("A", .005, 1), sample("B", .005, 2), sample("C", .09, 3)];
  const provisions = ["A", "B"].map(product => ({ branch: "Filial A", product, dueDate: "2026-09-01", total: .105 }));
  const productTypes = ["A", "B", "C"].map(product => ({product, expenseType: "Material"}));
  const report = model.buildSpendingReport9({ launches, provisions, productTypes }, { year: "2026", month: "9" });
  const [{ expenseTypes: [material] }] = report.expenseBranches;
  assert.deepEqual([material.paid, material.forecast, material.total], [.10, .21, .31]);
  for (const field of ["paid", "forecast", "total"]) {
    const cents = value => Math.round(value * 100);
    assert.equal(material.products.reduce((sum, product) => sum + cents(product[field]), 0), cents(material[field]), field);
  }
  assert.equal(Math.round(material.products.reduce((sum, product) => sum + product.percentage, 0)), 100);
});
