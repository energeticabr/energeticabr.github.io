import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createHrPayrollGalleryData, createPaymentProgrammingGalleryData } from '../src/chat/orders-gallery-data.js';

import { createRegistrationGalleryData } from '../src/chat/registration-gallery-data.js';

const key = '2026-11-09-253';
const name = `Holerite-${key}.pdf`;
const token = `folha-semanal-${key}-salary`;
const logo = () => readFile(new URL('../../../assets/logo-energetica-oficial.png', import.meta.url));
const fields = names => names.map(name => ({ name, text: {} }));
const dates = ['DATAPREVISTOPGTO', 'DATAPGTOEFETUADO', 'DATAPGTOAGENDADO', 'DATAEXECUCAOAGENDAMENTO'];

function fixture({ paid = false, mismatch = false } = {}) {
  const row = (id, fields) => ({ id, fields, eTag: '"1"' });
  const records = {
    HOLERITE: { '2': row('2', { CHAVE: key, IDFORNECEDOR: 253, SITUACAO: 'FECHADO', FORNECEDOR: 'Edgar',
      FILIAL: 'Obra', SEMANA_INICIO: '2026-11-09', SEMANA_FIM: '2026-11-15', DATA_PAGAMENTO: '2026-11-13',
      TOTAL: 160, PROVISOES: JSON.stringify([{ rubric: 'salary', id: '463', parentId: '80' }]),
      RUBRICAS: JSON.stringify([{ rubrica: 'salary', quantity: 2, unitValue: 50, formaPgto: 'SICOOB' },
        { rubrica: 'meal', quantity: 2, unitValue: 30, formaPgto: 'SWILE', alreadyPaid: true }]) }) },
    children: {
      '463': row('463', { DESCRITIVOPROVISAO: '80', FOLHAOPERACAO: token, QTD: '2', VALORTOTAL: '50',
        FRETE: '0', TIPOPGTO: 'SALÁRIO', DATAPREVISTOPGTO: '2026-11-13', DATAPGTOEFETUADO: paid ? '2026-11-13' : null }),
      '464': row('464', { DESCRITIVOPROVISAO: '81', FOLHAOPERACAO: '', QTD: '1', VALORTOTAL: '30',
        FRETE: '0', DATAPREVISTOPGTO: '2026-11-13' }),
    },
    parents: {
      '80': row('80', { FOLHAOPERACAO: mismatch ? 'other' : token, VALORTOTAL: '100', DATAPREVISTOPGTO: '2026-11-13' }),
      '81': row('81', { VALORTOTAL: '30', DATAPREVISTOPGTO: '2026-11-13' }),
    },
  };
  const files = new Map([[name, new Blob(['%PDF-'])], ['assinado.pdf', new Blob(['signed'])]]);
  const writes = [];
  const columns = {
    parents: [...fields(['FOLHAOPERACAO', 'VALORTOTAL']), ...[...dates, 'PGTOAGENDADO'].map(name => ({ name, dateTime: {} }))],
    children: [...fields(['FOLHAOPERACAO', 'DESCRITIVOPROVISAO', 'QTD', 'VALORTOTAL', 'FRETE', 'TIPOPGTO', 'PGTOAGENDADO']),
      ...dates.map(name => ({ name, dateTime: {} }))],
  };
  let failList, pause, pauseWrite;
  const repository = {
    async resolveList(_, aliases) {
      if (pause && aliases[0] === 'PROVISÃO PGTOS' && records.HOLERITE['2'].fields.HOLERITE_REVISAO?.includes('pendingAmounts')) {
        const step = pause;
        pause = null;
        step.started();
        await step.wait;
      }
      return { status: 'resolved', id: {
        HOLERITE: 'HOLERITE', DESCRITIVOPROVISAO: 'parents', 'PROVISÃO PGTOS': 'children',
      }[aliases[0]] };
    },
    async getColumns(_, list) { return structuredClone(columns[list]); },
    async getItem(_, list, id) { return structuredClone(records[list][id]); },
    async getItemsPage(_, list, query) {
      const filter = query.match(/fields\/(\w+) eq '([^']+)'/);
      return { items: Object.values(records[list]).filter(row => !filter || row.fields[filter[1]] === filter[2])
        .map(row => structuredClone(row)), hasMore: false };
    },
    async updateItem(_, list, id, patch, { eTag }) {
      if (pauseWrite && list === pauseWrite.list) {
        const step = pauseWrite;
        pauseWrite = null;
        step.started();
        await step.wait;
      }
      if (list === failList) { failList = ''; throw new Error('falha de gravação simulada'); }
      const row = records[list][id];
      assert.equal(eTag, row.eTag);
      writes.push([list, id, Object.keys(patch)]);
      Object.assign(row.fields, patch);
      row.eTag += 'v';
    },
    async listAttachments(_,list,id) { return list === 'HOLERITE' && id === '2' ? [...files.keys()].map(name => ({ name })) : []; },
    async uploadAttachment(_,list,id,file,fileName) {
      assert.equal(list, 'HOLERITE'); assert.equal(id, '2');
      assert.ok(!files.has(fileName));
      files.set(fileName, file);
      records.HOLERITE[id].eTag += 'v';
    },
    async downloadAttachment(_,list,id,fileName) { return files.get(fileName); },
  };
  const gallery = createHrPayrollGalleryData({ repository, loadHoleriteLogo: logo });
  const payment = createPaymentProgrammingGalleryData({ repository, loadHoleriteLogo: logo });
  const description = createRegistrationGalleryData({ kind: 'provisionDescription', repository, loadHoleriteLogo: logo });
  const payslip = { id: '2', pdfFileName: name };
  return { gallery, payment, description, payslip, records, files, writes, failOnce(list) { failList = list; },
    pauseAfterIntent() {
      const { promise: reached, resolve: started } = Promise.withResolvers();
      const { promise: wait, resolve: release } = Promise.withResolvers();
      pause = { started, wait };
      return { reached, release };
    },
    pauseBeforeWrite(list) {
      const { promise: reached, resolve: started } = Promise.withResolvers();
      const { promise: wait, resolve: release } = Promise.withResolvers();
      pauseWrite = { list, started, wait };
      return { reached, release };
    },
    revision: () => JSON.parse(records.HOLERITE['2'].fields.HOLERITE_REVISAO || 'null') };
}

