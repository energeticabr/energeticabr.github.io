import test from 'node:test';
import assert from 'node:assert/strict';
import {createProvisionDescriptionEditor} from '../portal/forms/provision-description-edit.js';

const dates=['DATAPREVISTOPGTO','DATAPGTOEFETUADO','PGTOAGENDADO','DATAPGTOAGENDADO','DATAEXECUCAOAGENDAMENTO'];
const texts=['FILIAL','FORNECEDOR','FORMAPGTO','OBS'];
export function fixture(){
 const columns={parents:[...dates.map(name=>({name,dateTime:{}})),...texts.map(name=>({name,text:{}})),{name:'VALORTOTAL',text:{}}],children:[...dates.map(name=>({name,...(name==='PGTOAGENDADO'?{text:{}}:{dateTime:{}})})),...texts.map(name=>({name,text:{}})),{name:'DESCRITIVOPROVISAO',text:{}}]};
 const records={parents:new Map([['42',{id:'42',eTag:'p1',fields:{OBS:'old',FORMAPGTO:'CAIXA',VALORTOTAL:'300',DATAPREVISTOPGTO:'2026-10-01'}}]]),children:new Map([['2',{id:'2',eTag:'c2v1',fields:{DESCRITIVOPROVISAO:'42',OBS:'child old',QTD:'2',VALORTOTAL:'50',PRODUTO:'A'}}],['3',{id:'3',eTag:'c3v1',fields:{DESCRITIVOPROVISAO:'42',OBS:'child old',QTD:'1',VALORTOTAL:'200',PRODUTO:'B'}}],['9',{id:'9',eTag:'c9v1',fields:{DESCRITIVOPROVISAO:'142',OBS:'foreign'}}]])};
 const calls=[];let beforePatch=null,beforeRead=null;
 const repo={async resolveList(site,aliases){assert.equal(site,'personal');return{status:'resolved',id:aliases.includes('DESCRITIVOPROVISAO')?'parents':'children'};},async getColumns(_site,list){return structuredClone(columns[list]);},async getItemsPage(_site,list,_query,options={}){assert.equal(list,'children');calls.push(['page',options.cursor||'']);return options.cursor?{items:[structuredClone(records.children.get('3'))],hasMore:false}:{items:[structuredClone(records.children.get('2')),structuredClone(records.children.get('9'))],hasMore:true,nextLink:'next'};},async getItem(_site,list,id){await beforeRead?.(list,String(id));return structuredClone(records[list].get(String(id)));},async updateItem(_site,list,id,fields,options){calls.push(['patch',list,String(id),structuredClone(fields),options.eTag]);await beforePatch?.(list,String(id),fields);const current=records[list].get(String(id));if(current.eTag!==options.eTag)throw Object.assign(new Error('stale'),{status:412});const result={...current,eTag:current.eTag+'n',fields:{...current.fields,...fields}};records[list].set(String(id),result);return structuredClone(result);}};
 const editor=createProvisionDescriptionEditor({repository:repo});
 const baseline=structuredClone(records.parents.get('42'));
 const save=(fields,options={})=>editor.save({list:{id:'parents'},item:baseline,fields,...options});
 return {repo,editor,columns,records,calls,baseline,save,setBeforePatch(fn){beforePatch=fn;},setBeforeRead(fn){beforeRead=fn;}};
}

