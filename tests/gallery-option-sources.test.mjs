import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharePointRepository } from '../portal/data/sharepoint-repository.js';
import { POWERAPPS_FORM_VARIANTS } from '../portal/catalog/powerapps-form-controls.generated.js';
import { createPowerAppsOptionSearchController } from '../portal/ui/dynamic-form.js';
import { createGalleryRecordData } from '../apps/energetico-mobile/src/chat/gallery-record-data.js';

const listId='8c70b687-b252-4a88-bd3c-73cf6e720fb7';
const site={host:'tenant.sharepoint.com',path:'/sites/test'};
for(const rest of [false,true])for(const exact of [false,true])test(`${rest?'REST':'Graph'} recurring expenses use the proven LOCACOES fallback only when the logical title is absent (${exact})`,async()=>{
  const logicalId='9c70b687-b252-4a88-bd3c-73cf6e720fb8';
  const lists=[{id:listId,displayName:'LOCACOES',list:{template:'genericList'}},
    ...(exact?[{id:logicalId,displayName:'DESPESAS RECORRENTES',list:{template:'genericList'}}]:[])];
  const graph={async request(path){return path.includes('/lists')?{value:lists}:{id:'test-site'};}};
  const transport={async request(){return {value:lists.map(l=>({Id:l.id,Title:l.displayName,BaseTemplate:100,Hidden:false}))};}};
  const repository=createSharePointRepository(graph,{test:{...site,...(rest?{readTransport:'rest'}:{})}},{restTransport:transport});
  const resolved=await repository.resolveList('test',['DESPESASRECORRENTES','DESPESAS RECORRENTES']);
  assert.equal(resolved.status,'resolved');assert.equal(resolved.id,exact?logicalId:listId);
  assert.equal((await repository.resolveList('test',['OUTRA LISTA'])).status,'missing');
});
const variants={
  presence:['descricoes-de-presenca','Form20'],quotes:['novas-cotacoes','Form36_1'],
  measurements:['descricoes-de-medicao','Form24'],lines:['linhas-de-medicao','EDITARGRUPO_19'],
};
function source(kind,field){const [entity,form]=variants[kind];return POWERAPPS_FORM_VARIANTS[entity].find(v=>v.formName===form).fields[field].optionSources[0];}
function fixture(optionSource,{rest=false,patch={},missing=false}={}){
  const calls=[],authorizations=[];
  const columns=[{name:'ID',number:{},indexed:false,readOnly:true},
    {name:'DATAPGTOEFETUADO',displayName:'DATA PGTO EFETUADO',dateTime:{format:'dateOnly'},indexed:true},
    ...['Title','FORNECEDOR','ETAPA','FILIAL','STATUS','ACUMULADO'].map(name=>({name,text:{},indexed:true}))];
  const fields={ID:42,Title:'EXEMPLO',FORNECEDOR:'FORNECEDOR FICTICIO',ETAPA:'ETAPA FICTICIA',FILIAL:'FILIAL A',STATUS:'ATIVO',ACUMULADO:'RESUMO 42',DATAPGTOEFETUADO:'2026-10-28T03:00:00Z',...patch};
  const row={id:'42',fields};
  const notFound=()=>{throw Object.assign(new Error('not found'),{status:404});};
  const graph={async request(path,options={}){
    calls.push({path,options});
    if(path.includes('/columns'))return {value:columns};
    if(path.includes('/items/42'))return missing?notFound():row;
    if(path.includes('/items?'))return {value:[row]};
    if(path.includes('/lists'))return {value:[{id:listId,displayName:optionSource.listName,list:{template:'genericList'}}]};
    return {id:'test-site'};
  }};
  const transport={async request(_config,path,options={}){
    calls.push({path,options});
    if(path.includes('/fields?'))return {value:columns.map(c=>({InternalName:c.name,Title:c.displayName||c.name,Indexed:c.indexed,ReadOnlyField:!!c.readOnly,TypeAsString:c.number?'Counter':c.dateTime?'DateTime':'Text',DisplayFormat:0}))};
    if(path.includes('/items(42)'))return missing?notFound():{ID:42,...fields};
    if(path.includes('/items?'))return {value:[{ID:42,...fields}]};
    if(path.includes('/lists'))return {value:[{Id:listId,Title:optionSource.listName,BaseTemplate:100,Hidden:false}]};
    throw new Error('Unexpected REST read: '+path);
  }};
  const repository=createSharePointRepository(graph,{test:{...site,...(rest?{readTransport:'rest'}:{})}},{restTransport:transport});
  repository.setAuthorizationProvider({async authorize(value){authorizations.push(value);}});
  return {repository,calls,authorizations,fields};
}
const cases=[
  ['measurements','NUMEROCONTRATO','42'],['lines','IDMEDICAO','42'],['lines','IDPGTO','42'],
  ['presence','IDPGTO','42'],['quotes','ORCAMENTOESCOLHIDO','42'],
  ['quotes','COTACOESVINCULADAS','42'],
];
for(const [listName,field]of [['DESCRITIVOPRESENCA','IDPGTO'],['NOVACOTACAO','COTACOESVINCULADAS']])test(`${listName}.${field} saves comma-separated IDs and rejects display labels`,async()=>{
  const writes=[],searches=[];
  const repository={getColumns:async()=>[{name:field,text:{}}],
    getItem:async()=>({id:'7',eTag:'"v1"',fields:{[field]:'41'}}),
    async searchPowerAppsOptions(_site,descriptor,term,_dependencies,options){
      searches.push({descriptor,term,options});
      return descriptor.valueField==='ID'&&['42','43'].includes(term)?[{value:term,label:`${term} - FORNECEDOR`}]:[];
    },async updateItem(...args){writes.push(args);return {id:'7',fields:args[3]};}};
  const data=createGalleryRecordData({repository,listName,resolveList:async()=>({id:listId})});
  const invalid=await data.loadEditor('7');
  await assert.rejects(data.saveEditor(invalid,{[field]:'42 - FORNECEDOR'}),/opção válida/);
  assert.equal(writes.length,0);
  const valid=await data.loadEditor('7');
  await data.saveEditor(valid,{[field]:'42,43'});
  assert.deepEqual(writes[0][3],{[field]:'42,43'});assert.equal(writes[0][4].eTag,'"v1"');
  assert.ok(searches.every(call=>call.descriptor.valueField==='ID'&&call.options.exactValue===true));
});
for(const rest of [false,true])for(const [kind,field,value]of cases)test(`${rest?'REST':'Graph'} ${kind}.${field} browses and resolves the selected value using its real form source`,async()=>{
  const descriptor=source(kind,field),f=fixture(descriptor,{rest});
  const browse=await f.repository.searchPowerAppsOptions('test',descriptor,'',{}, {browse:true});
  assert.equal(browse[0].value,value);
  if(kind==='presence')assert.equal(browse[0].label,'42 - FORNECEDOR FICTICIO - 28/10/2026');
  if(field==='COTACOESVINCULADAS')assert.equal(browse[0].label,'42 - FORNECEDOR FICTICIO (ETAPA FICTICIA)');
  const typed=await f.repository.searchPowerAppsOptions('test',descriptor,'42',{},{});
  assert.ok(typed.some(option=>option.value===value));
  const exact=await f.repository.searchPowerAppsOptions('test',descriptor,value,{}, {exactValue:true});
  assert.ok(exact.some(option=>option.value===value));
  assert.ok(f.calls.some(call=>/\/items(?:\/42|\(42\))/.test(call.path)),'numeric identity must use the item route, not startswith(ID)');
  assert.ok(f.authorizations.some(call=>call.action==='view'&&call.listId===listId));
  assert.ok(f.calls.every(call=>!call.options.method||call.options.method==='GET'));
});