function draft(context, unitValue, quantity = '2') {
  return { supplier: context.supplier, branch: context.branch, date: context.date,
    lines: context.lines.map(line => line.rubrica === 'salary' ? { ...line, quantity, unitValue } : line) };
}

test('provision amount updates only the linked rubric, total and downloadable PDF', async () => {
  const f = fixture();
  await f.payment.saveEditor(await f.payment.loadEditor('463'), { VALORTOTAL: '55' });
  assert.equal(f.records.parents['80'].fields.VALORTOTAL, '110');
  assert.equal(f.revision().total, 170);
  assert.deepEqual(f.revision().lines.map(line => [line.rubrica, line.total]), [['salary', 110], ['meal', 60]]);
  assert.match(f.revision().pdf, /-revisao-.*\.pdf$/);
  const pdf = await f.gallery.downloadPayslip(f.payslip);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(await pdf.arrayBuffer()), useSystemFonts: true });
  try {
    const text = (await (await (await task.promise).getPage(1)).getTextContent()).items.map(item => item.str).join(' ');
    assert.match(text, /110,00.*60,00.*170,00/);
  } finally { await task.destroy(); }
  assert.ok(f.files.has('assinado.pdf') && f.files.has(name));
});

test('description amount synchronizes its single corresponding provision and payslip rubric', async () => {
  const f = fixture();
  await f.description.saveEditor(await f.description.loadEditor('80'), { VALORTOTAL: '126' });
  assert.equal(f.records.children['463'].fields.VALORTOTAL, '63');
  assert.equal(f.revision().total, 186);
  assert.equal(f.records.children['464'].fields.VALORTOTAL, '30');
});

test('amount edited in the payslip updates the linked provision quantity, unit price and description total', async () => {
  const f = fixture();
  const context = await f.gallery.loadPayslipEditor(f.payslip);
  await f.gallery.savePayslipEditor(f.payslip, context, draft(context, '55,25', '3'));
  assert.equal(f.records.children['463'].fields.VALORTOTAL, '55,25');
  assert.equal(f.records.children['463'].fields.QTD, '3');
  assert.equal(f.records.parents['80'].fields.VALORTOTAL, '165,75');
  assert.equal(f.revision().total, 225.75);
  assert.ok(f.writes.every(([list,id]) => list === 'HOLERITE' || id === (list === 'children' ? '463' : '80')));
});

test('an ordinary provision edit does not look up or write a payslip', async () => {
  const f = fixture();
  await f.payment.saveEditor(await f.payment.loadEditor('464'), { VALORTOTAL: '32' });
  assert.equal(f.records.parents['81'].fields.VALORTOTAL, '32');
  assert.equal(f.revision(), null);
});

test('a mismatch is rejected before the financial save', async () => {
  const f = fixture({ mismatch: true });
  await assert.rejects(f.payment.saveEditor(await f.payment.loadEditor('463'), { VALORTOTAL: '55' }), /vínculo|origem/i);
  assert.deepEqual(f.writes, []);
});

