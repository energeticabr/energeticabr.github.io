import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPendingConstructionDiaryData} from '../src/chat/pending-construction-diary-data.js';
import {buildPendingWorkDiariesReport} from '../src/chat/pending-work-diaries-report-model.js';

const columns = [{name:'STATUS'}, {name:'DATA'}, {name:'FILIAL'}];
const pending = (id, extra={}) => ({id, fields:{STATUS:'PENDENTE',DATA:'2026-10-07',FILIAL:'XAVANTE',...extra}});
function source(pages, metadata=columns, strictReport=true) {
  return createPendingConstructionDiaryData({strictReport,repository:{
    async resolveList(){return {status:'resolved',id:'diaries'};},
    async getColumns(){return metadata;},
    async getItemsPage(site,id,query,{pageNumber}){return pages[pageNumber-1];},
    updateItem(){throw Error('read-only');},
  }});
}
const report = async data => buildPendingWorkDiariesReport(await data.loadSnapshot());

test('report controller opts into strict validation while existing reminders keep their own ordering',async()=>{
  const controller=readFileSync(new URL('../src/app-controller.js',import.meta.url),'utf8');
  assert.match(controller,/createPendingConstructionDiaryData\(\{\s*\.\.\.options,\s*strictReport:\s*true\s*\}\)/);
  const pages=[{items:[pending('17'),pending('19',{DATA:'2026-10-06'}),pending('18',{STATUS:'POSTADO'})],hasMore:false}];
  assert.deepEqual((await report(source(pages))).rows.map(row=>row.id),[19,17]);
  assert.deepEqual((await source(pages,columns,false).loadSnapshot()).rows.map(row=>row.id),['19','17']);
});
for(const id of ['x','0','9007199254740993']) test(`strict source rejects invalid pending ID ${id} instead of successful zero`,async()=>{
  await assert.rejects(report(source([{items:[pending(id)],hasMore:false}])),/ID inválido/i);
});
test('strict source detects conflicting duplicates across pages before the reminder map overwrites them',async()=>{
  await assert.rejects(report(source([
    {items:[pending('17')],hasMore:true,nextLink:'next'},
    {items:[pending('17',{FILIAL:'OUTRA OBRA'})],hasMore:false},
  ])),/duplicado.*conflitantes/i);
  assert.equal((await report(source([{items:[pending('17'),pending('17')],hasMore:false}]))).pendingCount,1);
  assert.equal((await report(source([{items:[pending('0017')],hasMore:false}]))).pendingCount,1);
});
for(const field of ['DATA','FILIAL']) test(`strict source rejects missing or ambiguous ${field} metadata`,async()=>{
  await assert.rejects(report(source([{items:[pending('17')],hasMore:false}],columns.filter(c=>c.name!==field))),new RegExp(field));
  await assert.rejects(report(source([{items:[pending('17')],hasMore:false}],[...columns,{name:'other',displayName:field}])),new RegExp(field));
});
test('strict source rejects missing row fields and incomplete pages but genuine empty results stay zero',async()=>{
  for(const field of ['STATUS','DATA','FILIAL']) {
    const item=pending('17');delete item.fields[field];
    await assert.rejects(report(source([{items:[item],hasMore:false}])),/incompleto/i);
  }
  for(const page of [undefined,{}, {items:[]}, {items:'invalid',hasMore:false}, {items:[],hasMore:false,nextLink:'next'}]) {
    await assert.rejects(report(source([page])),/incomplet|inválid/i);
  }
  assert.equal((await report(source([{items:[],hasMore:false}]))).pendingCount,0);
});
