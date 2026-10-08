import test from 'node:test';
import assert from 'node:assert/strict';
import { createPayrollPaymentData } from '../src/chat/payroll-payment-data.js';

function fixture(now = () => new Date('2026-10-05T12:00:00Z')) {
  const columns = Object.fromEntries(Object.entries({
    FORNECEDORES:['CADASTRO','EMPREITEIRO','STATUS','PROFISSÃO'],
    LANCAMENTOS:['FORNECEDOR','VALOR UNITÁRIO','QUANTIDADE','DATA','PRODUTO','FRETE','DATA PGTO EFETUADO','VALORTOTAL'],
    IDFOLHA:['FORNECEDOR','MESREFERENCIA'],
    FOLHAPGTO:['Title','FORNECEDOR','TIPOPGTO','VALORUNITARIO','QTD','DATA','IDFOLHA','IDLANCAMENTO'],
  }).map(([list,names])=>[list,names.map(name=>({name,displayName:name,...(name==='TIPOPGTO'?{choice:{choices:['SALÁRIO','AJUDA DE CUSTO']}}:{})}))]));
  const item=(id,fields)=>({id:String(id),fields});
  const rows={
    FORNECEDORES:[item(1,{CADASTRO:'CLEITON',EMPREITEIRO:'SIM',STATUS:'ATIVO'}),item(2,{CADASTRO:'OUTRO',EMPREITEIRO:'SIM',STATUS:'ATIVO'}),item(3,{CADASTRO:'INATIVO',EMPREITEIRO:'SIM',STATUS:'INATIVO'}),item(4,{CADASTRO:'LOJA',EMPREITEIRO:'NÃO',STATUS:'ATIVO'})],
    LANCAMENTOS:[item(10,{FORNECEDOR:'CLEITON','VALOR UNITÁRIO':168.8,QUANTIDADE:3,DATA:'2026-10-04',PRODUTO:'MÃO DE OBRA'}),item(11,{FORNECEDOR:'INATIVO'}),item(12,{FORNECEDOR:'LOJA'})],
    IDFOLHA:[item(20,{FORNECEDOR:'CLEITON',MESREFERENCIA:'09/2026'}),item(21,{FORNECEDOR:'CLEITON',MESREFERENCIA:'10/2026'}),item(22,{FORNECEDOR:'CLEITON',MESREFERENCIA:'11/2026'}),item(23,{FORNECEDOR:'CLEITON',MESREFERENCIA:'08/2026'}),item(24,{FORNECEDOR:'OUTRO',MESREFERENCIA:'10/2026'})],FOLHAPGTO:[],
  };
  const writes=[];
  const repository={
    async resolveList(_site,[name]) {return {id:name,status:'resolved'};},
    async getColumns(_site,list) {return columns[list];},
    async getItemsPage(_site,list) {return {items:rows[list],hasMore:false};},
    async getItem(_site,list,id) {return rows[list].find(row=>row.id===String(id));},
    async createItem(_site,list,fields) {writes.push({list,fields});const row=item(100+writes.length,fields);rows[list].push(row);return row;},
  };
  return {rows,writes,repository,data:createPayrollPaymentData({repository,now})};
}
const draft={launchId:'10',sheetId:'21',paymentType:'SALÁRIO'};
const operation={operationId:'payment-test-1'};

test('launch options expose profession, exact unit times quantity plus freight and paid date without writes',async()=>{
  const f=fixture();
  f.rows.FORNECEDORES[0].fields['PROFISSÃO']='PEDREIRO';
  Object.assign(f.rows.LANCAMENTOS[0].fields,{FRETE:'12,50','DATA PGTO EFETUADO':'2026-10-06T00:00:00Z',VALORTOTAL:9999});
  const [launch]= (await f.data.loadOptions()).launches;
  assert.equal(launch.description,'PEDREIRO');
  assert.equal(launch.total,518.9);
  assert.equal(launch.paidDate,'2026-10-06');
  assert.equal(launch.date,'2026-10-04');
  assert.equal(f.writes.length,0);
});

test('launch totals preserve decimal rounding and do not invent invalid money or paid dates',async()=>{
  const f=fixture(),fields=f.rows.LANCAMENTOS[0].fields;
  Object.assign(fields,{'VALOR UNITÁRIO':'1.234,565',QUANTIDADE:'2',FRETE:'0,01','DATA PGTO EFETUADO':'2026-02-30'});
  assert.equal((await f.data.loadOptions()).launches[0].total,2469.14);
  assert.equal((await f.data.loadOptions()).launches[0].paidDate,'');
  fields['VALOR UNITÁRIO']='inválido';
  assert.equal((await f.data.loadOptions()).launches[0].total,null);
  fields['VALOR UNITÁRIO']=0; fields.FRETE='';
  assert.equal((await f.data.loadOptions()).launches[0].total,0);
  assert.equal((await f.data.loadOptions()).launches[0].description,'');
});

