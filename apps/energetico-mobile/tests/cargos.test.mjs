import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCargosTable, parseCargosMoney } from '../src/chat/cargos-model.js';
import { createCargosData } from '../src/chat/cargos-data.js';
import { createCargosView } from '../src/ui/cargos-view.js';
import { JSDOM } from 'jsdom';

const columns=['CARGO','SALARIO','VALEALIMENTACAO','PREMIO','DATAREFERENCIA'].map(name=>({name,displayName:name})).concat({name:'vt_real',displayName:'VALE TRANSPORTE'});
const item=(cargo,fields={})=>({fields:{CARGO:cargo,SALARIO:1800,VALEALIMENTACAO:800,PREMIO:445,vt_real:238.33,DATAREFERENCIA:'2026-09-01T00:00:00Z',...fields}});
test('moeda da base aceita números e formato brasileiro sem inventar valores',()=>{
  assert.equal(parseCargosMoney('2.625,00'),2625);
  assert.equal(parseCargosMoney('238,33'),238.33);
  for(const v of ['',null,'abc 20','12abc',Infinity,-5])assert.equal(parseCargosMoney(v),null);
});
test('sete níveis ordenados, total exato, referência vigente e conflito explícito',()=>{
  const rows=buildCargosTable([item('SERVENTE DE PEDREIRO I'),item('PEDREIRO I',{SALARIO:2625,PREMIO:800}),item('SERVENTE DE PEDREIRO I',{SALARIO:9999,DATAREFERENCIA:'2026-11-01'})],columns,'2026-10-05');
  assert.equal(rows.length,7);assert.equal(rows[0].total,3283.33);assert.equal(rows[3].total,4463.33);
  assert.equal(rows[6].cargo,'MESTRE DE OBRAS');assert.equal(rows[6].total,null);
  assert.equal(buildCargosTable([item('PEDREIRO I'),item('PEDREIRO I',{PREMIO:100})],columns,'2026-10-05')[3].total,null);
  assert.equal(buildCargosTable([item('PEDREIRO I',{vt_real:''})],columns,'2026-10-05')[3].total,null);
});
test('leitor usa metadados reais, todas as páginas e recusa paginação quebrada',async()=>{
  let calls=0;
  const repository={resolveList:async(site,names)=>{assert.equal(site,'personal');assert.deepEqual(names,['CARGOS']);return {status:'resolved',id:'cargos'};},getColumns:async()=>columns,getItemsPage:async()=>++calls===1?{items:[item('PEDREIRO I')],hasMore:true,nextLink:'page2'}:{items:[item('MESTRE DE OBRAS')],hasMore:false}};
  const data=createCargosData({repository,now:()=>new Date('2026-10-05T12:00:00Z')});
  assert.equal((await data.loadSnapshot()).rows[6].total,3283.33);assert.equal(calls,2);
  repository.getItemsPage=async()=>({items:[],hasMore:true,nextLink:'repeated'});
  await assert.rejects(data.loadSnapshot(),/paginação/i);
  repository.getItemsPage=async()=>({items:[],hasMore:false});
  repository.getColumns=async()=>columns.filter(c=>c.name!=='vt_real');
  await assert.rejects(data.loadSnapshot(),/VALE TRANSPORTE/);
});
test('tela inteira com grupos, atualização e cancelamento não reapresenta consulta antiga',async()=>{
  const dom=new JSDOM('<main id="app"><button id="start">Abrir</button></main>');const doc=dom.window.document;
  let loads=0,finish;const view=createCargosView({document:doc,data:{loadSnapshot:async()=>{loads++;return {rows:buildCargosTable([item('SERVENTE DE PEDREIRO I')],columns,'2026-10-05')};}}});
  doc.querySelector('#start').focus();await view.open();
  assert.equal(doc.querySelectorAll('.cargos-table tbody tr[data-cargo]').length,7);
  assert.equal(doc.querySelectorAll('.cargos-group').length,2);
  assert.match(doc.querySelector('[data-column="total"]').textContent,/3.283,33/);
  doc.querySelector('[aria-label="Atualizar tabela de cargos"]').click();await new Promise(r=>setImmediate(r));assert.equal(loads,2);
  view.close();assert.equal(doc.activeElement.id,'start');
  view.destroy();
  const late=createCargosView({document:doc,data:{loadSnapshot:()=>new Promise(r=>{finish=r;})}});
  const pending=late.open();late.close();finish({rows:[]});await pending;
  assert.equal(doc.querySelector('.cargos-screen').hidden,true);assert.equal(doc.querySelectorAll('.cargos-table').length,0);
  late.destroy();dom.window.close();
});
