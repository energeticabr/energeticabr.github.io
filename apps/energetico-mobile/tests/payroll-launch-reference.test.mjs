import test from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../src/chat/payroll-launch-reference.js');
const reference = () => ({name:'IDFOLHA',displayName:'IDFOLHA',required:false,readOnly:false,number:{decimalPlaces:'none'}});
function schema({columns=[],denied=false,lost=false}={}) {
  const posts=[];let clears=0;
  const repository={resolveList:async()=>({status:'resolved',id:'launches'}),getColumns:async()=>columns,
    resolveSites:async()=>({personal:{id:'site'}}),clearCache:()=>{clears++;}};
  const graph={request:async(path,options)=>{posts.push({path,options});if(denied)throw new Error('permission denied');columns=[reference()];if(lost)throw new Error('lost response');}};
  return {repository,graph,posts,get clears(){return clears;}};
}
test('provisiona referência IDFOLHA opcional sem registrar movimento financeiro',async()=>{
  const {ensurePayrollLaunchSchema}=await load(),f=schema();await ensurePayrollLaunchSchema(f);
  assert.equal(f.posts.length,1);assert.equal(f.posts[0].path,'/sites/site/lists/launches/columns');
  assert.equal(f.posts[0].options.body.name,'IDFOLHA');assert.equal(f.posts[0].options.body.required,false);
  assert.equal(f.posts[0].options.body.number.decimalPlaces,'none');assert.equal(f.clears,1);
});
test('coluna provisionada dispensa nova solicitação de administração',async()=>{
  const {ensurePayrollLaunchSchema}=await load(),f=schema({columns:[reference()]});await ensurePayrollLaunchSchema(f);assert.equal(f.posts.length,0);
});
test('schema recusa permissão negada e só aceita resposta perdida se a coluna for relida',async()=>{
  const {ensurePayrollLaunchSchema}=await load();await assert.rejects(ensurePayrollLaunchSchema(schema({denied:true})),/permission/);
  const f=schema({lost:true});await ensurePayrollLaunchSchema(f);assert.equal(f.posts.length,1);
});
for(const change of [c=>{c.number=undefined;c.text={};},c=>{c.readOnly=true;},c=>{c.required=true;},c=>{c.lookup={};},c=>{c.enforceUniqueValues=true;}]) {
  test(`schema incompatível bloqueia antes de alterar a lista: ${change}`,async()=>{
    const {ensurePayrollLaunchSchema}=await load(),c=reference();change(c);const f=schema({columns:[c]});
    await assert.rejects(ensurePayrollLaunchSchema(f),/IDFOLHA/);assert.equal(f.posts.length,0);
  });
}
function legacy({etag='"2"',sheet='',supplier='Ana'}={}) {
  const columns=[reference(),{name:'FORNECEDOR'},{name:'token'},{name:'quantity',number:{}},{name:'date',dateTime:{}}];
  let row={id:'7',eTag:etag,fields:{IDFOLHA:sheet,FORNECEDOR:supplier,token:'original-operation',quantity:2,date:'2026-10-15T12:00:00Z'}};
  const fields={IDFOLHA:11,FORNECEDOR:'Ana',token:'original-operation',quantity:2,date:'2026-10-15T12:00:00Z'},updates=[];
  return {columns,item:structuredClone(row),fields,readItem:async()=>structuredClone(row),
    updateItem:async(id,changes,options)=>{updates.push({id,changes,options});assert.equal(options.eTag,etag);row.fields={...row.fields,...changes};},updates};
}
test('referência legada vazia só é preenchida após dados e ETag confirmados',async()=>{
  const {confirmPayrollLaunchReference}=await load(),f=legacy();const saved=await confirmPayrollLaunchReference(f);
  assert.equal(saved.fields.IDFOLHA,11);assert.deepEqual(f.updates,[{id:'7',changes:{IDFOLHA:11},options:{eTag:'"2"'}}]);
});
test('referência confirmada não provoca atualização de registro',async()=>{
  const {confirmPayrollLaunchReference}=await load(),f=legacy({sheet:11});await confirmPayrollLaunchReference(f);assert.equal(f.updates.length,0);
});
for(const options of [{etag:''},{etag:'*'},{sheet:99},{supplier:'Outra pessoa'}]) {
  test(`referência divergente ou sem versão impede remendo automático: ${JSON.stringify(options)}`,async()=>{
    const {confirmPayrollLaunchReference}=await load(),f=legacy(options);await assert.rejects(confirmPayrollLaunchReference(f),/IDFOLHA|dados|versão/);assert.equal(f.updates.length,0);
  });
}
test('reconcilia vínculo pela origem e não pelo título técnico',async()=>{
  const {compatiblePayrollLaunchLink}=await load();const columns=['Title','IDLANCAMENTO','IDFOLHA','FORNECEDOR','TIPOPGTO'].map(name=>({name}));
  const fields={Title:'new-token',IDLANCAMENTO:7,IDFOLHA:11,FORNECEDOR:'Ana',TIPOPGTO:'VALE REFEIÇÃO'};
  const row={id:'20',fields:{...fields,Title:'outro-token'}};
  assert.equal(compatiblePayrollLaunchLink({columns,rows:[row],fields}).id,'20');
  assert.throws(()=>compatiblePayrollLaunchLink({columns,rows:[row,{...row,id:'21'}],fields}),/duplicad|Mais de um/);
  assert.throws(()=>compatiblePayrollLaunchLink({columns,rows:[{...row,fields:{...row.fields,IDFOLHA:99}}],fields}),/vínculo|IDFOLHA/);
});

function memoryJournal(){const records=new Map();return {getItem:k=>records.get(k)??null,setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)};}
test('duas instâncias concorrentes não criam o mesmo vínculo de origem',async()=>{
  const {ensurePayrollCreation}=await load(),storage=memoryJournal();let release,entered,posts=0;
  const started=new Promise(resolve=>{entered=resolve;});
  const options={key:'same-origin-lock-test',storage,findItem:async()=>null,verifyItem:async row=>row,
    createItem:()=>{posts++;entered();return new Promise(resolve=>{release=()=>resolve({id:'7'});});}};
  const first=ensurePayrollCreation(options);await started;
  await assert.rejects(ensurePayrollCreation(options),/andamento|outra tela/);
  release();assert.equal((await first).id,'7');assert.equal(posts,1);
});
test('falha ao persistir a tela antes do POST não deixa uma falsa tentativa enviada',async()=>{
  const {ensurePayrollCreation}=await load(),storage=memoryJournal();let posts=0;
  const options={key:'before-post-save',storage,findItem:async()=>null,verifyItem:async row=>row,createItem:async()=>{posts++;return{id:'7'};}};
  await assert.rejects(ensurePayrollCreation({...options,onAttempt:()=>{throw new Error('draft changed');}}),/draft changed/);
  assert.equal(posts,0);await ensurePayrollCreation(options);assert.equal(posts,1);
});