test('paid date resolves encoded SharePoint names by display name instead of the unrelated DATA field',async()=>{
  const f=fixture(),getColumns=f.repository.getColumns;
  f.repository.getColumns=async(...args)=>(await getColumns(...args)).map(c=>c.name==='DATA PGTO EFETUADO'?{...c,name:'field_15'}:c);
  f.rows.LANCAMENTOS[0].fields.field_15='2026-10-07';
  assert.equal((await f.data.loadOptions()).launches[0].paidDate,'2026-10-07');
});

test('only active contractor launches and supplier sheets in previous/current/next months are offered',async()=>{
  const f=fixture(),options=await f.data.loadOptions();
  assert.deepEqual(options.launches.map(row=>row.id),['10']);
  assert.deepEqual(options.paymentTypes,['SALÁRIO','AJUDA DE CUSTO']);
  assert.deepEqual(options.sheets.filter(row=>row.supplier==='CLEITON').map(row=>row.id),['20','21','22']);
  assert.equal(f.writes.length,0);
});
test('save rechecks source and writes a payroll record with fresh amounts and selected links',async()=>{
  const f=fixture();await f.data.loadOptions();
  f.rows.LANCAMENTOS[0].fields['VALOR UNITÁRIO']=200;
  const saved=await f.data.save(draft,operation);
  assert.equal(saved.id,'101');
  assert.deepEqual(f.writes[0],{list:'FOLHAPGTO',fields:{Title:'APP-folha-vinculo-payment-test-1',FORNECEDOR:'CLEITON',TIPOPGTO:'SALÁRIO',VALORUNITARIO:200,QTD:3,DATA:'2026-10-04',IDFOLHA:21,IDLANCAMENTO:10}});
});
test('arbitrary types, another supplier sheet, old months and inactive contractor are rejected before writes',async()=>{
  const f=fixture();
  for(const invalid of [{...draft,paymentType:'DIGITADO'},{...draft,sheetId:'24'},{...draft,sheetId:'23'},{...draft,launchId:'11'}]) await assert.rejects(f.data.save(invalid,operation));
  f.rows.FORNECEDORES[0].fields.STATUS='INATIVO';
  await assert.rejects(f.data.save(draft,operation),/ativo|empreiteiro/i);
  assert.equal(f.writes.length,0);
});
test('retry after lost creation response recovers the same verified payroll record',async()=>{
  const f=fixture(),create=f.repository.createItem;let lost=true;
  f.repository.createItem=async(...args)=>{const row=await create(...args);if(lost){lost=false;throw new Error('response lost');}return row;};
  await assert.rejects(f.data.save(draft,operation),/response lost/);
  assert.equal((await f.data.save(draft,operation)).id,'101');
  assert.equal(f.writes.length,1);
  await assert.rejects(f.data.save({...draft,paymentType:'AJUDA DE CUSTO'},operation),/operação|operacao|alterad/i);
});
test('month window uses Sao Paulo and crosses year boundaries',async()=>{
  const f=fixture(()=>new Date('2027-01-01T01:00:00Z'));
  f.rows.IDFOLHA=[{id:'30',fields:{FORNECEDOR:'CLEITON',MESREFERENCIA:'11/2026'}},{id:'31',fields:{FORNECEDOR:'CLEITON',MESREFERENCIA:'12/2026'}},{id:'32',fields:{FORNECEDOR:'CLEITON',MESREFERENCIA:'01/2027'}},{id:'33',fields:{FORNECEDOR:'CLEITON',MESREFERENCIA:'02/2027'}}];
  assert.deepEqual((await f.data.loadOptions()).sheets.map(row=>row.id),['30','31','32']);
});
test('source supplier changed during preflight never produces a mixed payroll link',async()=>{
  const f=fixture(),get=f.repository.getItem;let reads=0;
  f.repository.getItem=async(...args)=>{if(args[1]==='LANCAMENTOS'&&++reads===2)f.rows.LANCAMENTOS[0].fields={...f.rows.LANCAMENTOS[0].fields,FORNECEDOR:'OUTRO','VALOR UNITÁRIO':999};return get(...args);};
  await assert.rejects(f.data.save(draft,operation),/alterad|revise/i);assert.equal(f.writes.length,0);
});
test('existing lost-response payment recovers even after amount, contractor status and month change',async()=>{
  let current=new Date('2026-10-05T12:00:00Z');const f=fixture(()=>current),create=f.repository.createItem;let lost=true;
  f.repository.createItem=async(...args)=>{const row=await create(...args);if(lost){lost=false;throw new Error('response lost');}return row;};
  await assert.rejects(f.data.save(draft,operation));
  f.rows.LANCAMENTOS[0].fields['VALOR UNITÁRIO']=250;f.rows.FORNECEDORES[0].fields.STATUS='INATIVO';current=new Date('2027-01-05T12:00:00Z');
  const recovered=await f.data.save(draft,operation);assert.equal(recovered.id,'101');assert.equal(recovered.fields.VALORUNITARIO,168.8);assert.equal(f.writes.length,1);
});
