import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegistrationGalleryData} from '../src/chat/registration-gallery-data.js';
import {createPendingProvisionAttachmentsData} from '../src/chat/orders-gallery-data.js';
import {createProvisionDueDateFixture} from './helpers/provision-due-date-fixture.mjs';

function fixture(){
 const records={parents:{id:'42',eTag:'parent1',fields:{FILIAL:'001',FORNECEDOR:'A',VALORTOTAL:'300',OBS:'original',FORMAPGTO:'CAIXA',DATAPREVISTOPGTO:'2026-10-01T03:00:00Z'}},children:[{id:'2',eTag:'child2',fields:{DESCRITIVOPROVISAO:'42',OBS:'old',DATAPREVISTOPGTO:'2026-10-01T03:00:00Z',PRODUTO:'A',VALORTOTAL:'50'}},{id:'3',eTag:'child3',fields:{DESCRITIVOPROVISAO:'42',OBS:'old',DATAPREVISTOPGTO:'2026-10-01T03:00:00Z',PRODUTO:'B',VALORTOTAL:'250'}}]};
 const columns=[...['FILIAL','FORNECEDOR','VALORTOTAL','OBS','FORMAPGTO'].map(name=>({name,displayName:name,text:{}})),...['DATAPREVISTOPGTO','DATAPGTOEFETUADO','PGTOAGENDADO','DATAPGTOAGENDADO','DATAEXECUCAOAGENDAMENTO'].map(name=>({name,displayName:name,dateTime:{format:'dateTime'}}))];
 const writes=[];let fail=false;
 const catalogs={filiais:{field:'FILIAL',values:['001']},fornecedores:{field:'CADASTRO',values:['A']},contas:{field:'CONTA',values:['CAIXA','PIX']}};
 const repository=Object.freeze({async resolveList(_site,aliases){return{status:'resolved',id:({FILIAIS:'filiais',FORNECEDORES:'fornecedores',CADASTROCONTA:'contas',DESCRITIVOPROVISAO:'parents'})[aliases[0]]||'children'};},async getColumns(_site,list){return structuredClone(catalogs[list]?[{name:catalogs[list].field,text:{}}]:list==='parents'?columns:[...columns.filter(c=>c.name!=='VALORTOTAL'),{name:'DESCRITIVOPROVISAO',text:{}}]);},async getItem(_site,list,id){return structuredClone(list==='parents'?records.parents:records.children.find(row=>row.id===id));},async getItemsPage(_site,list,_query,options={}){if(catalogs[list])return{items:catalogs[list].values.map((value,index)=>({id:String(index+1),fields:{[catalogs[list].field]:value}})),hasMore:false};return list==='parents'?{items:[structuredClone(records.parents)],hasMore:false}:options.cursor?{items:[structuredClone(records.children[1])],hasMore:false}:{items:[structuredClone(records.children[0])],hasMore:true,nextLink:'next'};},async updateItem(_site,list,id,fields,options){writes.push({list,id,fields:structuredClone(fields),eTag:options.eTag});if(fail&&list==='children'&&id==='3'){fail=false;throw new Error('offline');}const target=list==='parents'?records.parents:records.children.find(row=>row.id===id);assert.equal(target.eTag,options.eTag);Object.assign(target.fields,fields);target.eTag+='n';return structuredClone(target);}});
 return {repository,records,writes,failNext(){fail=true;}};
}
test('description gallery metadata editor cascades validated payment edits to all linked children',async()=>{const f=fixture(),data=createRegistrationGalleryData({kind:'provisionDescription',repository:f.repository});const context=await data.loadEditor('42');await data.saveEditor(context,{OBS:'new',FORMAPGTO:'PIX',DATAPREVISTOPGTO:'2026-11-01T03:00'});assert.deepEqual(f.writes.map(w=>[w.list,w.id]),[['parents','42'],['children','2'],['children','3']]);assert.equal(f.records.children[0].fields.OBS,'NEW');assert.equal(f.records.children[1].fields.VALORTOTAL,'250');});
test('popup pencil due date cascades to both children',async()=>{const f=fixture(),data=createPendingProvisionAttachmentsData({sourceKind:'provision-description',repository:f.repository});await data.updateDueDate('42','2026-11-01');assert.deepEqual(f.writes.map(w=>[w.list,w.id]),[['parents','42'],['children','2'],['children','3']]);assert.match(f.records.children[0].fields.DATAPREVISTOPGTO,/^2026-11-01T/);});
test('gallery retains failed edit context for child-only retry and exposes incomplete synchronization',async()=>{const f=fixture(),data=createRegistrationGalleryData({kind:'provisionDescription',repository:f.repository});const context=await data.loadEditor('42');f.failNext();await assert.rejects(data.saveEditor(context,{OBS:'new'}),error=>error.code==='PROVISION_DESCRIPTION_SYNC_INCOMPLETE');await data.saveEditor(context,{OBS:'new'});assert.equal(f.writes.filter(w=>w.list==='parents').length,1);assert.equal(f.records.children[1].fields.OBS,'NEW');});
test('cancelled gallery write passes its signal through metadata adapter and performs no writes',async()=>{const f=fixture(),data=createRegistrationGalleryData({kind:'provisionDescription',repository:f.repository});const context=await data.loadEditor('42'),controller=new AbortController();controller.abort();await assert.rejects(data.saveEditor(context,{OBS:'new'},{signal:controller.signal}),error=>error.name==='AbortError');assert.equal(f.writes.length,0);});
test('reopened gallery editor resumes incomplete children even when parent already has the requested values',async()=>{const f=fixture(),data=createRegistrationGalleryData({kind:'provisionDescription',repository:f.repository});f.failNext();await assert.rejects(data.saveEditor(await data.loadEditor('42'),{OBS:'new'}));const reopened=await data.loadEditor('42');await data.saveEditor(reopened,{OBS:'NEW'});assert.equal(f.records.children[1].fields.OBS,'NEW');assert.equal(f.writes.filter(w=>w.list==='parents').length,1);});
test('returning to the old form value after a partial edit never resumes the previous different intent',async()=>{const f=fixture(),data=createRegistrationGalleryData({kind:'provisionDescription',repository:f.repository});f.records.parents.fields.OBS='ORIGINAL';const context=await data.loadEditor('42');f.failNext();await assert.rejects(data.saveEditor(context,{OBS:'new'}));const count=f.writes.length;await assert.rejects(data.saveEditor(context,{OBS:'original'}),/retentativa|dados|intenção/i);assert.equal(f.writes.length,count);assert.equal(f.records.children[1].fields.OBS,'old');await data.saveEditor(context,{OBS:'new'});assert.equal(f.records.children[1].fields.OBS,'NEW');});