test('a paid provision cannot be changed from the payslip', async () => {
  const f = fixture({ paid: true });
  const context = await f.gallery.loadPayslipEditor(f.payslip);
  await assert.rejects(f.gallery.savePayslipEditor(f.payslip, context, draft(context, '74')), /baixad|pag[ao]/i);
  assert.deepEqual(f.writes, []);
});

test('a pending revision resumes after a new session without duplicating the provision write', async () => {
  const f = fixture();
  const context = await f.gallery.loadPayslipEditor(f.payslip);
  f.failOnce('parents');
  await assert.rejects(f.gallery.savePayslipEditor(f.payslip, context, draft(context, '68')), /sincronização|gravação/i);
  assert.equal(f.records.children['463'].fields.VALORTOTAL, '68');
  assert.equal(f.revision().total, 160);
  assert.equal((await f.gallery.loadPayslipEditor(f.payslip)).total, 196);
  assert.equal(f.records.parents['80'].fields.VALORTOTAL, '136');
  assert.equal(f.writes.filter(([list]) => list === 'children').length, 1);
});


test('a change to an already-paid allowance without a provision stays in the payslip', async () => {
  const f = fixture();
  const context = await f.gallery.loadPayslipEditor(f.payslip);
  const lines = context.lines.map(line => line.rubrica === 'meal' ? { ...line, unitValue: '35' } : line);
  await f.gallery.savePayslipEditor(f.payslip, context, { ...draft(context, '50'), lines });
  assert.equal(f.revision().total, 170);
  assert.deepEqual(f.writes.map(([list, id]) => [list, id]), [['HOLERITE','2']]);
});

test('quantity and freight propagate from the provision and keep the same unit price', async () => {
  const f = fixture();
  await f.payment.saveEditor(await f.payment.loadEditor('463'), { QTD: '3', FRETE: '12,50' });
  assert.equal(f.records.parents['80'].fields.VALORTOTAL, '162,5');
  assert.deepEqual(f.revision().lines[0], { rubrica: 'salary', label: 'Salário', quantity: '3', unitValue: '50',
    formaPgto: 'SICOOB', freight: '12.5', total: 162.5 });
  const context = await f.gallery.loadPayslipEditor(f.payslip);
  await f.gallery.savePayslipEditor(f.payslip, context, draft(context, '52', '3'));
  assert.equal(f.records.children['463'].fields.FRETE, '12,5');
  assert.equal(f.records.parents['80'].fields.VALORTOTAL, '168,5');
  assert.equal(f.revision().total, 228.5);
});

test('retiring a rubric with a linked provision is rejected before writing', async () => {
  const f = fixture();
  const context = await f.gallery.loadPayslipEditor(f.payslip);
  await assert.rejects(f.gallery.savePayslipEditor(f.payslip, context,
    { ...draft(context, '50'), lines: context.lines.filter(line => line.rubrica === 'meal') }), /não pode ser retirada/i);
  assert.deepEqual(f.writes, []);
});

test('a concurrent edit to the same provision is never overwritten on retry', async () => {
  const f = fixture();
  const old = await f.payment.loadEditor('463');
  await f.payment.saveEditor(await f.payment.loadEditor('463'), { QTD: '4' });
  await assert.rejects(f.payment.saveEditor(old, { VALORTOTAL: '55' }), /mudaram/i);
  assert.equal(f.records.children['463'].fields.VALORTOTAL, '50');
  assert.equal(f.revision().total, 260);
});


test('an empty freight is treated as zero for linked provisions', async () => {
  const f = fixture();
  f.records.children['463'].fields.FRETE = '';
  await f.payment.saveEditor(await f.payment.loadEditor('463'), { VALORTOTAL: '55' });
  assert.equal(f.revision().total, 170);
  assert.equal(f.records.children['463'].fields.FRETE, '');
});

test('a read-only PDF download leaves an interrupted edit for the editor to resume', async () => {
  const f = fixture();
  const context = await f.gallery.loadPayslipEditor(f.payslip);
  f.failOnce('parents');
  await assert.rejects(f.gallery.savePayslipEditor(f.payslip, context, draft(context, '68')), /pendente/i);
  assert.equal(await (await f.gallery.downloadPayslip(f.payslip)).text(), '%PDF-');
  assert.equal(f.records.parents['80'].fields.VALORTOTAL, '100');
  assert.equal(f.revision().total, 160);
});

