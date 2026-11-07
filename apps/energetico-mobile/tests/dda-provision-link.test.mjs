import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createDdaProvisionLink,rankDdaProvisionOptions,DDA_PROVISION_FIELD} from '../src/chat/dda-provision-link.js';
import {createDdaReportView} from '../src/ui/dda-report-view.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const provision=(id,supplier,amount,date)=>({id:String(id),fields:{FORNECEDOR:supplier,VALORTOTAL:amount,...(date?{DATAPGTOEFETUADO:date}:{})}});
function repository(){
 const state={items:[provision(1,'SWILE DO BRASIL S.A.','58,21'),provision(2,'OUTRO FORNECEDOR','58,21'),provision(3,'SWILE DO BRASIL S.A.','100','2026-10-28')],children:[],linked:'',writes:[]};
 const api={
  resolveList:async(_site,[name])=>({status:'resolved',id:name==='DDAS SICOOB'?'dda':name==='DESCRITIVOPROVISAO'?'provision':'children'}),
  getColumns:async(_site,list)=>list==='children'?[{name:'DESCRITIVOPROVISAO',text:{}}]:[{name:DDA_PROVISION_FIELD,readOnly:false}],
  getItems:async(_site,list)=>list==='children'?state.children:state.items,
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
test('loads unpaid child amounts with quantity and freight under their actual parent and explains the match',async t=>{
 const {state,api}=repository();
 state.items=[provision(1,'CONCRETEIRA FICTÍCIA','15000'),provision(2,'CONCRETEIRA FICTÍCIA','10000')];
 const child=(id,parent,price,extra={})=>({id:String(id),fields:{DESCRITIVOPROVISAO:parent,VALORTOTAL:price,...extra}});
 state.children=[
  child(101,'1','2.750,00',{QTD:'2',FRETE:'16,67',DATAPREVISTOPGTO:'06/11/2026'}),
  child(102,'1','9483,33'),
  child(103,'2','5516,67',{DATAPGTOEFETUADO:'2026-11-05'}),
  child(104,'999','5516,67'),child(105,'2','inválido'),
  child(106,'2','5516,67',{STATUS:'PAGAMENTO EFETUADO'}),
  child(107,'2','5516,67',{PGTOAGENDADO:'PAGO'}),
 ];
 const service=createDdaProvisionLink({repository:api});
 const options=await service.loadOptions();
 const ranked=rankDdaProvisionOptions(options,{supplier:'CONCRETEIRA FICTÍCIA',amount:'5.516,67',due:'2026-11-06'});
 assert.equal(ranked[0].id,'1');assert.equal(ranked[0].amountMatch,true);
 assert.equal(ranked[0].matchedProvision.id,'101');assert.equal(ranked[0].matchedProvision.amount,5516.67);
 assert.equal(ranked[0].matchedProvision.due,'2026-11-06');
 assert.equal(ranked[1].amountMatch,false);assert.equal(state.writes.length,0);
 const dom=new JSDOM('<body><main></main></body>');
 const {createDdaProvisionPicker}=await import('../src/ui/dda-provision-picker.js');
 const picker=createDdaProvisionPicker({document:dom.window.document,host:dom.window.document.querySelector('main'),service});
 t.after(()=>{picker.destroy();dom.window.close();});
 await picker.show({id:'37',supplier:'CONCRETEIRA FICTÍCIA',amount:5516.67,due:'2026-11-06'});
 const option=dom.window.document.querySelector('.dda-provision-star').closest('label');
 assert.match(option.textContent,/Provisão #101/);assert.match(option.textContent,/5\.516,67/);
 assert.equal(option.querySelector('input').checked,false);assert.equal(state.writes.length,0);
});
test('resolves a child due-date internal name from SharePoint metadata',async()=>{
 const {state,api}=repository(),columns=api.getColumns;
 api.getColumns=async(site,list,...rest)=>list==='children'?[{name:'DESCRITIVOPROVISAO',text:{}},{name:'internal_due',displayName:'DATA PREVISTO PGTO'}]:columns(site,list,...rest);
 state.children=[{id:'101',fields:{DESCRITIVOPROVISAO:'1',VALORTOTAL:'58,21',internal_due:'2026-11-06'}}];
 const options=await createDdaProvisionLink({repository:api}).loadOptions();
 assert.equal(options[0].provisions[0].due,'2026-11-06');
});
test('uses the due date of an amount-matching child and retains exact parent total matching',()=>{
 const options=[
  {id:'1',supplier:'CONCRETEIRA',amount:15000,due:'2026-11-06',provisions:[{id:'101',amount:5516.67,due:'2026-12-06'}]},
  {id:'2',supplier:'CONCRETEIRA',amount:20000,due:'2026-12-06',provisions:[{id:'201',amount:5516.67,due:'2026-11-06'},{id:'202',amount:50,due:'2026-11-06'}]},
 ];
 const ranked=rankDdaProvisionOptions(options,{supplier:'CONCRETEIRA',amount:5516.67,due:'2026-11-06'});
 assert.equal(ranked[0].id,'2');assert.equal(ranked[0].matchedProvision.id,'201');
 assert.deepEqual(ranked.map(item=>item.recommended),[true,false]);
 assert.equal(rankDdaProvisionOptions([...options,{id:'3',supplier:'CONCRETEIRA',amount:5516.67,due:'2026-11-06'}],{supplier:'CONCRETEIRA',amount:5516.67,due:'2026-11-06'}).find(item=>item.id==='3').amountMatch,true);
 assert.equal(rankDdaProvisionOptions(options,{supplier:'OUTRO',amount:'inválido'})[0].recommended,false);
});
test('does not silently rank incomplete child reads or invalid parent-link metadata',async()=>{
 const {api}=repository(),read=api.getItems;
 api.getItems=async(site,list,...rest)=>list==='children'?null:read(site,list,...rest);
 await assert.rejects(createDdaProvisionLink({repository:api}).loadOptions(),/incompleta/);
 api.getItems=read;api.getColumns=async(_site,list)=>list==='children'?[]:[{name:DDA_PROVISION_FIELD}];
 await assert.rejects(createDdaProvisionLink({repository:api}).loadOptions(),/metadados/);
});
test('same supplier and total recommend only the closest due date',()=>{
 const options=[
  {id:'47',supplier:'SWILE',amount:'1350',due:'2026-11-04'},
  {id:'46',supplier:'SWILE',amount:'1350',due:'2026-10-28'},
  {id:'48',supplier:'SWILE',amount:'1350',due:'2026-11-11'},
 ];
 const ranked=rankDdaProvisionOptions(options,{supplier:'SWILE DO BRASIL S.A.',amount:'1350',due:'2026-10-28'});
 assert.deepEqual(ranked.map(item=>item.id),['46','47','48']);
 assert.deepEqual(ranked.map(item=>item.recommended),[true,false,false]);
 assert.equal(rankDdaProvisionOptions([{id:'1',supplier:'OUTRO',amount:'99',due:'2026-10-28'}],{supplier:'SWILE',amount:'1350',due:'2026-10-28'})[0].recommended,false);
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
 assert.deepEqual([...doc.querySelectorAll('.ddr-table thead th')].map(cell=>cell.textContent).slice(-3),['SITUAÇÃO','VINCULAÇÃO','AÇÕES']);
 assert.equal(doc.querySelector('[data-dda-id="31"] .ddr-link-cluster').textContent,'N/A');
 assert.equal(doc.querySelector('[data-dda-id="31"] .ddr-link-cluster').dataset.linkState,'missing');
 doc.querySelector('[data-dda-provision-pencil="31"]').click();await tick();await tick();
 assert.match(doc.querySelector('.dda-provision-dialog').textContent,/A qual DESCRITIVO PROVISÃO DESEJA VINCULAR/);
 assert.match(doc.querySelector('.dda-provision-star').textContent,/MAIS PROVÁVEL/);
 assert.equal(state.writes.length,0);
 doc.querySelector('input[value="1"]').click();
 const search=doc.querySelector('.dda-provision-search');search.value='SWILE';search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 assert.ok(doc.querySelector('input[value="1"]').closest('[data-edit-changed]'),'search preserves selected link highlight');
 search.value='OUTRO';search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 search.value='';search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 assert.ok(doc.querySelector('input[value="1"]').closest('[data-edit-changed]'),'clearing search restores highlighted selection');
 doc.querySelector('.dda-provision-save').click();await tick();await tick();
 assert.equal(state.writes.length,0,'the first submit only reviews the link');
 assert.ok(doc.querySelector('[data-edit-review]'));
 assert.match(doc.querySelector('[data-edit-review]').textContent,/Descritivo provisão/);
 doc.querySelector('[data-edit-review-cancel]').click();await tick();
 assert.equal(doc.querySelector('input[value="1"]').checked,true);
 assert.equal(state.writes.length,0);
 doc.querySelector('.dda-provision-save').click();await tick();
 doc.querySelector('[data-edit-review-submit]').click();await tick();await tick();
 assert.equal(state.linked,'1');assert.equal(view.element.hidden,false);assert.equal(doc.querySelector('[data-dda-id="31"] .ddr-link-cluster').textContent,'ID 1');
 assert.equal(doc.querySelector('[data-dda-id="31"] .ddr-link-cluster').dataset.linkState,'linked');
});
test('saved and invalid provision identifiers render in their own column after reopening',async t=>{
 const dom=new JSDOM('<body><main id="app"></main></body>'),doc=dom.window.document;
 const row=(id,link)=>({id:String(id),fields:{Title:'FORNECEDOR FICTÍCIO',SITUACAO:'Em aberto',VALOR:10,VENCIMENTO:'2026-10-29',DESCRITIVOPROVIS_x00c3_O:link}});
 const view=createDdaReportView({document:doc,data:{loadSnapshot:async()=>({rows:[row(1,'46'),row(2,'inválido')]})}});
 t.after(()=>{view.destroy();dom.window.close();});await view.open();
 assert.equal(doc.querySelector('[data-dda-id="1"] .ddr-link-cluster').textContent,'ID 46');
 assert.equal(doc.querySelector('[data-dda-id="2"] .ddr-link-cluster').textContent,'N/A');
});
