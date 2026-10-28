import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {normalizeDdaReportRows,buildDdaReport} from '../src/chat/dda-report-model.js';
import {createDdaReportView} from '../src/ui/dda-report-view.js';
import {captureFilteredReport} from '../src/ui/report-print.js';

const now=()=>new Date('2026-10-28T12:00:00Z');
const row=(id,cnpj='00111111000122',extra={})=>({id:String(id),fields:{Title:'FORNECEDOR FICTÍCIO',CNPJ_FORNECEDOR:cnpj,SITUACAO:'Em aberto',VENCIMENTO:'2026-11-01',VALOR:10,BANCO:'BANCO EXEMPLO',...extra}});
const setup=source=>{
 const dom=new JSDOM('<body><main id="app"></main></body>',{url:'https://example.test'});
 const data={loadSnapshot:async()=>({rows:source})};
 const view=createDdaReportView({document:dom.window.document,data,now});
 return {dom,doc:dom.window.document,view,data};
};
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));};

test('supplier history matches formatted CNPJ, preserves zeros and includes paid, old and scheduled rows before filters',()=>{
 const normalized=normalizeDdaReportRows({rows:[row(1),row(2,'00.111.111/0001-22',{Title:'OUTRO NOME',SITUACAO:'Pago',VENCIMENTO:'2025-01-01'}),row(3,undefined,{SITUACAO:'Agendado',BANCO:'OUTRO BANCO'}),row(4,'00999999000122')]});
 assert.deepEqual(normalized.map(r=>r.supplierDdaCount),[3,3,3,1]);
 assert.equal(normalized[1].supplierCnpj,'00111111000122');
 const report=buildDdaReport(normalized,{status:'Em aberto',bank:'BANCO EXEMPLO',search:'1'},now());
 assert.equal(report.rows.length,1);assert.equal(report.rows[0].supplierDdaCount,3);assert.equal(report.total,'10.00');
 assert.ok(Object.isFrozen(normalized[0]));
});

test('missing or malformed CNPJ never groups by supplier name or reports zero; opaque alphanumeric CNPJ retains identity',()=>{
 const normalized=normalizeDdaReportRows({rows:[row(1,''),row(2,null),row(3,'00000000000000'),row(4,'prefix 00111111000122'),row(5,'AB.111.111/0001-22'),row(6,'ab111111000122')]});
 assert.deepEqual(normalized.map(r=>r.supplierDdaCount),[null,null,null,null,2,2]);
 for(const r of normalized.slice(0,4))assert.equal(r.supplierCnpj,null);
 assert.throws(()=>normalizeDdaReportRows({rows:[row(1)],hasMore:true}));
});

test('supplier cluster appears below the name and keeps the full history count across filters and print',async()=>{
 const {dom,doc,view}=setup([row(1),row(2,undefined,{SITUACAO:'Pago'}),row(3,'00999999000122')]);
 try{
  await view.open();
  const cell=doc.querySelector('[data-dda-id="1"] .ddr-supplier');
  assert.equal(cell.firstElementChild.textContent,'FORNECEDOR FICTÍCIO');
  const cluster=cell.querySelector('[data-dda-supplier-count]');
  assert.match(cluster.textContent,/2 DDAs registrados/);
  assert.equal(cluster.previousElementSibling,cell.firstElementChild);
  assert.match(cluster.title,/todos os status/i);
  const search=doc.querySelector('[name=search]');search.value='1';search.dispatchEvent(new dom.window.Event('input'));
  assert.match(doc.querySelector('[data-dda-supplier-count]').textContent,/2 DDAs registrados/);
  const restore=await view.preparePrint();const print=captureFilteredReport(view.element,{title:'DDA'});restore();
  assert.match(JSON.stringify(print),/2 DDAs registrados/);
 }finally{view.destroy();dom.window.close();}
});

test('counts span later report pages and refresh recalculates them; unavailable CNPJ stays explicit',async()=>{
 const source=Array.from({length:53},(_,i)=>row(i+1));source.push(row(54,''));
 const {dom,doc,view,data}=setup(source);
 try{
  await view.open();assert.match(doc.querySelector('[data-dda-supplier-count]').textContent,/53 DDAs registrados/);
  doc.querySelector('[data-page-next]').click();
  assert.match(doc.querySelector('[data-dda-id="53"] [data-dda-supplier-count]').textContent,/53 DDAs registrados/);
  const unknown=doc.querySelector('[data-dda-id="54"] [data-dda-supplier-count]');
  assert.match(unknown.textContent,/CNPJ indisponível/);assert.doesNotMatch(unknown.textContent,/0 DDA/);
  data.loadSnapshot=async()=>({rows:[row(1)]});doc.querySelector('[aria-label="Atualizar DDAs"]').click();await settle();
  assert.match(doc.querySelector('[data-dda-supplier-count]').textContent,/1 DDA registrado/);
 }finally{view.destroy();dom.window.close();}
});
