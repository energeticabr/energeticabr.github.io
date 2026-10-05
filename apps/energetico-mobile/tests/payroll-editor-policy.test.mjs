import test from 'node:test';
import assert from 'node:assert/strict';
import { createHrPayrollGalleryData } from '../src/chat/orders-gallery-data.js';
import { createPayrollLaunchReader } from '../src/chat/payroll-launch-options.js';

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
  const launches=[
    {id:'3457',fields:{FORNECEDOR:'CLEITON',EMPREITEIRO:'SIM'}},
    {id:'3460',fields:{FORNECEDOR:'OUTRO EMPREITEIRO',EMPREITEIRO:true}},
    {id:'3461',fields:{FORNECEDOR:'NÃO EMPREITEIRO',EMPREITEIRO:'NÃO'}},
    {id:'3462',fields:{FORNECEDOR:'SEM MARCAÇÃO'}},
  ];
  const repository = {
    async resolveList(_site, names) { return { status: 'resolved', id: names[0] }; },
    async getColumns(_site, list) { return list === 'LANCAMENTOS' ? [
      { name: 'VALOR_x0020_UNIT_x00c1_RIO', displayName: 'VALOR UNITÁRIO', number: {} },
      { name: 'QUANTIDADE', number: {} },
      { name: 'FORNECEDOR', text: {} }, { name: 'EMPREITEIRO', choice:{choices:['SIM','NÃO']} },
    ] : list==='IDFOLHA' ? [{name:'MESREFERENCIA',text:{}},{name:'FORNECEDOR',text:{}}]:columns; },
    async getItem(_site, list, id) { return list==='IDFOLHA'? sheets.find(row=>row.id===id):list==='LANCAMENTOS'?{id,eTag:'"v1"',fields:{...launches.find(row=>row.id===id)?.fields,VALOR_x0020_UNIT_x00c1_RIO: amount,QUANTIDADE:quantity}}:{id,eTag:'"v1"',fields}; },
    async getItemsPage(_site,list,_query,options) { const rows=list==='LANCAMENTOS'?launches:sheets;return ['IDFOLHA','LANCAMENTOS'].includes(list)?{items:options.cursor?rows.slice(2):rows.slice(0,2),hasMore:!options.cursor,...(!options.cursor?{nextLink:'next'}:{})}:{ items: [{ id: '3', eTag: '"v1"', fields }], hasMore: false }; },
    async searchPowerAppsOptions() { return [{ value: 'CLEITON', label: 'CLEITON' }]; },
    async updateItem(_site, _list, _id, values) { writes.push(values); return { id: '3', fields: values }; },
  };
  return { repository, data: createHrPayrollGalleryData({ repository,now:()=>new Date('2026-10-05T12:00:00Z') }), writes, changeContractor:()=>{launches[1].fields.EMPREITEIRO='NÃO';},changeSheet:()=>{sheets[1].fields.FORNECEDOR='OUTRO';}, change: () => { amount = 300; quantity = 5; } };
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

test('payroll launch select shows ID - supplier only for contractor launches across all pages',async()=>{
  const {data}=fixture(),context=await data.loadEditor('FOLHAPGTO','3'),column=context.columns.find(c=>c.name==='IDLANCAMENTO');
  assert.equal(column.control,'select');
  assert.deepEqual(column.choices,['3460','3457']);
  assert.deepEqual(column.optionLabels,{'3457':'3457 - CLEITON','3460':'3460 - OUTRO EMPREITEIRO'});
  assert.equal(column.powerApps.preserveCurrentValue,false);
});

test('payroll launch selection posts only a numeric ID and rejects labels, non-contractors and invented IDs',async()=>{
  const {data,writes}=fixture(),context=await data.loadEditor('FOLHAPGTO','3');
  for(const IDLANCAMENTO of ['3460 - OUTRO EMPREITEIRO','3461','3462','999',''])await assert.rejects(data.saveEditor(context,{IDLANCAMENTO}),/lançamento|vínculo|ID|opção/i);
  assert.deepEqual(writes,[]);
  await data.saveEditor(context,{IDLANCAMENTO:'3460'});
  assert.deepEqual(writes,[{IDLANCAMENTO:3460}]);
});

test('payroll rechecks EMPREITEIRO before accepting a formerly valid launch selection',async()=>{
  const {data,writes,changeContractor}=fixture(),context=await data.loadEditor('FOLHAPGTO','3');changeContractor();
  await assert.rejects(data.saveEditor(context,{IDLANCAMENTO:'3460'}),/empreiteiro|lançamento/i);
  assert.deepEqual(writes,[]);
});

test('payroll launch dropdown reads contractor eligibility from FORNECEDORES when launches have no contractor column',async()=>{
  const suppliers=[{id:'1',fields:{CADASTRO:'CLEITON',EMPREITEIRO:'SIM',STATUS:'ATIVO'}},{id:'2',fields:{CADASTRO:'INATIVO',EMPREITEIRO:'SIM',STATUS:'INATIVO'}},{id:'3',fields:{CADASTRO:'NÃO EMPREITEIRO',EMPREITEIRO:'NÃO',STATUS:'ATIVO'}}];
  const launches=['CLEITON','INATIVO','NÃO EMPREITEIRO'].map((FORNECEDOR,i)=>({id:String(10+i),fields:{field_5:FORNECEDOR}}));
  const repository={
    async resolveList(_site,names){return {status:'resolved',id:names[0]};},
    async getColumns(_site,list){return list==='LANCAMENTOS'?[{name:'field_5',displayName:'FORNECEDOR'}]:['CADASTRO','EMPREITEIRO','STATUS'].map(name=>({name}));},
    async getItemsPage(_site,list,_query,options){const rows=list==='LANCAMENTOS'?launches:suppliers;return {items:options.cursor?rows.slice(1):rows.slice(0,1),hasMore:!options.cursor,...(!options.cursor?{nextLink:'next'}:{})};},
    async getItem(_site,_list,id){return launches.find(row=>row.id===id);},
  };
  const reader=createPayrollLaunchReader(repository,'personal');
  assert.deepEqual(await reader.options(),[{value:'10',label:'10 - CLEITON'}]);
  await reader.assertLaunch('10');
  await assert.rejects(reader.assertLaunch('11'),/empreiteiro|lançamento/i);
  suppliers[0].fields.STATUS='INATIVO';
  await assert.rejects(reader.assertLaunch('10'),/empreiteiro|lançamento/i);
  suppliers[0].fields.STATUS='ATIVO';
  suppliers.push({id:'4',fields:{...suppliers[0].fields}});
  assert.deepEqual(await reader.options(),[]);
  await assert.rejects(reader.assertLaunch('10'),/empreiteiro|lançamento/i);
  const complete=repository.getItemsPage;
  repository.getItemsPage=async(...args)=>args[1]==='FORNECEDORES'?{items:[suppliers[0]],hasMore:true}:complete(...args);
  await assert.rejects(reader.options(),/consulta/i);
});

test('payroll launch options fail closed when contractor metadata or pagination is incomplete',async()=>{
  for(const failure of ['metadata','pagination']){
    const {data,repository}=fixture();
    if(failure==='metadata'){const original=repository.getColumns;repository.getColumns=async(site,list)=>(await original(site,list)).filter(c=>list!=='LANCAMENTOS'||c.name!=='EMPREITEIRO');}
    else{const original=repository.getItemsPage;repository.getItemsPage=async(...args)=>args[1]==='LANCAMENTOS'?{items:[],hasMore:true}:original(...args);}
    await assert.rejects(data.loadEditor('FOLHAPGTO','3'),/empreiteiro|lançamentos|consulta/i);
  }
});
