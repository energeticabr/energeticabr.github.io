import test from 'node:test';
import assert from 'node:assert/strict';
import {createPendingConstructionDiaryData} from '../src/chat/pending-construction-diary-data.js';

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
const snapshot = data => data.loadSnapshot();

test('strict and reminder reads retain their date order and filter posted diaries',async()=>{
  const pages=[{items:[pending('17'),pending('19',{DATA:'2026-10-06'}),pending('18',{STATUS:'POSTADO'})],hasMore:false}];
  assert.deepEqual((await snapshot(source(pages))).rows.map(row=>row.id),['19','17']);
  assert.deepEqual((await source(pages,columns,false).loadSnapshot()).rows.map(row=>row.id),['19','17']);
});
for(const id of ['x','0','9007199254740993']) test(`strict source rejects invalid pending ID ${id} instead of successful zero`,async()=>{
  await assert.rejects(snapshot(source([{items:[pending(id)],hasMore:false}])),/ID inválido/i);
});
test('strict source detects conflicting duplicates across pages before the reminder map overwrites them',async()=>{
  await assert.rejects(snapshot(source([
    {items:[pending('17')],hasMore:true,nextLink:'next'},
    {items:[pending('17',{FILIAL:'OUTRA OBRA'})],hasMore:false},
  ])),/duplicado.*conflitantes/i);
  assert.equal((await snapshot(source([{items:[pending('17'),pending('17')],hasMore:false}]))).count,1);
  assert.equal((await snapshot(source([{items:[pending('0017')],hasMore:false}]))).count,1);
});
for(const field of ['DATA','FILIAL']) test(`strict source rejects missing or ambiguous ${field} metadata`,async()=>{
  await assert.rejects(snapshot(source([{items:[pending('17')],hasMore:false}],columns.filter(c=>c.name!==field))),new RegExp(field));
  await assert.rejects(snapshot(source([{items:[pending('17')],hasMore:false}],[...columns,{name:'other',displayName:field}])),new RegExp(field));
});
test('strict source rejects missing row fields and incomplete pages but genuine empty results stay zero',async()=>{
  for(const field of ['STATUS','DATA','FILIAL']) {
    const item=pending('17');delete item.fields[field];
    await assert.rejects(snapshot(source([{items:[item],hasMore:false}])),/incompleto/i);
  }
  for(const page of [undefined,{}, {items:[]}, {items:'invalid',hasMore:false}, {items:[],hasMore:false,nextLink:'next'}]) {
    await assert.rejects(snapshot(source([page])),/incomplet|inválid/i);
  }
  assert.equal((await snapshot(source([{items:[],hasMore:false}]))).count,0);
});