test('parent edit patches parent then every exact linked child across pages, preserving line amounts',async()=>{const f=fixture();await f.save({OBS:'new',FORMAPGTO:'PIX',DATAPREVISTOPGTO:'2026-11-01'});assert.deepEqual(f.calls.filter(c=>c[0]==='patch').map(c=>c.slice(1,3)),[['parents','42'],['children','2'],['children','3']]);assert.equal(f.records.children.get('9').fields.OBS,'foreign');for(const id of ['2','3']){assert.equal(f.records.children.get(id).fields.OBS,'new');assert.equal(f.records.children.get(id).fields.FORMAPGTO,'PIX');}assert.equal(f.records.children.get('2').fields.VALORTOTAL,'50');assert.equal(f.records.children.get('3').fields.PRODUTO,'B');});
test('linked provision scan respects repository pagination and Graph batch limits before saving',async()=>{
 const f=fixture();const getPage=f.repo.getItemsPage;const pages=[];
 f.repo.getItemsPage=async(site,list,query,options)=>{
  const top=Number(new URLSearchParams(query).get('$top'));
  if(options.maxPages>100)throw new RangeError('O limite de páginas deve estar entre 1 e 100.');
  if(top>100)throw new RangeError('O lote Graph deve conter entre 1 e 100 registros.');
  pages.push({pageNumber:options.pageNumber,maxPages:options.maxPages,top});
  return getPage(site,list,query,options);
 };
 await f.save({OBS:'new'});
 assert.deepEqual(pages,[{pageNumber:1,maxPages:100,top:100},{pageNumber:2,maxPages:100,top:100},{pageNumber:1,maxPages:100,top:100},{pageNumber:2,maxPages:100,top:100}]);
 assert.equal(f.records.parents.get('42').fields.OBS,'new');
 assert.equal(f.records.children.get('2').fields.OBS,'new');
 assert.equal(f.records.children.get('3').fields.OBS,'new');
});
test('a multi-line parent total cannot be changed without choosing which provision line to adjust',async()=>{
 const f=fixture();
 await assert.rejects(f.save({VALORTOTAL:'999'}),/provisões|linhas|itens/i);
 assert.equal(f.calls.filter(c=>c[0]==='patch').length,0);
});
test('a sole linked provision receives a parent total edit as an exact unit-price change',async()=>{
 const f=fixture();
 f.records.parents.get('42').fields.VALORTOTAL='100';
 f.baseline.fields.VALORTOTAL='100';
 Object.assign(f.records.children.get('2').fields,{QTD:'2',VALORTOTAL:'50',FRETE:'0'});
 f.columns.children.push(...['QTD','VALORTOTAL','FRETE'].map(name=>({name,text:{}})));
 f.repo.getItemsPage=async()=>({items:[structuredClone(f.records.children.get('2'))],hasMore:false});
 await f.save({VALORTOTAL:'80'});
 assert.equal(f.records.parents.get('42').fields.VALORTOTAL,'80');
 assert.equal(f.records.children.get('2').fields.VALORTOTAL,'40');
});
test('a formatted parent total keeps the same numeric aggregate after propagation',async()=>{
 const f=fixture();
 f.records.parents.get('42').fields.VALORTOTAL='100';
 f.baseline.fields.VALORTOTAL='100';
 Object.assign(f.records.children.get('2').fields,{QTD:'2',VALORTOTAL:'50',FRETE:'0'});
 f.columns.children.push(...['QTD','VALORTOTAL','FRETE'].map(name=>({name,text:{}})));
 f.repo.getItemsPage=async()=>({items:[structuredClone(f.records.children.get('2'))],hasMore:false});
 await f.save({VALORTOTAL:'80.00'});
 assert.equal(f.records.children.get('2').fields.VALORTOTAL,'40');
});
test('explicit clearing propagates dates and notes',async()=>{const f=fixture();await f.save({OBS:'',DATAPGTOEFETUADO:null});assert.equal(f.records.children.get('2').fields.OBS,'');assert.equal(f.records.children.get('2').fields.DATAPGTOEFETUADO,null);});
test('parent schedule date is represented as date text in legacy child field without inventing paid status',async()=>{const f=fixture();await f.save({PGTOAGENDADO:'2026-10-12T03:00:00Z'});assert.equal(f.records.children.get('2').fields.PGTOAGENDADO,'2026-10-12T03:00:00Z');assert.equal(f.records.children.get('2').fields.STATUS,undefined);});
test('missing child metadata rejects before modifying parent',async()=>{const f=fixture();f.columns.children=f.columns.children.filter(c=>c.name!=='OBS');await assert.rejects(f.save({OBS:'new'}),/OBS|metadados/i);assert.equal(f.calls.filter(c=>c[0]==='patch').length,0);});
test('incomplete pagination rejects before writes',async()=>{const f=fixture();f.repo.getItemsPage=async()=>({items:[],hasMore:true});await assert.rejects(f.save({OBS:'new'}),/pagin|completa|cursor/i);assert.equal(f.calls.filter(c=>c[0]==='patch').length,0);});
test('linked provision scan refuses a 101st page without changing the parent',async()=>{
 const f=fixture();let pages=0;
 f.repo.getItemsPage=async(_site,_list,_query,options)=>{
  pages++;assert.equal(options.maxPages,100);
  return {items:[],hasMore:true,nextLink:`next-${pages}`};
 };
 await assert.rejects(f.save({OBS:'new'}),/limite seguro de páginas/i);
 assert.equal(pages,100);
 assert.equal(f.calls.filter(call=>call[0]==='patch').length,0);
});
test('missing child ETag rejects before writes',async()=>{const f=fixture();delete f.records.children.get('3').eTag;await assert.rejects(f.save({OBS:'new'}),/ETag|versão/i);assert.equal(f.calls.filter(c=>c[0]==='patch').length,0);});
test('partial failure identifies remaining children and retries without rewriting parent or completed child',async()=>{const f=fixture();let failed=false;f.setBeforePatch((list,id)=>{if(list==='children'&&id==='3'&&!failed){failed=true;throw new Error('offline');}});await assert.rejects(f.save({OBS:'new'}),error=>error.code==='PROVISION_DESCRIPTION_SYNC_INCOMPLETE'&&error.parentId==='42'&&error.pendingChildIds.includes('3'));await f.save({OBS:'new'});assert.equal(f.calls.filter(c=>c[0]==='patch'&&c[1]==='parents').length,1);assert.equal(f.calls.filter(c=>c[0]==='patch'&&c[2]==='2').length,1);assert.equal(f.records.children.get('3').fields.OBS,'new');});
test('relinked child is not overwritten after parent update',async()=>{const f=fixture();f.setBeforePatch((list)=>{if(list==='parents')f.records.children.get('3').fields.DESCRITIVOPROVISAO='99';});await assert.rejects(f.save({OBS:'new'}),/vínculo|vinculad|sincron/i);assert.equal(f.records.children.get('3').fields.OBS,'child old');});
test('concurrently modified child is not overwritten using a freshly stolen ETag',async()=>{const f=fixture();f.setBeforePatch((list)=>{if(list==='parents'){f.records.children.get('3').eTag='concurrent';f.records.children.get('3').fields.OBS='concurrent';}});await assert.rejects(f.save({OBS:'new'}),/versão|mudou|sincron/i);assert.equal(f.records.children.get('3').fields.OBS,'concurrent');});
test('a newer parent version with only unrelated changes preserves them and saves the edited field',async()=>{
 const f=fixture();f.records.parents.get('42').eTag='p2';f.records.parents.get('42').fields.FILIAL='002';
 await f.save({OBS:'new'});
 assert.equal(f.records.parents.get('42').fields.FILIAL,'002');
 assert.equal(f.records.parents.get('42').fields.OBS,'new');
 assert.equal(f.calls.find(call=>call[0]==='patch'&&call[1]==='parents')[4],'p2');
});
test('a partly applied multi-field edit finishes fields still at their original values',async()=>{
 const f=fixture();f.records.parents.get('42').eTag='p2';f.records.parents.get('42').fields.OBS='new';
 await f.save({OBS:'new',FORMAPGTO:'PIX'});
 assert.equal(f.records.parents.get('42').fields.OBS,'new');
 assert.equal(f.records.parents.get('42').fields.FORMAPGTO,'PIX');
 assert.equal(f.records.children.get('2').fields.OBS,'new');
 assert.equal(f.records.children.get('2').fields.FORMAPGTO,'PIX');
});
test('a newer child version with only unrelated changes preserves them while syncing the parent edit',async()=>{
 const f=fixture();f.setBeforePatch(list=>{if(list==='parents'){f.records.children.get('3').eTag='c3v2';f.records.children.get('3').fields.PRODUTO='B atualizado';}});
 await f.save({OBS:'new'});
 assert.equal(f.records.children.get('3').fields.PRODUTO,'B atualizado');
 assert.equal(f.records.children.get('3').fields.OBS,'new');
 assert.equal(f.calls.find(call=>call[0]==='patch'&&call[1]==='children'&&call[2]==='3')[4],'c3v2');
});
test('a newer version of the edited parent field still blocks the save',async()=>{
 const f=fixture();f.records.parents.get('42').eTag='p2';f.records.parents.get('42').fields.OBS='another edit';
 await assert.rejects(f.save({OBS:'new'}),/versão|mudou/i);
 assert.equal(f.records.parents.get('42').fields.OBS,'another edit');
 assert.equal(f.calls.filter(call=>call[0]==='patch').length,0);
});
test('an unrelated update racing the parent PATCH is retried once with the new version',async()=>{
 const f=fixture();let raced=false;
 f.setBeforePatch(list=>{if(list==='parents'&&!raced){raced=true;f.records.parents.get('42').eTag='p2';f.records.parents.get('42').fields.FILIAL='002';}});
 await f.save({OBS:'new'});
 assert.deepEqual(f.calls.filter(call=>call[0]==='patch'&&call[1]==='parents').map(call=>call[4]),['p1','p2']);
 assert.equal(f.records.parents.get('42').fields.FILIAL,'002');
 assert.equal(f.records.parents.get('42').fields.OBS,'new');
});
test('a racing edit of the same parent field is never retried or overwritten',async()=>{
 const f=fixture();f.setBeforePatch(list=>{if(list==='parents'){f.records.parents.get('42').eTag='p2';f.records.parents.get('42').fields.OBS='another edit';}});
 await assert.rejects(f.save({OBS:'new'}),/stale|versão|mudou/i);
 assert.equal(f.calls.filter(call=>call[0]==='patch'&&call[1]==='parents').length,1);
 assert.equal(f.records.parents.get('42').fields.OBS,'another edit');
});
test('invalid calendar dates and mismatched parent identity fail before writes',async()=>{const f=fixture();await assert.rejects(f.save({DATAPREVISTOPGTO:'2026-02-30'}),/data/i);await assert.rejects(f.editor.save({list:{id:'children'},item:f.baseline,fields:{OBS:'new'}}),/lista|descritivo/i);assert.equal(f.calls.filter(c=>c[0]==='patch').length,0);});
test('session or cancellation before submission prevents all writes',async()=>{const f=fixture();const abort=new AbortController();abort.abort();await assert.rejects(f.save({OBS:'new'},{signal:abort.signal}),error=>error.name==='AbortError');const guarded=createProvisionDescriptionEditor({repository:f.repo,assertSession(){throw new Error('session ended');}});await assert.rejects(guarded.save({list:{id:'parents'},item:f.baseline,fields:{OBS:'new'}}),/session/);assert.equal(f.calls.filter(c=>c[0]==='patch').length,0);});
test('lost successful PATCH response is recovered by readback without repeating it',async()=>{const f=fixture(),original=f.repo.updateItem;f.repo.updateItem=async(...args)=>{const saved=await original(...args);if(args[1]==='children'&&args[2]==='2')throw new Error('response lost');return saved;};await f.save({OBS:'new'});assert.equal(f.calls.filter(c=>c[0]==='patch'&&c[2]==='2').length,1);assert.equal(f.records.children.get('3').fields.OBS,'new');});
test('changed parent during child synchronization is not reported as a completed operation',async()=>{const f=fixture();f.setBeforePatch((list,id)=>{if(list==='children'&&id==='3'){f.records.parents.get('42').eTag='new actor';f.records.parents.get('42').fields.OBS='external';}});await assert.rejects(f.save({OBS:'new'}),/descritivo.*mudou|sincron/i);});
test('newly linked child is exposed as pending and resumed on explicit retry',async()=>{const f=fixture();f.repo.getItemsPage=async()=>({items:[...f.records.children.values()].map(row=>structuredClone(row)),hasMore:false});f.setBeforePatch((list,id)=>{if(list==='children'&&id==='3')f.records.children.set('4',{id:'4',eTag:'c4',fields:{DESCRITIVOPROVISAO:'42',OBS:'old'}});});await assert.rejects(f.save({OBS:'new'}),error=>error.pendingChildIds.includes('4'));f.setBeforePatch(null);await f.save({OBS:'new'});assert.equal(f.records.children.get('4').fields.OBS,'new');});
test('metadata labels cannot make the idempotency Title token editable',async()=>{const f=fixture();f.columns.parents.push({name:'Title',displayName:'OBS',text:{}});await assert.rejects(f.save({Title:'changed'}),/editável|identidade/i);assert.equal(f.calls.filter(c=>c[0]==='patch').length,0);});
test('metadata labels cannot redirect shared child edits into protected line or identity columns',async()=>{for(const name of ['VALORTOTAL','VALORUNITARIO','QTD','FRETE','PRODUTO','IDPEDIDO','Title','DESCRITIVOPROVISAO','FORNECEDOR']){const f=fixture();f.columns.children=f.columns.children.filter(c=>!['OBS',name].includes(c.name));f.columns.children.push({name,displayName:'OBS',text:{}});await assert.rejects(f.save({OBS:'999'}),/metadados|protegido|incompat/i,name);assert.equal(f.calls.filter(c=>c[0]==='patch').length,0,name);assert.equal(f.records.children.get('2').fields.VALORTOTAL,'50');}});
test('an empty delta cannot implicitly resume an incomplete operation without matching requested values',async()=>{const f=fixture();let failed=false;f.setBeforePatch((list,id)=>{if(list==='children'&&id==='3'&&!failed){failed=true;throw new Error('offline');}});await assert.rejects(f.save({OBS:'new'}));const count=f.calls.filter(c=>c[0]==='patch').length;await assert.rejects(f.save({}),/retentativa|dados|intenção/i);assert.equal(f.calls.filter(c=>c[0]==='patch').length,count);assert.equal(f.records.children.get('3').fields.OBS,'child old');});