test('exact ID selection retains fixed, dependent and grouped scope restrictions',async()=>{
  const descriptor={kind:'dependent',listName:'EMPREITEIRO',valueField:'ID',
    dependsOn:[{fieldName:'FILIAL',targetField:'FILIAL'}],fixedFilters:[{fieldName:'STATUS',operator:'eq',value:'ATIVO'}],
    fixedFilterGroups:[[{fieldName:'ETAPA',operator:'eq',value:'ETAPA FICTICIA'}],[{fieldName:'ETAPA',operator:'eq',value:'OUTRA'}]]};
  for(const patch of [{},{STATUS:'INATIVO'},{FILIAL:'FILIAL B'},{ETAPA:'SEM ESCOPO'}]){
    const f=fixture(descriptor,{patch});const values=await f.repository.searchPowerAppsOptions('test',descriptor,'42',{FILIAL:'FILIAL A'},{exactValue:true});
    assert.equal(values.length,Object.keys(patch).length?0:1);
  }
});

test('missing ID and forged computed value never authorize an option',async()=>{
  const descriptor=source('quotes','COTACOESVINCULADAS');
  const f=fixture(descriptor,{missing:true});
  assert.deepEqual(await f.repository.searchPowerAppsOptions('test',descriptor,'42',{},{}),[]);
  const valid=fixture(descriptor);
  assert.deepEqual(await valid.repository.searchPowerAppsOptions('test',descriptor,'42 - OUTRO FORNECEDOR (OUTRA ETAPA)',{},{exactValue:true}),[]);
});

for(const rest of [false,true])test(`${rest?'REST':'Graph'} proven ID availability lookup reads one record and returns its textual value`,async()=>{
  const descriptor={kind:'filtered-list',listName:'DEMONSTRATIVOETAPA',valueField:'ETAPA',
    fixedFilters:[{fieldName:'ID',operator:'eq',value:'42'}],displayFields:['ETAPA'],searchFields:['ETAPA']};
  const f=fixture(descriptor,{rest});
  assert.deepEqual(await f.repository.searchPowerAppsOptions('test',descriptor,'',{},{}),[{value:'ETAPA FICTICIA',label:'ETAPA FICTICIA'}]);
  assert.deepEqual(await f.repository.searchPowerAppsOptions('test',descriptor,'OUTRA',{},{}),[]);
});

