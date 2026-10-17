import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createPayrollBreakdownData } from '../src/chat/payroll-breakdown-data.js';
import { createHrPayrollGalleryData } from '../src/chat/orders-gallery-data.js';
import { createSupplierPayrollReportData } from '../src/chat/supplier-payroll-report-data.js';
import { summarizePayrollPayments } from '../src/chat/supplier-payroll-report-model.js';
import { createHrPayrollReport } from '../src/ui/hr-payroll-report-view.js';

function fixture() {
  const provision = { id: '41', fields: { IDFOLHA: '19', FORNECEDOR: 'Ana', TIPOPGTO: 'SALÁRIO', QTD: '2', VALORTOTAL: '100', FRETE: '10', PGTOAGENDADO: 'PENDENTE', DATAPGTOEFETUADO: null, DATAPREVISTOPGTO: '2026-10-09' } };
  const payments = [
    { id: '51', fields: { Title: 'APP-folha-provisao-41', IDFOLHA: 19, FORNECEDOR: 'Ana', TIPOPGTO: 'SALÁRIO', VALORUNITARIO: 100, QTD: 2, DATA: '2026-10-09', IDLANCAMENTO: null } },
    { id: '52', fields: { Title: 'legacy', IDFOLHA: 19, FORNECEDOR: 'Ana', TIPOPGTO: 'SALÁRIO', VALORUNITARIO: 999, QTD: 999, DATA: '2026-11-01', IDLANCAMENTO: '71' } },
  ];
  const rows = { IDFOLHA: [{ id: '19', fields: { FORNECEDOR: 'Ana', MESREFERENCIA: '10/2026' } }], FOLHAPGTO: payments,
    FORNECEDORES: [{ id: '1', fields: { CADASTRO: 'Ana', PROFISSAO: 'PEDREIRO', STATUS: 'ATIVO', EMPREITEIRO: 'SIM', FILIAL: 'OBRA A' } }],
    'PROVISÃO PGTOS': [provision], LANCAMENTOS: [{ id: '71', fields: { VALORUNITARIO: 25, QTD: 2 } }] };
  const repository = {
    resolveList: async (_site, names) => ({ status: 'resolved', id: names[0] }),
    getColumns: async (_site, list) => Object.keys(rows[list][0].fields).map(name => ({ name, displayName: name, text: {} })),
    getItems: async (_site, list) => structuredClone(rows[list]),
    getItemsPage: async (_site, list) => ({ items: structuredClone(rows[list]), hasMore: false, batchCount: rows[list].length }),
    getItem: async (_site, list, id) => structuredClone(rows[list].find(row => row.id === id)),
  };
  return { repository, rows, provision, payments };
}

test('PAGO usa folha de referência, valores atuais e baixa confirmada, mesmo com pagamento em outro mês', async () => {
  const f = fixture(), data = createPayrollBreakdownData({ repository: f.repository });
  const context = await data.loadPayrollContext({ id: '1', label: 'Ana' }, '2026-10');
  assert.equal(context.sheetId, '19'); assert.equal(context.paid.salary, 50); assert.equal(context.paidTotal, 50);
  f.provision.fields.DATAPGTOEFETUADO = '2026-11-03';
  const paid = await data.loadPayrollContext({ id: '1', label: 'Ana' }, '2026-10');
  assert.equal(paid.paid.salary, 260); assert.equal(paid.paidTotal, 260);
});

test('PAGO preserva ajustes negativos válidos dos lançamentos existentes', async () => {
  const f=fixture();f.rows.LANCAMENTOS[0].fields.VALORUNITARIO=-25;
  const data=createPayrollBreakdownData({repository:f.repository});
  assert.equal((await data.loadPayrollContext({id:'1',label:'Ana'},'2026-10')).paidTotal,-50);
});

test('galeria e relatório da folha preservam a identidade pendente e apuram após a baixa', async () => {
  const f = fixture(), data = createHrPayrollGalleryData({ repository: f.repository });
  let result = await data.loadPage('FOLHAPGTO');
  assert.equal(result.rows[0].id, '51'); assert.equal(result.rows[0].PGTOAGENDADO, 'PENDENTE');
  let report = await data.loadPaymentsForPayrollId('19');
  assert.equal(report[0].PGTOAGENDADO, 'PENDENTE');
  f.provision.fields.DATAPGTOEFETUADO = '2026-10-12';
  result = await data.loadPage('FOLHAPGTO'); assert.equal(result.rows[0].id, '51'); assert.equal(result.rows[0].PGTOAGENDADO, 'PAGO');
  report = await data.loadPaymentsForPayrollId('19'); assert.equal(report[0].PGTOAGENDADO, 'PAGO');
});

test('relatório por fornecedor exibe pendência e exclui esse valor do total pago', async () => {
  const f = fixture(), data = createSupplierPayrollReportData({ repository: f.repository });
  await data.loadSnapshot(); let rows = await data.loadPaymentsForPayrollIds(['19']);
  assert.equal(rows[0].paymentStatus, 'PENDENTE'); assert.equal(rows[0].totalCents, 21000);
  assert.equal(summarizePayrollPayments(rows).totalCents, 5000);
  f.provision.fields.DATAPGTOEFETUADO = '2026-10-12';
  rows = await data.loadPaymentsForPayrollIds(['19']);
  assert.equal(rows[0].id, '51'); assert.equal(rows[0].paymentStatus, 'PAGO');
  assert.equal(summarizePayrollPayments(rows).totalCents, 26000);
});

test('relatório IDFOLHA mostra valor pendente sem somar em dinheiro nem no total', async t => {
  const dom = new JSDOM('<main></main>'); t.after(() => dom.window.close());
  const report = createHrPayrollReport({ root: dom.window.document.querySelector('main'), request: async () => [
    { id: '1', TIPOPGTO: 'SALÁRIO', VALORUNITARIO: 100, QTD: 2, PGTOAGENDADO: 'PENDENTE', TOTALCENTAVOS: 21000 },
    { id: '2', TIPOPGTO: 'SALÁRIO', VALORUNITARIO: 25, QTD: 2 },
  ] }); t.after(() => report.destroy());
  await report.open({ id: '19', FORNECEDOR: 'Ana', MESREFERENCIA: '10/2026' });
  const doc = dom.window.document;
  assert.equal(doc.querySelector('[data-report-total="overall"]').textContent.replace(/\s+/g,' '), 'R$ 50,00');
  assert.equal(doc.querySelector('[data-report-total="cash"]').textContent.replace(/\s+/g,' '), 'R$ 50,00');
  assert.match(doc.querySelector('.hr-payroll-payment-card').textContent, /PENDENTE/);
  assert.match(doc.querySelector('[data-report-line-total="1"]').textContent, /210,00/);
});

test('pagamento de provisão não pode ser convertido manualmente em outro pagamento no editor', async () => {
  const f = fixture(), get = f.repository.getItem;
  f.repository.getItem = async (...args) => ({ ...await get(...args), eTag: '"1"' });
  const data = createHrPayrollGalleryData({ repository: f.repository });
  const context = await data.loadEditor('FOLHAPGTO','51');
  assert.ok(context.columns.every(column => column.readOnly));
  await assert.rejects(data.saveEditor(context, { TIPOPGTO: 'VALE TRANSPORTE' }), /provisão|editável/i);
});
