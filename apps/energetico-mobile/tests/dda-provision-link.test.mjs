import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createDdaProvisionLink,rankDdaProvisionOptions,DDA_PROVISION_FIELD} from '../src/chat/dda-provision-link.js';
import {createDdaReportView} from '../src/ui/dda-report-view.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const provision=(id,supplier,amount,date)=>({id:String(id),fields:{FORNECEDOR:supplier,VALORTOTAL:amount,...(date?{DATAPGTOEFETUADO:date}:{})}});
function repository(){
 const state={items:[provision(1,'SWILE DO BRASIL S.A.','58,21'),provision(2,'OUTRO FORNECEDOR','58,21'),provision(3,'SWILE DO BRASIL S.A.','100','2026-10-28')],linked:'',writes:[]};
 const api={
  resolveList:async(_site,[name])=>({status:'resolved',id:name==='DDAS SICOOB'?'dda':'provision'}),
  getColumns:async()=>[{name:DDA_PROVISION_FIELD,readOnly:false}],
  getItems:async()=>state.items,
  getItem:async(_site,list,id)=>list==='provision'?state.items.find(item=>item.id===String(id)):{id:String(id),eTag:'"version-1"',fields:{[DDA_PROVISION_FIELD]:state.linked}},
  updateItem:async(_site,list,id,fields,options)=>{state.writes.push({list,id,fields,options});state.linked=fields[DDA_PROVISION_FIELD];return {fields:{[DDA_PROVISION_FIELD]:state.linked}};},
 };return {state,api};
}
test('lists only unpaid provision descriptions and ranks supplier or exact total, without auto-linking',async()=>{
 const {state,api}=repository(),service=createDdaProvisionLink({repository:api});
 const options=await service.loadOptions();assert.deepEqual(options.map(item=>item.id),['1','2']);
 const ranked=rankDdaProvisionOptions(options,{supplier:'Swile do Brasil',amount:'58.21'});
 assert.equal(ranked[0].id,'1');assert.equal(ranked[0].recommended,true);assert.equal(ranked[1].amountMatch,true);
 assert.equal(state.writes.length,0);
 state.items[0].fields.DATAPGTOEFETUADO='2026-10-29';
 await assert.rejects(service.save({ddaId:'31',provisionId:'1'}),/pagamento efetuado/);
 assert.equal(state.writes.length,0);
});
test('saves only the provision ID with a version check and confirms SharePoint readback',async()=>{
 const {state,api}=repository(),service=createDdaProvisionLink({repository:api});
 const result=await service.save({ddaId:'31',provisionId:'2'});
 assert.deepEqual(result,{ddaId:'31',provisionId:'2'});
 assert.deepEqual(state.writes,[{list:'dda',id:'31',fields:{[DDA_PROVISION_FIELD]:'2'},options:{eTag:'"version-1"',signal:undefined}}]);
 await service.save({ddaId:'31',provisionId:'2'});assert.equal(state.writes.length,1);
});
test('report pencil opens picker above report, stars likely option, links selected ID and keeps report open',async t=>{
 const dom=new JSDOM('<body><main id="app"></main></body>'),doc=dom.window.document,{state,api}=repository();
 const service=createDdaProvisionLink({repository:api});
 const row={id:'31',fields:{Title:'SWILE DO BRASIL S.A.',SITUACAO:'Em aberto',VALOR:'58.21',VENCIMENTO:'2026-10-29'}};
 const view=createDdaReportView({document:doc,data:{loadSnapshot:async()=>({rows:[row]}),provisionLink:service},now:()=>new Date('2026-10-29T12:00:00Z')});
 t.after(()=>{view.destroy();dom.window.close();});await view.open();
 doc.querySelector('[data-dda-provision-pencil="31"]').click();await tick();await tick();
 assert.match(doc.querySelector('.dda-provision-dialog').textContent,/A qual DESCRITIVO PROVISÃO DESEJA VINCULAR/);
 assert.match(doc.querySelector('.dda-provision-star').textContent,/MAIS PROVÁVEL/);
 assert.equal(state.writes.length,0);
 doc.querySelector('input[value="1"]').click();doc.querySelector('.dda-provision-save').click();await tick();await tick();
 assert.equal(state.linked,'1');assert.equal(view.element.hidden,false);assert.match(doc.querySelector('[data-dda-id="31"] .ddr-provision-linked').textContent,/Provisão #1/);
});