test('pencil adapter resolves different parent/child date aliases and verifies all linked pages without touching unrelated IDs', async () => {
  const f = createProvisionDueDateFixture();
  // ALL linked children includes history: only the requested due-date field may change.
  const paid = f.children.find(row => row.id === '3'); paid.fields.STATUS = 'PAGO'; paid.fields.DATAPGTOEFETUADO = '2026-10-10T03:00:00Z';
  const data = createPendingProvisionAttachmentsData({ sourceKind: 'provision-description', repository: f.repository });
  await data.updateDueDate('42', '2026-10-13');
  assert.deepEqual(f.writes.map(write => [write.list, write.id, Object.keys(write.fields)]), [
    ['parents', '42', ['field_17']], ['children', '2', ['field_23']], ['children', '3', ['field_23']],
  ]);
  assert.equal(f.parent.fields.field_17.slice(0, 10), '2026-10-13');
  for (const child of f.children) assert.equal(child.fields.field_23.slice(0, 10), ['2', '3'].includes(child.id) ? '2026-10-13' : '2026-10-12');
  assert.equal(paid.fields.STATUS, 'PAGO'); assert.equal(paid.fields.DATAPGTOEFETUADO, '2026-10-10T03:00:00Z');
  assert.ok(f.pages.filter(page => page.list === 'children' && page.cursor === 'children-page-two').length >= 2, 'both discovery and final verification must visit the second page');
});
test('pencil adapter blocks success when a new linked child appears during synchronization, then verifies it on retry', async () => {
  const f = createProvisionDueDateFixture(), originalUpdate = f.repository.updateItem;
  let inserted = false;
  f.repository.updateItem = async (...args) => {
    const result = await originalUpdate(...args);
    if (!inserted && args[1] === 'children' && args[2] === '3') {
      inserted = true;
      f.children.push({ id: '4', eTag: '"c4"', fields: { [f.link]: '42', [f.childDue]: f.originalDate, STATUS: 'PAGAMENTO PREVISTO' } });
    }
    return result;
  };
  const data = createPendingProvisionAttachmentsData({ sourceKind: 'provision-description', repository: f.repository });
  await assert.rejects(data.updateDueDate('42', '2026-10-13'), error => error.code === 'PROVISION_DESCRIPTION_SYNC_INCOMPLETE' && error.pendingChildIds.includes('4'));
  assert.equal(f.children.find(row => row.id === '4').fields[f.childDue], f.originalDate);
  await data.updateDueDate('42', '2026-10-13');
  assert.equal(f.children.find(row => row.id === '4').fields[f.childDue].slice(0, 10), '2026-10-13');
  assert.equal(f.writes.filter(write => write.list === 'parents').length, 1);
});
test('pencil adapter rejects incomplete child pagination before updating the parent', async () => {
  const f = createProvisionDueDateFixture();
  f.repository.getItemsPage = async () => ({ items: [f.children[0]], hasMore: true });
  const data = createPendingProvisionAttachmentsData({ sourceKind: 'provision-description', repository: f.repository });
  await assert.rejects(data.updateDueDate('42', '2026-10-13'), /pagina/i);
  assert.equal(f.writes.length, 0);
});