test('a payment edit must complete an outstanding amount change first', async () => {
  const f = fixture();
  const context = await f.gallery.loadPayslipEditor(f.payslip);
  f.failOnce('parents');
  await assert.rejects(f.gallery.savePayslipEditor(f.payslip, context, draft(context, '68')), /pendente/i);
  await f.payment.saveEditor(await f.payment.loadEditor('463'), { DATAPGTOEFETUADO: '2026-11-13' });
  assert.equal(f.revision().total, 196);
  assert.equal(f.records.parents['80'].fields.VALORTOTAL, '136');
  assert.equal(f.records.children['463'].fields.DATAPGTOEFETUADO, '2026-11-13');
  const publish = f.writes.findIndex(([list], i) => list === 'HOLERITE' && i > 1);
  const payment = f.writes.findIndex(([list, , names]) => list === 'children' && names.includes('DATAPGTOEFETUADO'));
  assert.ok(publish >= 0 && payment > publish);
});


test('a delayed resume cannot overwrite a newer edit that restored the original amount', async () => {
  const f = fixture();
  const previous = await f.gallery.loadPayslipEditor(f.payslip);
  const pause = f.pauseAfterIntent();
  const first = f.gallery.savePayslipEditor(f.payslip, previous, draft(previous, '55'));
  const settled = assert.rejects(first, /sincronização|mudou|mudaram/i);
  await pause.reached;
  try {
    const resumed = await f.gallery.loadPayslipEditor(f.payslip);
    assert.equal(resumed.total, 170);
    await f.gallery.savePayslipEditor(f.payslip, resumed, draft(resumed, '50'));
  } finally { pause.release(); }
  await settled;
  assert.equal(f.revision().lines[0].unitValue, '50');
  assert.equal(f.records.children['463'].fields.VALORTOTAL, '50');
  assert.equal(f.records.parents['80'].fields.VALORTOTAL, '100');
});


test('the description uses the same cent rounding as the original payslip posting', async () => {
  const f = fixture();
  const context = await f.gallery.loadPayslipEditor(f.payslip);
  await f.gallery.savePayslipEditor(f.payslip, context, draft(context, '1,005', '1'));
  assert.equal(f.records.children['463'].fields.VALORTOTAL, '1,005');
  assert.equal(f.records.parents['80'].fields.VALORTOTAL, '1,01');
  assert.equal(f.revision().lines[0].total, 1.01);
});


test('an unrelated provision cannot be added to a weekly rubric description', async () => {
  const f = fixture();
  const context = await f.payment.loadEditor('464');
  const linkControl = context.columns.find(column => column.name === 'DESCRITIVOPROVISAO');
  assert.ok(!linkControl.choices.includes('80'));
  await assert.rejects(f.payment.saveEditor(context, { DESCRITIVOPROVISAO: '80' }), /opção|reservado/i);
  assert.deepEqual(f.writes, []);
});


test('a payslip edit rejects a financial amount changed outside its open editor', async () => {
  const f = fixture();
  const context = await f.gallery.loadPayslipEditor(f.payslip);
  f.records.children['463'].fields.QTD = '4';
  f.records.children['463'].eTag = '"2"';
  await assert.rejects(f.gallery.savePayslipEditor(f.payslip, context, draft(context, '55')), /mudaram/i);
  assert.deepEqual(f.writes, []);
  assert.equal(f.records.children['463'].fields.QTD, '4');
});


test('the description payment and a simultaneous payslip value edit contend for the same reservation', async () => {
  const f = fixture();
  const editor = await f.gallery.loadPayslipEditor(f.payslip);
  const description = await f.description.loadEditor('80');
  const pause = f.pauseBeforeWrite('parents');
  const payment = f.description.saveEditor(description, { DATAPGTOEFETUADO: '2026-11-13' });
  await pause.reached;
  try {
    await assert.rejects(f.gallery.savePayslipEditor(f.payslip, editor, draft(editor, '68')), /em andamento/i);
    assert.equal(f.records.children['463'].fields.VALORTOTAL, '50');
  } finally { pause.release(); }
  await payment;
  assert.equal(f.records.children['463'].fields.DATAPGTOEFETUADO, '2026-11-13');
  assert.equal(f.records.parents['80'].fields.VALORTOTAL, '100');
  assert.equal(f.revision(), null);
});

test('an interrupted non-amount save releases its expired reservation when an editor reopens', async () => {
  const f = fixture();
  f.records.HOLERITE['2'].fields.HOLERITE_REVISAO = JSON.stringify({
    financeLock: { id: 'expired', previous: null, expires: Date.now() - 1 },
  });
  const reopened = await f.gallery.loadPayslipEditor(f.payslip);
  assert.equal(reopened.total, 160);
  assert.equal(f.revision(), null);
});