function statusFixture() {
 const f=fixture();
 for(const list of ['parents','children'])f.columns[list].push({name:'STATUS',text:{}});
 f.records.parents.get('42').fields.STATUS='PAGAMENTO PREVISTO';
 f.baseline.fields.STATUS='PAGAMENTO PREVISTO';
 f.records.children.get('2').fields.STATUS='PAGAMENTO PREVISTO';
 f.records.children.get('3').fields.STATUS='PAGAMENTO EFETUADO';
 const getPage=f.repo.getItemsPage;
 f.repo.getItemsPage=async(site,list,query,options)=>list==='parents'?{items:[structuredClone(f.records.parents.get('42'))],hasMore:false}:getPage(site,list,query,options);
 return f;
}
test('confirmed text STATUS is saved with pinned versions and cascaded through the existing parent-first operation',async()=>{
 const f=statusFixture();
 await f.save({STATUS:'PAGAMENTO EFETUADO',OBS:'new'});
 assert.deepEqual(f.calls.filter(call=>call[0]==='patch').map(call=>call.slice(1,3)),[['parents','42'],['children','2'],['children','3']]);
 assert.equal(f.records.parents.get('42').fields.STATUS,'PAGAMENTO EFETUADO');
 assert.equal(f.records.children.get('2').fields.STATUS,'PAGAMENTO EFETUADO');
 assert.equal(f.records.children.get('3').fields.OBS,'new');
 assert.equal(f.records.children.get('2').fields.VALORTOTAL,'50');
 assert.equal(f.records.children.get('9').fields.STATUS,undefined);
});
test('invented text STATUS is rejected before any parent or child write',async()=>{
 const f=statusFixture();
 await assert.rejects(f.save({STATUS:'STATUS INVENTADO'}),/opç|comprov|cadastrad/i);
 assert.equal(f.calls.filter(call=>call[0]==='patch').length,0);
});
test('STATUS revalidates current source values before saving a formerly available selection',async()=>{
 const f=statusFixture();
 f.records.children.get('3').fields.STATUS='PAGAMENTO PREVISTO';
 await assert.rejects(f.save({STATUS:'PAGAMENTO EFETUADO'}),/opç|comprov|cadastrad/i);
 assert.equal(f.calls.filter(call=>call[0]==='patch').length,0);
});
test('child STATUS choice incompatibility prevents the parent write',async()=>{
 const f=statusFixture();
 f.columns.parents.find(column=>column.name==='STATUS').choice={choices:['PAGAMENTO PREVISTO','PAGAMENTO EFETUADO']};
 const child=f.columns.children.find(column=>column.name==='STATUS');delete child.text;child.choice={choices:['PAGAMENTO PREVISTO']};
 await assert.rejects(f.save({STATUS:'PAGAMENTO EFETUADO'}),/opç/i);
 assert.equal(f.calls.filter(call=>call[0]==='patch').length,0);
});
