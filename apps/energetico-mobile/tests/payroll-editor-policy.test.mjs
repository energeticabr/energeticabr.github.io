import test from 'node:test';
import assert from 'node:assert/strict';
import { createHrPayrollGalleryData } from '../src/chat/orders-gallery-data.js';

function fixture() {
  let amount = 200, quantity = 4;
  const writes = [];
  const columns = [
    { name: 'Title', text: {} }, { name: 'FORNECEDOR', text: {} },
    { name: 'TIPOPGTO', text: {} }, { name: 'VALORUNITARIO', number: {} },
    { name: 'QTD', number: {} }, { name: 'IDLANCAMENTO', number: {} },
    { name: 'IDFOLHA', number: {} },
    { name: 'DATA', dateTime: { format: 'dateOnly' } },
  ];
  const fields = { Title: 'interno', FORNECEDOR: 'CLEITON', TIPOPGTO: 'SALÁRIO', VALORUNITARIO: 168.8, QTD: 3, IDLANCAMENTO: 3457, IDFOLHA:5, DATA: '2026-09-28' };
  const sheets=[['5','09/2026','CLEITON'],['15','10/2026','CLEITON'],['25','11/2026','CLEITON'],['35','08/2026','CLEITON'],['45','12/2026','CLEITON'],['55','10/2026','OUTRO']].map(([id,MESREFERENCIA,FORNECEDOR])=>({id,fields:{MESREFERENCIA,FORNECEDOR}}));
  const repository = {
    async resolveList(_site, names) { return { status: 'resolved', id: names[0] }; },
    async getColumns(_site, list) { return list === 'LANCAMENTOS' ? [
      { name: 'VALOR_x0020_UNIT_x00c1_RIO', displayName: 'VALOR UNITÁRIO', number: {} },
      { name: 'QUANTIDADE', number: {} },
    ] : list==='IDFOLHA' ? [{name:'MESREFERENCIA',text:{}},{name:'FORNECEDOR',text:{}}]:columns; },
    async getItem(_site, list, id) { return list==='IDFOLHA'? sheets.find(row=>row.id===id):{ id, eTag: '"v1"', fields: list === 'LANCAMENTOS' ? { VALOR_x0020_UNIT_x00c1_RIO: amount, QUANTIDADE: quantity } : fields }; },
    async getItemsPage(_site,list,_query,options) { return list==='IDFOLHA' ? {items:options.cursor?sheets.slice(2):sheets.slice(0,2),hasMore:!options.cursor,...(!options.cursor?{nextLink:'next'}:{})}:{ items: [{ id: '3', eTag: '"v1"', fields }], hasMore: false }; },
    async searchPowerAppsOptions() { return [{ value: 'CLEITON', label: 'CLEITON' }]; },
    async updateItem(_site, _list, _id, values) { writes.push(values); return { id: '3', fields: values }; },
  };
  return { data: createHrPayrollGalleryData({ repository,now:()=>new Date('2026-10-05T12:00:00Z') }), writes, changeSheet:()=>{sheets[1].fields.FORNECEDOR='OUTRO';}, change: () => { amount = 300; quantity = 5; } };
}

test('payroll editor hides title, locks source values and restricts supplier and payment type', async () => {
  const { data, writes } = fixture();
  const context = await data.loadEditor('FOLHAPGTO', '3');
  assert.equal(context.columns.some(c => c.name === 'Title'), false);
  for (const name of ['VALORUNITARIO', 'QTD']) assert.equal(context.columns.find(c => c.name === name).readOnly, true);
  assert.equal(context.columns.find(c=>c.name==='FORNECEDOR').readOnly,true);
  assert.equal(context.columns.find(c=>c.name==='FORNECEDOR').disabled,true);
  assert.equal(context.columns.find(c=>c.name==='TIPOPGTO').control,'select');
  assert.deepEqual(context.columns.slice(0,6).map(c=>c.name),['DATA','IDFOLHA','FORNECEDOR','IDLANCAMENTO','VALORUNITARIO','QTD']);
  const sheet=context.columns.find(c=>c.name==='IDFOLHA');assert.equal(sheet.control,'select');assert.deepEqual(sheet.choices,['5','15','25']);assert.equal(sheet.optionLabels['5'],'5-09/2026 (CLEITON)');
  assert.equal(context.item.fields.VALORUNITARIO, 200);
  assert.equal(context.item.fields.QTD, 4);
  for (const fields of [{ VALORUNITARIO: 1 }, { QTD: 99 }, { Title: 'x' }, { FORNECEDOR: 'INVENTADO' }, { TIPOPGTO: 'INVENTADO' }]) {
    await assert.rejects(data.saveEditor(context, fields), /editável|opção/i);
  }
  await data.saveEditor(context, { TIPOPGTO: 'VALE TRANSPORTE' });
  assert.deepEqual(writes, [{ TIPOPGTO: 'VALE TRANSPORTE' }]);
});

test('payroll sheet dropdown saves only the ID and rejects another supplier or month even when bypassed',async()=>{
  const {data,writes}=fixture(),context=await data.loadEditor('FOLHAPGTO','3');
  for(const IDFOLHA of ['55','35','45','999','15-10/2026 (CLEITON)']) await assert.rejects(data.saveEditor(context,{IDFOLHA}),/folha|ID/i);
  assert.deepEqual(writes,[]);await data.saveEditor(context,{IDFOLHA:'15'});assert.deepEqual(writes,[{IDFOLHA:15}]);
});
test('payroll sheet validation rereads supplier before saving a formerly valid option',async()=>{
  const {data,writes,changeSheet}=fixture(),context=await data.loadEditor('FOLHAPGTO','3');changeSheet();
  await assert.rejects(data.saveEditor(context,{IDFOLHA:'15'}),/folha|fornecedor/i);assert.deepEqual(writes,[]);
});

test('payroll gallery and open editor refresh derived values after source changes', async () => {
  const { data, change } = fixture();
  const context = await data.loadEditor('FOLHAPGTO', '3');
  const first = await data.loadPage('FOLHAPGTO');
  assert.equal(first.rows[0].VALORUNITARIO, 200);
  change();
  const next = await data.loadPage('FOLHAPGTO');
  assert.equal(next.rows[0].VALORUNITARIO, 300);
  assert.equal(next.rows[0].QTD, 5);
  assert.deepEqual(await context.refreshDerivedValues(), { VALORUNITARIO: 300, QTD: 5 });
  await data.saveEditor(context, { DATA: '2026-09-29' });
});

test('payroll save rejects invalid linked launch IDs even if submission bypasses the button', async () => {
  const { data, writes } = fixture();
  const context = await data.loadEditor('FOLHAPGTO', '3');
  await assert.rejects(data.saveEditor(context, { IDLANCAMENTO: -1 }), /vínculo.*inválido/i);
  assert.deepEqual(writes, []);
});