test('blank searchFields fall back only to the proven value; malformed references remain rejected',async()=>{
  const descriptor=source('lines','IDMEDICAO'),f=fixture(descriptor);
  assert.deepEqual(await f.repository.searchPowerAppsOptions('test',descriptor,'INVALIDO',{},{}),[]);
  assert.ok(!f.calls.some(call=>call.path.includes('/items')));
  await assert.rejects(f.repository.searchPowerAppsOptions('test',{...descriptor,searchFields:['bad\nfield']},'',{},{browse:true}),/referência|referencia/i);
  await assert.rejects(f.repository.searchPowerAppsOptions('test',descriptor,'',{}, {exactValue:true}),/valor|vazio|empty/i);
});

for(const rest of [false,true])test(`${rest?'REST':'Graph'} ID catalog with 3163 entries is completely browsable within the page budget`,async()=>{
  const descriptor=source('lines','IDPGTO'),calls=[];
  const columns=[{name:'ID',number:{},readOnly:true,indexed:false},{name:'ACUMULADO',text:{},indexed:true}];
  function page(path){const url=new URL(path,'https://graph.microsoft.com');const start=Number(url.searchParams.get('$skiptoken')||0),size=Number(url.searchParams.get('$top'));
    assert.ok(size>0&&size<=100);const rows=Array.from({length:Math.min(size,3163-start)},(_,i)=>({id:String(start+i+1),fields:{ID:start+i+1,ACUMULADO:`REGISTRO ${start+i+1}`}}));
    const next=start+rows.length<3163?`?$top=${size}&$skiptoken=${start+rows.length}`:'';
    return {rows,next};}
  const graph={async request(path){calls.push(path);if(path.includes('/columns'))return {value:columns};if(path.includes('/items?')){const {rows,next}=page(path);return {value:rows,...(next?{'@odata.nextLink':`https://graph.microsoft.com/v1.0/sites/test-site/lists/${listId}/items`+next}: {})};}if(path.includes('/lists'))return {value:[{id:listId,displayName:'LANCAMENTOS',list:{template:'genericList'}}]};return {id:'test-site'};}};
  const transport={async request(_site,path){calls.push(path);if(path.includes('/fields?'))return {value:columns.map(c=>({InternalName:c.name,Title:c.name,TypeAsString:c.number?'Counter':'Text',Indexed:c.indexed,ReadOnlyField:!!c.readOnly}))};if(path.includes('/items?')){const {rows,next}=page(path);return {value:rows.map(row=>({...row.fields})),...(next?{'odata.nextLink':`https://${site.host}${site.path}/_api/web/lists(guid'${listId}')/items`+next}:{})};}return {value:[{Id:listId,Title:'LANCAMENTOS',BaseTemplate:100,Hidden:false}]};}};
  const repository=createSharePointRepository(graph,{test:{...site,...(rest?{readTransport:'rest'}:{})}},{restTransport:transport});
  const options=await repository.searchPowerAppsOptions('test',descriptor,'',{}, {browse:true});
  assert.equal(options.length,3163);assert.equal(options.at(-1).value,'3163');assert.ok(calls.filter(path=>path.includes('/items?')).length<=100);
});

test('edit option controller accepts a complete catalog above the old 2000-option ceiling',async()=>{
  const result=await new Promise(resolve=>{const controller=createPowerAppsOptionSearchController({allowEmpty:true,debounceMs:0,
    search:async()=>Array.from({length:2501},(_,i)=>({value:String(i+1),label:`OPÇÃO ${i+1}`})),
    onState(state){if(['ready','error'].includes(state.status)){controller.dispose();resolve(state);}}});controller.input('',{browse:true});});
  assert.equal(result.status,'ready');assert.equal(result.options.length,2501);
});

test('exact validation accepts long values while interactive search keeps its own bound',async()=>{
  const descriptor={kind:'related',listName:'FORNECEDORES',valueField:'Title'},f=fixture(descriptor,{patch:{Title:'FORNECEDOR '+ 'X'.repeat(95)}});
  const value=(await f.repository.searchPowerAppsOptions('test',descriptor,'',{}, {browse:true}))[0].value;
  assert.ok(value.length>80);
  assert.equal((await f.repository.searchPowerAppsOptions('test',descriptor,value,{}, {exactValue:true}))[0].value,value);
  await assert.rejects(f.repository.searchPowerAppsOptions('test',descriptor,value,{},{}),/80/);
  await assert.rejects(f.repository.searchPowerAppsOptions('test',descriptor,'X'.repeat(2001),{}, {exactValue:true}),/2000/);
});
